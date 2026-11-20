// Package mcpserver is the workbench MCP server: streamable HTTP on a
// random port of 127.0.0.1, inside the workbench's process, through which
// receiving Agents read their references. Each session reaches it with a
// bearer token of its own, and sees a server bound to that session alone.
package mcpserver

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"github.com/chldu2000/aibo/internal/refs"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Reader reads the references given to a session, as text for its Agent.
// Its errors are shown to the Agent as they are.
type Reader interface {
	ListReferences(sessionID string) (string, error)
	ReadReference(sessionID string, q ReadReference) (string, error)
	ReadMessage(sessionID string, q ReadMessage) (string, error)
	SearchReference(sessionID string, q SearchReference) (string, error)
}

// SearchReference is search_reference's input.
type SearchReference struct {
	Query           string `json:"query" jsonschema:"搜索词：默认是关键词，不区分大小写，多个词须同时出现；regex 为 true 时是正则表达式"`
	RefID           string `json:"ref_id,omitempty" jsonschema:"只搜这一个引用；不填则搜交给本会话的全部引用"`
	Regex           bool   `json:"regex,omitempty" jsonschema:"把 query 当作正则表达式"`
	IncludeThinking bool   `json:"include_thinking,omitempty" jsonschema:"是否也搜 Agent 的思考内容，默认不搜"`
	Cursor          string `json:"cursor,omitempty" jsonschema:"上一页末尾给出的 cursor，用来看更多命中"`
}

// ReadReference is read_reference's input.
type ReadReference struct {
	RefID           string `json:"ref_id" jsonschema:"要读取的引用 ID，如 ref_7Kq2xP"`
	FromSeq         int    `json:"from_seq,omitempty" jsonschema:"从这个序号开始读；不填则从引用范围的开头读"`
	Cursor          string `json:"cursor,omitempty" jsonschema:"上一页末尾给出的 cursor，用来读下一页"`
	IncludeThinking bool   `json:"include_thinking,omitempty" jsonschema:"是否包含 Agent 的思考内容，默认不包含"`
}

// ReadMessage is read_message's input.
type ReadMessage struct {
	RefID           string `json:"ref_id" jsonschema:"引用 ID"`
	Seq             int    `json:"seq" jsonschema:"要读取的消息序号，必须在引用范围内"`
	Cursor          string `json:"cursor,omitempty" jsonschema:"上一页末尾给出的 cursor，用来读这条消息的下一页"`
	IncludeThinking bool   `json:"include_thinking,omitempty" jsonschema:"是否包含 Agent 的思考内容，默认不包含"`
}

// Server is the running MCP server.
type Server struct {
	reader Reader
	ln     net.Listener
	http   *http.Server

	mu      sync.Mutex
	tokens  map[string]string      // token → session
	servers map[string]*mcp.Server // session → its server
}

// Path is the endpoint's path.
const Path = "/mcp"

// Start listens on a random port of 127.0.0.1.
func Start(r Reader) (*Server, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s := &Server{reader: r, ln: ln, tokens: map[string]string{}, servers: map[string]*mcp.Server{}}
	// Stateless: every request finds its session's server by its token
	// alone, so no request can join another token's MCP session.
	h := mcp.NewStreamableHTTPHandler(s.serverFor, &mcp.StreamableHTTPOptions{Stateless: true, JSONResponse: true})
	mux := http.NewServeMux()
	mux.Handle(Path, s.guard(h))
	s.http = &http.Server{Handler: mux}
	go s.http.Serve(ln)
	return s, nil
}

// URL is the endpoint's URL.
func (s *Server) URL() string { return "http://" + s.ln.Addr().String() + Path }

// Close stops the server.
func (s *Server) Close() error { return s.http.Close() }

// Issue gives a session a new token, revoking the ones it had.
func (s *Server) Issue(sessionID string) string {
	b := make([]byte, 32)
	rand.Read(b)
	token := base64.RawURLEncoding.EncodeToString(b)
	s.mu.Lock()
	defer s.mu.Unlock()
	for t, id := range s.tokens {
		if id == sessionID {
			delete(s.tokens, t)
		}
	}
	s.tokens[token] = sessionID
	return token
}

// Revoke revokes a session's tokens.
func (s *Server) Revoke(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for t, id := range s.tokens {
		if id == sessionID {
			delete(s.tokens, t)
		}
	}
	delete(s.servers, sessionID)
}

type sessionKey struct{}

// guard admits requests with a valid token and no foreign Origin: Agents
// send none, and a web page on the user's machine must not get in.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" && !loopbackOrigin(o) {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		s.mu.Lock()
		id, known := s.tokens[token]
		s.mu.Unlock()
		if !ok || !known {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), sessionKey{}, id)))
	})
}

func loopbackOrigin(o string) bool {
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	host := u.Hostname()
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// serverFor returns the server bound to the request's session.
func (s *Server) serverFor(r *http.Request) *mcp.Server {
	id, _ := r.Context().Value(sessionKey{}).(string)
	if id == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if srv, ok := s.servers[id]; ok {
		return srv
	}
	srv := s.newServer(id)
	s.servers[id] = srv
	return srv
}

type listIn struct{}

func (s *Server) newServer(sessionID string) *mcp.Server {
	srv := mcp.NewServer(&mcp.Implementation{Name: "aibo", Title: "aibo 工作台"}, &mcp.ServerOptions{
		Instructions: "aibo 工作台交给本会话的会话引用：其他会话中一段消息的只读快照。用户的请求依赖引用的内容时，先读取再回答。",
	})
	readOnly := &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: new(bool)}
	mcp.AddTool(srv, &mcp.Tool{
		Name:        refs.ToolListReferences,
		Description: "列出交给本会话的所有会话引用及其概要。",
		Annotations: readOnly,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ listIn) (*mcp.CallToolResult, any, error) {
		return result(s.reader.ListReferences(sessionID))
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name:        refs.ToolReadReference,
		Description: "按顺序分页读取一个会话引用范围内的消息，每条消息以“### [序号] 角色 · 时间”开头；过长的消息只显示开头，用 read_message 读完整内容。页尾给出下一页的 cursor。",
		Annotations: readOnly,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ReadReference) (*mcp.CallToolResult, any, error) {
		return result(s.reader.ReadReference(sessionID, in))
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name:        refs.ToolReadMessage,
		Description: "读取会话引用中一条消息的完整内容，内容很长时分页，页尾给出下一页的 cursor。",
		Annotations: readOnly,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in ReadMessage) (*mcp.CallToolResult, any, error) {
		return result(s.reader.ReadMessage(sessionID, in))
	})
	mcp.AddTool(srv, &mcp.Tool{
		Name:        refs.ToolSearchReference,
		Description: "在交给本会话的会话引用里按关键词或正则查找消息，返回命中消息的序号和片段，每页最多 20 条。",
		Annotations: readOnly,
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in SearchReference) (*mcp.CallToolResult, any, error) {
		return result(s.reader.SearchReference(sessionID, in))
	})
	return srv
}

// result returns text to the Agent, or the error as a tool error it can
// read and act on.
func result(text string, err error) (*mcp.CallToolResult, any, error) {
	if err != nil {
		return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil, nil
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil, nil
}
