"""Probe (task 17): does a Codex app-server turn/start image input put
the image before the model? Two threads, one turn each: a "localImage"
item with a path outside the workspace, and an "image" item with a data:
URL. Approvals are declined; every line is recorded (the base64 data is
cut in the record).

usage: python3 -I codex_image.py OUT.jsonl WORKDIR IMAGE.png
"""
import base64, json, queue, subprocess, sys, threading, time

out, cwd, img = sys.argv[1], sys.argv[2], sys.argv[3]
data = base64.b64encode(open(img, "rb").read()).decode()
cut = lambda s: s.replace(data, data[:16] + "…")
log = open(out, "w")
p = subprocess.Popen(["codex", "app-server"], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
q = queue.Queue(); n = [0]
def reader():
    for line in p.stdout:
        log.write(cut(line)); log.flush()
        try: q.put(json.loads(line))
        except ValueError: pass
threading.Thread(target=reader, daemon=True).start()
def send(o):
    log.write(">> " + cut(json.dumps(o)) + "\n"); log.flush()
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
    if meth == "item/started" and m["params"]["item"]["type"] == "userMessage":
        state["user"] = [c.get("type") for c in m["params"]["item"].get("content", [])]
    if meth == "item/completed" and m["params"]["item"]["type"] == "agentMessage":
        state["answer"] = m["params"]["item"].get("text")
    if meth == "turn/completed":
        state["done"] = True
req("initialize", {"clientInfo": {"name": "aibo-probe", "version": "0"}, "capabilities": {"experimentalApi": True}})
send({"method": "initialized"})
ask = {"type": "text", "text": "Do not run any commands or tools. Name the shapes in the image and their colors, left to right, as 'color shape, color shape'. If you see no image, reply UNKNOWN.", "text_elements": []}
for label, item in [("localImage", {"type": "localImage", "path": img}),
                    ("image data URL", {"type": "image", "url": "data:image/png;base64," + data})]:
    t = req("thread/start", {"cwd": cwd, "sandbox": "workspace-write", "approvalPolicy": "on-request"})["result"]["thread"]["id"]
    state.clear()
    r = req("turn/start", {"threadId": t, "input": [item, ask]})
    if "error" in r: print(label, "ERROR", r["error"]); continue
    end = time.time() + 180
    while not state.get("done") and time.time() < end:
        try: handle(q.get(timeout=1))
        except queue.Empty: pass
    print(label, "-> user item:", state.get("user"), "commands:", state.get("commands", []), "answer:", state.get("answer"))
p.stdin.close(); p.kill()
