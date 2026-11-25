"""Minimal ACP client for probe agent-extensibility 01 ("acp-probe").

Drives `opencode acp` over stdio (newline-delimited JSON-RPC 2.0) and
writes every frame to a log: ">> " for what the client sent, "<< " for
what the Agent sent, "## " for the probe's own notes. Secrets given to
Client(redact=...) are replaced by their labels before anything is
written.
"""
import json, os, select, subprocess, time


class Client:
    def __init__(self, log_path, cwd, cmd=("opencode", "acp"), redact=None, env=None):
        self.log = open(log_path, "a")
        self.redact = dict(redact or {})
        self.next_id = 0
        self.pending = {}  # id -> response
        self.inbox = []  # notifications and requests from the Agent, in order
        self.on_request = None  # fn(msg) -> result dict, or None to leave it
        e = dict(os.environ)
        e.update(env or {})
        self.p = subprocess.Popen(list(cmd), cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=open(log_path + ".stderr", "a"), text=True, env=e, bufsize=1)
        self.note("start %s in %s pid=%d" % (" ".join(cmd), cwd, self.p.pid))

    def _w(self, prefix, text):
        for secret, label in self.redact.items():
            text = text.replace(secret, label)
        self.log.write(prefix + text + "\n")
        self.log.flush()

    def note(self, text):
        self._w("## ", text)

    def _send(self, msg):
        line = json.dumps(msg, ensure_ascii=False)
        self._w(">> ", line)
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()

    def request(self, method, params, timeout=60):
        self.next_id += 1
        rid = self.next_id
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        return self.wait_response(rid, timeout)

    def request_async(self, method, params):
        self.next_id += 1
        self._send({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params})
        return self.next_id

    def notify(self, method, params):
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def respond(self, rid, result=None, error=None):
        m = {"jsonrpc": "2.0", "id": rid}
        if error is not None:
            m["error"] = error
        else:
            m["result"] = result
        self._send(m)

    def pump(self, timeout):
        """Reads frames for up to timeout seconds; returns False at EOF."""
        end = time.time() + timeout
        while True:
            left = end - time.time()
            if left <= 0:
                return True
            r, _, _ = select.select([self.p.stdout], [], [], left)
            if not r:
                return True
            line = self.p.stdout.readline()
            if not line:
                self.note("stdout closed, exit=%s" % self.p.poll())
                return False
            self._w("<< ", line.rstrip("\n"))
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if "id" in msg and "method" not in msg:
                self.pending[msg["id"]] = msg
            else:
                self.inbox.append(msg)
                if "id" in msg and self.on_request:
                    res = self.on_request(msg)
                    if res is not None:
                        self.respond(msg["id"], res)
            return True

    def wait_response(self, rid, timeout=60):
        end = time.time() + timeout
        while rid not in self.pending and time.time() < end:
            if not self.pump(min(1, end - time.time())):
                break
        if rid not in self.pending:
            self.note("no response to id %d within %ss" % (rid, timeout))
            return None
        return self.pending.pop(rid)

    def updates(self, session_id=None):
        return [m["params"]["update"] for m in self.inbox
                if m.get("method") == "session/update"
                and (session_id is None or m["params"].get("sessionId") == session_id)]

    def text_of(self, session_id, start=0):
        """The agent_message_chunk text from inbox[start:] for the session."""
        out = []
        for m in self.inbox[start:]:
            if m.get("method") != "session/update" or m["params"].get("sessionId") != session_id:
                continue
            u = m["params"]["update"]
            if u.get("sessionUpdate") == "agent_message_chunk" and u.get("content", {}).get("type") == "text":
                out.append(u["content"]["text"])
        return "".join(out)

    def close(self):
        try:
            self.p.stdin.close()
        except Exception:
            pass
        try:
            self.p.wait(10)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait()
        self.note("exit=%s" % self.p.returncode)


INIT = {"protocolVersion": 1,
        "clientCapabilities": {"fs": {"readTextFile": False, "writeTextFile": False}, "terminal": False},
        "clientInfo": {"name": "acp-probe", "version": "0.1"}}


def mcp_http(url, token, name="aibo"):
    return {"type": "http", "name": name, "url": url,
            "headers": [{"name": "Authorization", "value": "Bearer " + token}]}


def prompt(text):
    return [{"type": "text", "text": text}]
