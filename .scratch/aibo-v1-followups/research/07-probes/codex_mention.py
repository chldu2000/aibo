"""Probe (task 07): does a Codex app-server "mention" input item put the
file before the model, or does Codex read it with a command as it would a
path in the text? Two turns in two threads: the question with a mention
of the file, and with the path in the text only. Approvals are declined;
every line is recorded. The workdir holds secret.txt.

usage: python3 -I codex_mention.py OUT.jsonl WORKDIR
"""
import json, queue, subprocess, sys, threading, time

out, cwd = sys.argv[1], sys.argv[2]
log = open(out, "w")
p = subprocess.Popen(["codex", "app-server"], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
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
def req(method, params):
    n[0] += 1; i = n[0]
    send({"id": i, "method": method, "params": params})
    while True:
        m = q.get(timeout=120)
        if m.get("id") == i and "method" not in m: return m
        handle(m)
state = {}
def handle(m):
    if "method" in m and "id" in m:
        send({"id": m["id"], "result": {"decision": "decline"}})
    meth = m.get("method")
    if meth == "item/started" and m["params"]["item"]["type"] == "commandExecution":
        state.setdefault("commands", []).append(m["params"]["item"].get("command"))
    if meth == "item/completed" and m["params"]["item"]["type"] == "agentMessage":
        state["answer"] = m["params"]["item"].get("text")
    if meth == "turn/completed":
        state["done"] = True
req("initialize", {"clientInfo": {"name": "aibo-probe", "version": "0"}, "capabilities": {"experimentalApi": True}})
send({"method": "initialized"})
path = cwd.rstrip("/") + "/secret.txt"
ask = "What is the secret word in the file I mention? Do not run any commands or tools. If you cannot see the file's content, reply UNKNOWN. Otherwise reply with only the word."
for label, items in [("mention item", [{"type": "text", "text": ask, "text_elements": []}, {"type": "mention", "name": "secret.txt", "path": path}]),
                     ("path in text", [{"type": "text", "text": ask + " The file: " + path, "text_elements": []}])]:
    t = req("thread/start", {"cwd": cwd, "sandbox": "workspace-write", "approvalPolicy": "on-request"})["result"]["thread"]["id"]
    state.clear()
    r = req("turn/start", {"threadId": t, "input": items})
    if "error" in r: print(label, "ERROR", r["error"]); continue
    end = time.time() + 180
    while not state.get("done") and time.time() < end:
        try: handle(q.get(timeout=1))
        except queue.Empty: pass
    print(label, "-> commands:", state.get("commands", []), "answer:", state.get("answer"))
p.stdin.close(); p.kill()
