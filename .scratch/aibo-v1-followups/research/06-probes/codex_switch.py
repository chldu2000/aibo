"""Probe: can a Codex app-server thread change its model and reasoning
effort between turns, and do the changes last?

model/list (its effort fields), thread/start, turn 1 as started, turn 2
with model + effort overrides, turn 3 without overrides; then a second
app-server resumes the thread to see what it keeps. Every line is
recorded to the jsonl path given.

usage: python3 -I codex_switch.py OUT.jsonl WORKDIR
"""
import json
import queue
import subprocess
import sys
import threading
import time

out_path, cwd = sys.argv[1], sys.argv[2]
log = open(out_path, "w")


class Server:
    def __init__(self):
        self.p = subprocess.Popen(["codex", "app-server"], cwd=cwd, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.q = queue.Queue()
        self.n = 0
        threading.Thread(target=self.read, daemon=True).start()
        self.req("initialize", {"clientInfo": {"name": "aibo-probe", "version": "0"},
                                "capabilities": {"experimentalApi": True}})
        self.send({"method": "initialized"})

    def read(self):
        for line in self.p.stdout:
            log.write(line)
            log.flush()
            try:
                self.q.put(json.loads(line))
            except ValueError:
                pass

    def send(self, o):
        log.write(">> " + json.dumps(o) + "\n")
        self.p.stdin.write(json.dumps(o) + "\n")
        self.p.stdin.flush()

    def handle(self, m):
        if "method" in m and "id" in m:  # a server request: decline approvals
            self.send({"id": m["id"], "result": {"decision": "decline"}})
        elif "method" in m and ("effort" in json.dumps(m).lower() or "model" in m["method"].lower()):
            print("  note", m["method"], json.dumps(m.get("params"))[:300])

    def req(self, method, params, timeout=120):
        self.n += 1
        i = self.n
        self.send({"id": i, "method": method, "params": params})
        end = time.time() + timeout
        while time.time() < end:
            try:
                m = self.q.get(timeout=1)
            except queue.Empty:
                continue
            if m.get("id") == i and ("result" in m or "error" in m):
                return m
            self.handle(m)
        raise TimeoutError(method)

    def turn(self, tid, text, **over):
        r = self.req("turn/start", {"threadId": tid, "input": [{"type": "text", "text": text}], **over})
        print("turn/start", json.dumps(r)[:300])
        end = time.time() + 180
        while time.time() < end:
            try:
                m = self.q.get(timeout=1)
            except queue.Empty:
                continue
            self.handle(m)
            if m.get("method") == "turn/completed":
                return


s = Server()
ml = s.req("model/list", {})
for m in ml.get("result", {}).get("data", []):
    print("model", {k: m.get(k) for k in ("id", "isDefault", "hidden", "defaultReasoningEffort", "supportedReasoningEfforts")})
st = s.req("thread/start", {"cwd": cwd, "approvalPolicy": "never", "sandbox": "read-only"})
res = st["result"]
tid = res["thread"]["id"]
print("thread/start", {k: v for k, v in res.items() if k != "thread"})
s.turn(tid, "Reply with just OK.")
models = [m["id"] for m in ml["result"]["data"] if not m.get("hidden")]
other = next((m for m in models if "mini" in m), models[-1])
print("switching to", other, "low")
s.turn(tid, "Reply with just OK again.", model=other, effort="low")
s.turn(tid, "Reply with just OK a third time.")
s.p.terminate()

s2 = Server()
rs = s2.req("thread/resume", {"threadId": tid})
print("thread/resume", {k: v for k, v in rs.get("result", {}).items() if k != "thread"}, rs.get("error"))
s2.p.terminate()
