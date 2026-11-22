"""Probe (task 07): does Claude Code's stream-json input read "@path" by
itself? One haiku turn, tools forbidden by the prompt; every line is
recorded. The workdir holds secret.txt ("the secret word is pelican").

usage: python3 -I claude_at.py OUT.jsonl WORKDIR [MENTION [EXTRA_ARGS...]]

MENTION is what follows "@" (secret.txt by default); EXTRA_ARGS go to claude,
as --add-dir DIR.
"""
import json, select, subprocess, sys, time

out, cwd = sys.argv[1], sys.argv[2]
mention = sys.argv[3] if len(sys.argv) > 3 else "secret.txt"
extra = sys.argv[4:]
log = open(out, "w")
p = subprocess.Popen(["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                      "--permission-prompt-tool", "stdio", "--model", "haiku", *extra],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd=cwd)
def send(o):
    log.write(">> " + json.dumps(o) + "\n"); log.flush()
    p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()
send({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize"}})
send({"type": "user", "message": {"role": "user", "content": "What is the secret word in @" + mention + "? Do not use any tools. If you cannot see the file's content in this message, reply UNKNOWN. Otherwise reply with only the word."}})
tools, answer = [], None
end = time.time() + 120
while time.time() < end:
    r, _, _ = select.select([p.stdout], [], [], 1)
    if not r: continue
    line = p.stdout.readline()
    if not line: break
    log.write(line); log.flush()
    d = json.loads(line)
    if d.get("type") == "control_request":  # deny any tool
        tools.append(d["request"].get("tool_name"))
        send({"type": "control_response", "response": {"subtype": "success", "request_id": d["request_id"], "response": {"behavior": "deny", "message": "no tools"}}})
    if d.get("type") == "assistant":
        for b in d["message"]["content"]:
            if b.get("type") == "tool_use": tools.append(b["name"])
    if d.get("type") == "user" and any(w in line for w in ("pelican", "walrus", "otter")):
        print("  a user/attachment line holds the file:", line[:300])
    if d.get("type") == "result":
        answer = d.get("result"); break
print("tools:", tools, "answer:", answer)
p.stdin.close(); p.kill()
