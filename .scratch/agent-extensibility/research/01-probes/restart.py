"""Probe 01 step 6: restart and continue a native session.

  process 1: session/new with tgt's token; plant ZEBRA-55 in the
             conversation; read the reference (AMBER-7319); close.
  process 2: session/resume with OTHER's token: does the resumed session
             know ZEBRA-55, does it replay history, and which token do its
             aibo tools now use?
  process 3: session/load with tgt's token: what is replayed before the
             response, and can it read the reference again?
  also: session/list in process 3.

usage: python3 -I restart.py OUT.jsonl WORKDIR
"""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp

out, cwd = sys.argv[1], sys.argv[2]
repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../.."))
bench = subprocess.Popen(["go", "run", "./.scratch/agent-extensibility/research/01-probes/refbench", cwd],
                         cwd=repo, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
info = json.loads(bench.stdout.readline())
redact = {info["tgt_token"]: "<tgt-token>", info["other_token"]: "<other-token>"}
ref = info["ref_id"]


def client(tag):
    c = acp.Client(out, cwd, redact=redact)
    c.note("process %s" % tag)
    c.request("initialize", acp.INIT)
    return c


def ask(c, sid, tag, text):
    start = len(c.inbox)
    resp = c.wait_response(c.request_async("session/prompt", {"sessionId": sid, "prompt": acp.prompt(text)}), 300)
    tools = [m["params"]["update"].get("title") for m in c.inbox[start:]
             if m.get("method") == "session/update" and m["params"]["update"].get("sessionUpdate") == "tool_call"]
    txt = c.text_of(sid, start)
    print("== %s stop=%s tools=%s" % (tag, resp and resp.get("result", {}).get("stopReason"), tools))
    print("   text:", txt[:300].replace("\n", " "))


def replayed(c, start):
    kinds = {}
    for m in c.inbox[start:]:
        if m.get("method") == "session/update":
            k = m["params"]["update"]["sessionUpdate"]
            kinds[k] = kinds.get(k, 0) + 1
    return kinds


Q_REF = ("Read reference %s with the aibo read_reference tool. Reply with the deploy codeword it gives, "
         "or NONE if the tool says there is no such reference." % ref)

c1 = client("1 new")
sid = c1.request("session/new", {"cwd": cwd, "mcpServers": [acp.mcp_http(info["url"], info["tgt_token"])]})["result"]["sessionId"]
ask(c1, sid, "p1 plant", "Remember this for later in our conversation: the parking code is ZEBRA-55. Reply with OK only.")
ask(c1, sid, "p1 ref", Q_REF)
c1.close()

c2 = client("2 resume")
start = len(c2.inbox)
r = c2.request("session/resume", {"sessionId": sid, "cwd": cwd, "mcpServers": [acp.mcp_http(info["url"], info["other_token"])]})
c2.pump(2)
print("resume response:", json.dumps(r.get("result") if r else r, ensure_ascii=False)[:300], "| error:", r and r.get("error"))
print("resume replayed:", replayed(c2, start))
ask(c2, sid, "p2 memory", "What parking code did I ask you to remember earlier in this conversation? Reply with the code only, or NONE.")
ask(c2, sid, "p2 ref (other's token)", Q_REF)
c2.close()

c3 = client("3 load")
start = len(c3.inbox)
r = c3.request("session/load", {"sessionId": sid, "cwd": cwd, "mcpServers": [acp.mcp_http(info["url"], info["tgt_token"])]})
c3.pump(2)
print("load response:", json.dumps(r.get("result") if r else r, ensure_ascii=False)[:300], "| error:", r and r.get("error"))
print("load replayed:", replayed(c3, start))
ask(c3, sid, "p3 ref (tgt's token)", Q_REF)
lst = c3.request("session/list", {"cwd": cwd})
ss = (lst or {}).get("result", {}).get("sessions", [])
print("session/list:", len(ss), "sessions;", "ours listed" if any(s.get("sessionId") == sid for s in ss) else "ours missing",
      json.dumps(ss[:1], ensure_ascii=False)[:300])
c3.close()
bench.stdin.close()
bench.wait()
