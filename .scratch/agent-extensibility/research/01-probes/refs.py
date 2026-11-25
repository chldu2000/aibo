"""Probe 01 steps 4-5: reading an aibo reference, and two sessions in one
folder each given a server named "aibo" with its own token.

refbench (a real workbench with the fake Agent) makes the reference: the
source holds AMBER-7319 in its body only, and LATE-4421 in a message
added after the reference was made. tgt's token may read the reference;
other's may not.

MODE shared: one `opencode acp` process; session/new for tgt, then for
other, then tgt is prompted first (would other's registration replace
tgt's?), then other.
MODE separate: one process per session.
MODE shared-named: one process, servers "aibo-tgt" and "aibo-other";
other is asked to call aibo-tgt's tool.

usage: python3 -I refs.py OUT.jsonl WORKDIR shared|separate|shared-named
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp

out, cwd, mode = sys.argv[1], sys.argv[2], sys.argv[3]
repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../.."))
bench = subprocess.Popen(["go", "run", "./.scratch/agent-extensibility/research/01-probes/refbench", cwd],
                         cwd=repo, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
info = json.loads(bench.stdout.readline())
redact = {info["tgt_token"]: "<tgt-token>", info["other_token"]: "<other-token>"}
ref = info["ref_id"]

tools_seen = []


def make_client(tag):
    c = acp.Client(out, cwd, redact=redact)
    c.note("client %s (%s)" % (tag, mode))

    def on_request(msg):
        if msg["method"] == "session/request_permission":
            tc = msg["params"]["toolCall"]
            c.note("approve %s" % tc.get("title"))
            opts = {o["kind"]: o["optionId"] for o in msg["params"]["options"]}
            return {"outcome": {"outcome": "selected", "optionId": opts["allow_once"]}}
        return None
    c.on_request = on_request
    c.request("initialize", acp.INIT)
    return c


def new_session(c, token, tag):
    name = "aibo-" + tag if mode == "shared-named" else "aibo"
    r = c.request("session/new", {"cwd": cwd, "mcpServers": [acp.mcp_http(info["url"], token, name)]})
    sid = r["result"]["sessionId"]
    c.note("session %s = %s" % (tag, sid))
    return sid


def ask(c, sid, tag, text):
    start = len(c.inbox)
    rid = c.request_async("session/prompt", {"sessionId": sid, "prompt": acp.prompt(text)})
    resp = c.wait_response(rid, 300)
    calls = []
    for m in c.inbox[start:]:
        u = m.get("params", {}).get("update", {})
        if m.get("method") == "session/update" and m["params"].get("sessionId") == sid and u.get("sessionUpdate") == "tool_call":
            calls.append(u.get("title"))
        if m.get("method") == "session/update" and m["params"].get("sessionId") == sid and u.get("sessionUpdate") == "tool_call_update" and u.get("status") in ("completed", "failed"):
            raw = json.dumps(u.get("rawOutput") or u.get("content"), ensure_ascii=False)
            calls.append("  -> %s %s" % (u["status"], raw[:160]))
    txt = c.text_of(sid, start)
    print("== %s [%s] stop=%s" % (tag, mode, resp and resp.get("result", resp.get("error"))))
    for x in calls:
        print("   tool:", x)
    print("   text:", txt[:300].replace("\n", " "))
    print("   AMBER" if "AMBER-7319" in txt else "   (no AMBER)", "| LATE" if "LATE-4421" in txt else "| (no LATE)")


Q_TGT = info["tgt_text"].replace("请读这条引用。", "") + \
    "What deploy codeword does the referenced conversation give? Read the reference with the aibo tools; " \
    "do not guess. Reply with the codeword only, or NONE if you cannot read it."
Q_OTHER = ("Use the aibo MCP tools: call list_references, then read_reference with ref_id=\"%s\". "
           "What deploy codeword does it give? Reply with the codeword only, or NONE if you cannot read it." % ref)

# shared-named: as shared, but each session's server has its own name;
# other is asked to use tgt's server.
Q_CROSS = ("List every MCP tool you have whose name starts with aibo. Then call the read_reference tool of the "
           "aibo-tgt server with ref_id=\"%s\". What deploy codeword does it give? Reply with the tool names you "
           "have, then the codeword, or NONE if you cannot read it." % ref)
if mode == "shared-named":
    c = make_client("one")
    s_tgt = new_session(c, info["tgt_token"], "tgt")
    s_other = new_session(c, info["other_token"], "other")
    ask(c, s_tgt, "tgt", Q_TGT)
    ask(c, s_other, "other", Q_CROSS)
    clients = [c]
elif mode == "shared":
    c = make_client("one")
    s_tgt = new_session(c, info["tgt_token"], "tgt")
    s_other = new_session(c, info["other_token"], "other")
    ask(c, s_tgt, "tgt", Q_TGT)
    ask(c, s_other, "other", Q_OTHER)
    clients = [c]
else:
    a, b = make_client("tgt"), make_client("other")
    s_tgt = new_session(a, info["tgt_token"], "tgt")
    s_other = new_session(b, info["other_token"], "other")
    ask(a, s_tgt, "tgt", Q_TGT)
    ask(b, s_other, "other", Q_OTHER)
    clients = [a, b]
for c in clients:
    c.close()
bench.stdin.close()
bench.wait()
