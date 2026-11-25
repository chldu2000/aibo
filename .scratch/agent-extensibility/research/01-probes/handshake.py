"""Probe 01 step 1: initialize and session/new only; no prompt is sent.

usage: python3 -I handshake.py OUT.jsonl WORKDIR
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import acp

out, cwd = sys.argv[1], sys.argv[2]
c = acp.Client(out, cwd)
init = c.request("initialize", acp.INIT)
new = c.request("session/new", {"cwd": cwd, "mcpServers": []})
c.pump(3)  # notifications that follow session/new (commands, modes...)
c.close()
print(json.dumps(init and init.get("result"), indent=1, ensure_ascii=False))
r = (new or {}).get("result", {})
print("sessionId", r.get("sessionId"))
print("modes", json.dumps(r.get("modes"), ensure_ascii=False)[:600])
m = r.get("models") or {}
print("currentModel", m.get("currentModelId"), "of", len(m.get("availableModels", [])))
print("configOptions", json.dumps(r.get("configOptions"), ensure_ascii=False)[:1200])
print("other keys", [k for k in r if k not in ("sessionId", "modes", "models", "configOptions")])
print("updates after new", [u.get("sessionUpdate") for u in c.updates()])
