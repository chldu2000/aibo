"""Probe 01 steps 2-3: one session, five turns.

  1. a bash command, its approval allowed (allow_once);
  2. a bash command, its approval rejected (reject_once);
  3. a bash command; while its approval waits, session/cancel, then the
     request answered "cancelled" as ACP asks;
  4. a plain turn, to see the session take the next turn;
  5. a bash command, cancelled mid-run (sleep), no approval asked
     (the workspace allows `sleep *`).

WORKDIR must hold an opencode.json asking for bash (see run notes).
usage: python3 -I turns.py OUT.jsonl WORKDIR
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp

out, cwd = sys.argv[1], sys.argv[2]
c = acp.Client(out, cwd)
c.request("initialize", acp.INIT)
sid = c.request("session/new", {"cwd": cwd, "mcpServers": []})["result"]["sessionId"]

policy = {"answer": None}
asked = []


def on_request(msg):
    if msg["method"] != "session/request_permission":
        c.note("unhandled request " + msg["method"])
        return None
    opts = {o["kind"]: o["optionId"] for o in msg["params"]["options"]}
    asked.append((msg["id"], msg["params"]))
    a = policy["answer"]
    if a is None:
        return None  # leave it waiting
    return {"outcome": {"outcome": "selected", "optionId": opts[a]}}


c.on_request = on_request


def turn(label, text, answer=None, cancel_after_ask=False, cancel_after=None, timeout=180):
    policy["answer"] = answer
    start, n_asked = len(c.inbox), len(asked)
    c.note("turn %s" % label)
    rid = c.request_async("session/prompt", {"sessionId": sid, "prompt": acp.prompt(text)})
    t0 = time.time()
    cancelled = False
    while rid not in c.pending and time.time() - t0 < timeout:
        c.pump(1)
        if cancel_after_ask and not cancelled and len(asked) > n_asked:
            c.pump(1)
            c.note("cancel while the approval waits")
            c.notify("session/cancel", {"sessionId": sid})
            c.respond(asked[-1][0], {"outcome": {"outcome": "cancelled"}})
            cancelled = True
        if cancel_after and not cancelled and time.time() - t0 > cancel_after:
            c.note("cancel mid-run")
            c.notify("session/cancel", {"sessionId": sid})
            cancelled = True
    resp = c.pending.pop(rid, None)
    kinds = []
    for m in c.inbox[start:]:
        if m.get("method") == "session/update":
            u = m["params"]["update"]
            k = u["sessionUpdate"]
            if k == "tool_call" or k == "tool_call_update":
                k += "(%s)" % u.get("status")
            if not kinds or kinds[-1] != k:
                kinds.append(k)
        elif "method" in m:
            kinds.append("REQ " + m["method"])
    print("== %s: stop=%s asked=%d" % (label, resp and (resp.get("result") or resp.get("error")), len(asked) - n_asked))
    print("   sequence:", " → ".join(kinds))
    print("   text:", c.text_of(sid, start)[:200].replace("\n", " "))


turn("1-allow", "Use your bash tool to run exactly `echo probe-allow` and then reply with its output only.", "allow_once")
turn("2-reject", "Use your bash tool to run exactly `echo probe-reject` and then reply with its output only. If the tool is refused, reply REFUSED.", "reject_once")
turn("3-cancel-waiting", "Use your bash tool to run exactly `echo probe-cancel`.", None, cancel_after_ask=True)
turn("4-next", "Reply with exactly: NEXT-OK")
turn("5-cancel-running", "Use your bash tool to run exactly `sleep 30 && echo done`, then reply with its output.", "allow_once", cancel_after=12)
turn("6-after", "Reply with exactly: AFTER-OK")
c.close()
print("permission request params of turn 1:")
print(json.dumps(asked[0][1], ensure_ascii=False, indent=1)[:1500] if asked else "none")
