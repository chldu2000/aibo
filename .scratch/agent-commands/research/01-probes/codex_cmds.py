"""Probe (agent-commands 01): how Codex's app-server reports and runs skills
(and what becomes of slash-command text), as aibo speaks to it.

Steps, every line in and out recorded:
  1. initialize; skills/list for WORKDIR before any thread exists;
  2. thread/start in WORKDIR; skills/list with no cwds;
  3. a new skill file appears in WORKDIR: is skills/changed pushed?
  4. turns (cheap model, low effort), each TURN one of
       text:<text>          a text input item
       skill:<name>:<text>  a skill input item (path from skills/list) + text
     waiting for turn/completed. Tool approvals are declined.

usage: python3 -I codex_cmds.py OUT.jsonl WORKDIR MODEL [TURN ...]
"""
import json, os, queue, subprocess, sys, threading, time

out_path, cwd, model, turns = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
log = open(out_path, "w")
p = subprocess.Popen(["codex", "app-server"], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.DEVNULL, text=True)
q = queue.Queue(); n = [0]

def reader():
    for line in p.stdout:
        log.write(line); log.flush()
        try: q.put(json.loads(line))
        except ValueError: pass
threading.Thread(target=reader, daemon=True).start()

def send(o):
    log.write(">> " + json.dumps(o) + "\n"); log.flush()
    p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()

def wait(pred, t=60):
    end = time.time() + t
    while time.time() < end:
        try: m = q.get(timeout=1)
        except queue.Empty: continue
        if "id" in m and "method" in m:  # a server request (approval): decline
            print("   server request:", m["method"])
            send({"id": m["id"], "result": {"decision": "decline"}})
            continue
        if "method" in m and m["method"] not in ("item/agentMessage/delta", "item/reasoning/summaryTextDelta",
                                                  "item/reasoning/textDelta", "thread/tokenUsage/updated", "account/rateLimits/updated"):
            show(m)
        if pred(m): return m
    return None

def show(m):
    meth, pa = m["method"], m.get("params", {})
    if meth in ("item/started", "item/completed"):
        it = pa.get("item", {})
        print("  ", meth, it.get("type"), json.dumps({k: v for k, v in it.items() if k not in ("type",)}, ensure_ascii=False)[:400])
    else:
        print("  ", meth, json.dumps(pa, ensure_ascii=False)[:200])

def req(method, params, t=60):
    n[0] += 1; i = n[0]
    send({"id": i, "method": method, "params": params})
    r = wait(lambda m: m.get("id") == i and "method" not in m, t)
    return r

def skills_summary(r):
    for e in (r or {}).get("result", {}).get("data", []):
        print("  cwd", e["cwd"], "errors", e["errors"])
        for s in e["skills"]:
            print("   ", s["scope"], s["name"], "enabled=%s" % s["enabled"], s["path"], "|", s["description"][:60], "| iface", bool(s.get("interface")), "plugin", s.get("pluginId"))

req("initialize", {"clientInfo": {"name": "aibo-probe", "version": "0"}, "capabilities": {"experimentalApi": True}})
send({"method": "initialized"})
print("== skills/list before a thread")
pre = req("skills/list", {"cwds": [cwd]}); skills_summary(pre)
print("== thread/start")
r = req("thread/start", {"cwd": cwd, "model": model, "approvalPolicy": "on-request", "sandbox": "read-only"})
tid = r["result"]["thread"]["id"]; print("  thread", tid)
print("== skills/list, no cwds")
skills = req("skills/list", {}); skills_summary(skills)
paths = {s["name"]: s["path"] for e in skills["result"]["data"] for s in e["skills"]}
print("== a skill file appears")
d = os.path.join(cwd, ".agents", "skills", "probe-late"); os.makedirs(d, exist_ok=True)
open(os.path.join(d, "SKILL.md"), "w").write("---\nname: probe-late\ndescription: Late probe skill.\n---\nReply LATE.\n")
log.write("## wrote .agents/skills/probe-late/SKILL.md\n")
print("  skills/changed:", bool(wait(lambda m: m.get("method") == "skills/changed", 15)))
for t in turns:
    kind, _, rest = t.partition(":")
    if kind == "skill":
        name, _, text = rest.partition(":")
        inp = [{"type": "text", "text": text}, {"type": "skill", "name": name, "path": paths.get(name, "?")}]
    else:
        inp = [{"type": "text", "text": rest}]
    print("== turn", json.dumps(inp))
    req("turn/start", {"threadId": tid, "input": inp, "effort": "low"})
    wait(lambda m: m.get("method") == "turn/completed", 180)
print("== thread/read")
r = req("thread/read", {"threadId": tid, "includeTurns": True})
print("  ", json.dumps(r)[:300])
p.stdin.close(); p.kill()
