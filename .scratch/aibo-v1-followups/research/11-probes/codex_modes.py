"""Probe (task 11): Codex's permission presets through the app-server,
without running a turn (no cost).

permissionProfile/list, experimentalFeature/list (the reviewer's flag),
thread/start with the default and with each candidate preset (what the
result says it uses), thread/start asking for approvalsReviewer
auto_review, and turn-less thread/settings changes are not possible:
the reviewer is set at thread/start here. Every line is recorded.

usage: python3 -I codex_modes.py OUT.jsonl WORKDIR
"""
import json, queue, subprocess, sys, threading, time

out_path, cwd = sys.argv[1], sys.argv[2]
log = open(out_path, "w")

class Server:
    def __init__(self, extra=()):
        self.p = subprocess.Popen(["codex", "app-server", *extra], cwd=cwd, stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        self.q = queue.Queue(); self.n = 0
        threading.Thread(target=self.read, daemon=True).start()
        self.req("initialize", {"clientInfo": {"name": "aibo-probe", "version": "0"}, "capabilities": {"experimentalApi": True}})
        self.send({"method": "initialized"})
    def read(self):
        for line in self.p.stdout:
            log.write(line); log.flush()
            try: self.q.put(json.loads(line))
            except ValueError: pass
    def send(self, o):
        log.write(">> " + json.dumps(o) + "\n"); log.flush()
        self.p.stdin.write(json.dumps(o) + "\n"); self.p.stdin.flush()
    def req(self, method, params, timeout=60):
        self.n += 1; i = self.n
        self.send({"id": i, "method": method, "params": params})
        end = time.time() + timeout
        while time.time() < end:
            try: m = self.q.get(timeout=1)
            except queue.Empty: continue
            if m.get("id") == i and "method" not in m: return m
        return {"error": "timeout"}
    def close(self):
        self.p.stdin.close(); self.p.kill()

def show(label, r, keys=("approvalPolicy", "approvalsReviewer", "sandbox", "activePermissionProfile")):
    if "error" in r: print(label, "ERROR", json.dumps(r["error"])[:300]); return
    res = r["result"]; print(label, {k: res.get(k) for k in keys})

s = Server()
r = s.req("permissionProfile/list", {"cwd": cwd})
print("profiles", json.dumps(r.get("result", r))[:800])
r = s.req("experimentalFeature/list", {})
feats = r.get("result", {}).get("data", [])
for f in feats:
    if any(w in (f["name"] + str(f.get("displayName"))).lower() for w in ("review", "guardian", "approv", "auto")):
        print("feature", {k: f[k] for k in ("name", "stage", "displayName", "enabled", "defaultEnabled")})
show("default", s.req("thread/start", {"cwd": cwd}))
for label, p in [("read-only/on-request", {"sandbox": "read-only", "approvalPolicy": "on-request"}),
                 ("workspace/on-request/user", {"sandbox": "workspace-write", "approvalPolicy": "on-request", "approvalsReviewer": "user"}),
                 ("workspace/on-request/auto_review", {"sandbox": "workspace-write", "approvalPolicy": "on-request", "approvalsReviewer": "auto_review"}),
                 ("full/never", {"sandbox": "danger-full-access", "approvalPolicy": "never"}),
                 ("workspace/untrusted", {"sandbox": "workspace-write", "approvalPolicy": "untrusted"})]:
    show(label, s.req("thread/start", {"cwd": cwd, **p}))
s.close()

# The reviewer's feature flag turned on for one app-server, if it has one.
names = [f["name"] for f in feats if "review" in f["name"].lower() or "guardian" in f["name"].lower()]
for n in names:
    s = Server(("--enable", n))
    show("with --enable " + n + ": auto_review", s.req("thread/start", {"cwd": cwd, "sandbox": "workspace-write", "approvalPolicy": "on-request", "approvalsReviewer": "auto_review"}))
    s.close()
