"""Probe (agent-commands 01): how Claude Code reports and runs slash commands
in aibo's mode (persistent -p, stream-json in/out, control protocol).

Starts claude as aibo does (no aibo MCP server), sends initialize, waits a
moment for anything pushed before the first message, then sends each MSG as
a user message and waits for its result (or a quiet spell, since some local
commands may emit no result). Every line in and out is recorded.

usage: [CLAUDE_EXTRA="--flag ..."] python3 -I claude_cmds.py OUT.jsonl WORKDIR [MSG ...]
       a MSG of "@ctl:<subtype>" sends that control request instead;
       "@sh:<command>" runs a shell command in WORKDIR, then records what
       comes in a quiet spell.
"""
import json, os, select, subprocess, sys, time

out_path, cwd, msgs = sys.argv[1], sys.argv[2], sys.argv[3:]
log = open(out_path, "w")
p = subprocess.Popen(["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                      "--include-partial-messages", "--forward-subagent-text", "--permission-prompt-tool", "stdio",
                      "--model", "haiku", "--allow-dangerously-skip-permissions", *os.environ.get("CLAUDE_EXTRA", "").split()],
                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd)

def send(o):
    log.write(">> " + json.dumps(o) + "\n"); log.flush()
    p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()

def redact(d):
    """The line as recorded: the account (email, organization) is not kept."""
    r = d.get("response", {}).get("response") if d.get("type") == "control_response" else None
    if isinstance(r, dict) and isinstance(r.get("account"), dict):
        r["account"] = {k: "<redacted>" for k in r["account"]}
    return json.dumps(d, ensure_ascii=False) + "\n"

def pump(until, t=120, quiet=None):
    end, last = time.time() + t, time.time()
    while time.time() < end:
        if quiet and time.time() - last > quiet: return "quiet"
        r, _, _ = select.select([p.stdout], [], [], 0.5)
        if not r: continue
        line = p.stdout.readline()
        if not line: return "eof"
        last = time.time()
        try: d = json.loads(line)
        except ValueError:
            log.write(line); log.flush(); continue
        log.write(redact(d)); log.flush()
        if d.get("type") == "control_request":  # deny any tool use: probes run no tools
            send({"type": "control_response", "response": {"subtype": "success", "request_id": d["request_id"],
                  "response": {"behavior": "deny", "message": "probe: no tools"}}})
        if until(d): return d
    return "timeout"

def summarize(d):
    t, st = d.get("type"), d.get("subtype")
    if t == "stream_event": return None
    s = {"type": t, "subtype": st, "session_id": d.get("session_id")}
    if t in ("user", "assistant"):
        s["content"] = json.dumps(d.get("message", {}).get("content"))[:300]
        for k in ("isReplay", "isSynthetic", "parent_tool_use_id"):
            if k in d: s[k] = d[k]
    if t == "result": s.update(result=str(d.get("result"))[:300], is_error=d.get("is_error"), cost=d.get("total_cost_usd"), num_turns=d.get("num_turns"))
    return s

send({"type": "control_request", "request_id": "init", "request": {"subtype": "initialize"}})
r = pump(lambda d: d.get("type") == "control_response")
print("initialize keys:", sorted(r["response"].get("response", {}).keys()) if isinstance(r, dict) else r)
print("pre-message:", pump(lambda d: False, t=6, quiet=5))
for i, m in enumerate(msgs):
    print("==", m)
    if m.startswith("@sh:"):  # a shell command in WORKDIR, between messages
        log.write("## sh: " + m[4:] + "\n"); subprocess.run(m[4:], shell=True, cwd=cwd)
        print("  quiet spell:", pump(lambda d: False, t=8, quiet=6)); continue
    if m.startswith("@ctl:"):
        send({"type": "control_request", "request_id": f"c{i}", "request": {"subtype": m[5:]}})
        r = pump(lambda d: d.get("type") == "control_response")
        print("  ", json.dumps(r)[:400]); continue
    send({"type": "user", "message": {"role": "user", "content": m}})
    seen = []
    def until(d):
        s = summarize(d)
        if s: print("  ", json.dumps(s, ensure_ascii=False))
        return d.get("type") == "result"
    print("  end:", (lambda r: r if isinstance(r, str) else "result")(pump(until, t=180, quiet=25)))
p.stdin.close()
try: p.wait(10)
except subprocess.TimeoutExpired: p.kill()
print("stderr:", p.stderr.read()[:500])
