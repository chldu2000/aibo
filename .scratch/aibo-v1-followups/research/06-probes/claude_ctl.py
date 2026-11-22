"""Probe (2026-11-22): initialize models, set_model "default", effortLevel null.
Control requests only, no turn.

usage: mkdir -p /tmp/aibo06probe && python3 -I claude_ctl.py
"""
import json, subprocess, sys, select, time
p = subprocess.Popen(["claude","-p","--input-format","stream-json","--output-format","stream-json","--verbose","--model","haiku"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd="/tmp/aibo06probe")
def send(rid, req):
    p.stdin.write(json.dumps({"type":"control_request","request_id":rid,"request":req})+"\n"); p.stdin.flush()
def wait(rid, t=60):
    end=time.time()+t
    while time.time()<end:
        r,_,_=select.select([p.stdout],[],[],1)
        if not r: continue
        line=p.stdout.readline()
        if not line: return None
        try: d=json.loads(line)
        except: continue
        if d.get("type")=="control_response" and d["response"].get("request_id")==rid: return d["response"]
        if d.get("type")!="control_response": print("other:", line[:200].strip())
send("init",{"subtype":"initialize"}); r=wait("init")
for m in r["response"]["models"]:
    print("model", {k:v for k,v in m.items() if k!="description"})
for rid,req in [("s0",{"subtype":"get_settings"}),("m1",{"subtype":"set_model","model":"default"}),("s1",{"subtype":"get_settings"}),
                ("e1",{"subtype":"apply_flag_settings","settings":{"effortLevel":"high"}}),("s2",{"subtype":"get_settings"}),
                ("e2",{"subtype":"apply_flag_settings","settings":{"effortLevel":None}}),("s3",{"subtype":"get_settings"})]:
    send(rid,req); r=wait(rid)
    if rid.startswith("s"): print(rid, r.get("subtype"), json.dumps(r.get("response",{}).get("applied")))
    else: print(rid, json.dumps(r)[:300])
p.stdin.close(); p.kill()
