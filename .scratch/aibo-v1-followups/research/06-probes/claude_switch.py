"""Probe: can a running Claude Code stream-json session change its model
and effort between turns?

Starts claude with --model haiku --effort low, runs a turn, then sends
set_model / apply_flag_settings and get_settings, runs another turn, and
records every line to the jsonl path given.

usage: python3 -I claude_switch.py OUT.jsonl [workdir]
"""
import json
import subprocess
import sys
import threading
import queue

out_path = sys.argv[1]
cwd = sys.argv[2] if len(sys.argv) > 2 else "/tmp"
p = subprocess.Popen(
    ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json",
     "--verbose", "--model", "haiku", "--effort", "low"],
    cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
q = queue.Queue()
log = open(out_path, "w")


def reader():
    for line in p.stdout:
        log.write(line)
        log.flush()
        try:
            q.put(json.loads(line))
        except ValueError:
            q.put({"raw": line})
    q.put(None)


threading.Thread(target=reader, daemon=True).start()


def send(obj):
    log.write(">> " + json.dumps(obj) + "\n")
    p.stdin.write(json.dumps(obj) + "\n")
    p.stdin.flush()


def wait(pred, timeout=120):
    while True:
        m = q.get(timeout=timeout)
        if m is None:
            raise SystemExit("claude exited")
        if pred(m):
            return m


def ctl(rid, req):
    send({"type": "control_request", "request_id": rid, "request": req})
    m = wait(lambda m: m.get("type") == "control_response" and m["response"].get("request_id") == rid)
    print(rid, json.dumps(m["response"], ensure_ascii=False)[:800])
    return m


def turn(text):
    send({"type": "user", "message": {"role": "user", "content": text}})
    m = wait(lambda m: m.get("type") == "result")
    print("result", m.get("subtype"), "modelUsage:", list((m.get("modelUsage") or {}).keys()))


ctl("init", {"subtype": "initialize"})
ctl("s0", {"subtype": "get_settings"})
turn("Reply with just OK.")
ctl("m", {"subtype": "set_model", "model": "sonnet"})
ctl("e", {"subtype": "apply_flag_settings", "settings": {"effortLevel": "high"}})
ctl("s1", {"subtype": "get_settings"})
turn("Reply with just OK again.")
p.stdin.close()
p.wait(timeout=30)
