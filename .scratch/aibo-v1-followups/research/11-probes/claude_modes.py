"""Probe (task 11): Claude Code's permission modes in -p stream-json.

Part 1, no turn (no cost): initialize (what it says of permission modes),
then set_permission_mode to each mode, and get_settings after each; run
with and without --allow-dangerously-skip-permissions.
Part 2 (one haiku turn): in plan mode, does ExitPlanMode come as a
can_use_tool control request? It is denied, and the turn interrupted.

usage: python3 -I claude_modes.py OUT.jsonl WORKDIR [turn | --only-turn]
"""
import json, select, subprocess, sys, time

out_path, cwd = sys.argv[1], sys.argv[2]
turn = len(sys.argv) > 3  # "turn", or "--only-turn" to skip part 1
log = open(out_path, "w")
MODES = ["manual", "acceptEdits", "plan", "auto", "dontAsk", "bypassPermissions", "default"]

def start(extra):
    p = subprocess.Popen(["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                          "--permission-prompt-tool", "stdio", "--model", "haiku", *extra],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=cwd)
    return p

def send(p, o):
    log.write(">> " + json.dumps(o) + "\n"); log.flush()
    p.stdin.write(json.dumps(o) + "\n"); p.stdin.flush()

def lines(p, until, t=90):
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([p.stdout], [], [], 1)
        if not r: continue
        line = p.stdout.readline()
        if not line: return None
        log.write(line); log.flush()
        try: d = json.loads(line)
        except ValueError: continue
        v = until(d)
        if v is not None: return v

def ctl(p, rid, req):
    send(p, {"type": "control_request", "request_id": rid, "request": req})
    return lines(p, lambda d: d["response"] if d.get("type") == "control_response" and d["response"].get("request_id") == rid else None)

for extra in ((["--allow-dangerously-skip-permissions"], []) if "--only-turn" not in sys.argv else ()):
    print("== start", extra or "(plain)")
    p = start(extra)
    r = ctl(p, "init", {"subtype": "initialize"})
    init = r.get("response", {})
    print("initialize keys:", sorted(init.keys()))
    for k, v in init.items():
        if "mode" in k.lower() or "permission" in k.lower():
            print("  ", k, json.dumps(v)[:300])
    print("  models supportsAutoMode:", [(m["value"], m.get("supportsAutoMode")) for m in init.get("models", [])])
    for m in MODES:
        r = ctl(p, "m-" + m, {"subtype": "set_permission_mode", "mode": m})
        s = ctl(p, "s-" + m, {"subtype": "get_settings"})
        eff = (s or {}).get("response", {}).get("effective", {}).get("permissions", {})
        print(f"  set {m}: {r.get('subtype')} {json.dumps(r.get('error') or r.get('response'))[:160]}  effective.permissions.defaultMode={eff.get('defaultMode')!r}")
    p.stdin.close(); p.kill()

if turn:
    print("== plan-mode turn")
    p = start(["--allow-dangerously-skip-permissions", "--permission-mode", "plan"])
    ctl(p, "init", {"subtype": "initialize"})
    send(p, {"type": "user", "message": {"role": "user", "content": "Make a plan to create a file named a.txt containing the word hi. The plan is one step; present it right away with ExitPlanMode, without reading anything."}})
    def watch(d):
        if d.get("type") == "control_request":
            req = d["request"]
            print("  control_request:", req.get("subtype"), req.get("tool_name"), json.dumps(req.get("input"))[:200])
            send(p, {"type": "control_response", "response": {"subtype": "success", "request_id": d["request_id"],
                     "response": {"behavior": "deny", "message": "probe: not now", "interrupt": True}}})
        if d.get("type") == "result":
            print("  result:", d.get("subtype"), d.get("terminal_reason"), d.get("total_cost_usd"))
            return True
    lines(p, watch, 180)
    p.stdin.close(); p.kill()
