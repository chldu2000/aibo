exec(open('/tmp/aibo-08/drive.py').read())
SEEN=[]
def on_req(m):
    SEEN.append(('REQ',m['method'],json.dumps(m.get('params'),ensure_ascii=False)[:400]))
    if m['method']=='item/tool/call':
        return {"contentItems":[{"type":"inputText","text":"[dynamic] the plan is dual-write + backfill."}],"success":True}
    if 'Approval' in m['method'] or 'approval' in m['method']: return {"decision":"accept"}
    if m['method']=='mcpServer/elicitation/request': return {"action":"accept","content":{}}
    return {}
SERVER_REQ_HANDLER[0]=on_req
srv={"command":"python3","args":["/tmp/aibo-08/mcp_probe.py"],"env":{"AIBO_TAG":"E"}}
dyn=[{"type":"function","name":"read_reference","description":"Read a session reference handed to this session.","inputSchema":{"type":"object","properties":{"ref_id":{"type":"string"}},"required":["ref_id"]}}]
PROMPT='Call the read_reference tool with ref_id "ref_test1", then reply with exactly the text it returned. Do nothing else.'
def run(label,params):
    t=req('thread/start',dict(cwd="/tmp/aibo-08/ws",approvalPolicy="on-request",**params))
    if 'error' in t: print(label,'start error',t['error']); return None
    tid=t['result']['thread']['id']
    r=req('turn/start',{"threadId":tid,"input":[{"type":"text","text":PROMPT}]})
    if 'error' in r: print(label,'turn error',r['error']); return tid
    n0=len(EV)
    pump(lambda m:m.get('method')=='turn/completed' and m.get('params',{}).get('threadId')==tid, 240)
    evs=EV[n0:]
    items=[ (m['params']['item'].get('type'), (m['params']['item'].get('text') or m['params']['item'].get('tool') or '')[:120]) for m in evs if m.get('method')=='item/completed' and m.get('params',{}).get('threadId')==tid]
    print('##',label,'items:',items)
    return tid
d=run('D dynamicTools',{"ephemeral":False,"dynamicTools":dyn})
e=run('E mcp default',{"ephemeral":True,"config":{"mcp_servers":{"aibo":srv}}})
srvF=dict(srv,env={"AIBO_TAG":"F"},default_tools_approval_mode="approve")
f=run('F mcp approve-mode',{"ephemeral":True,"config":{"mcp_servers":{"aibo":srvF}}})
for s in SEEN: print(*s)
# title + compaction on D
time.sleep(3)
names=[m for m in EV if m.get('method')=='thread/name/updated']
print('name events:',[json.dumps(m['params'],ensure_ascii=False) for m in names])
n0=len(EV)
r=req('thread/compact/start',{"threadId":d}); print('compact resp',json.dumps(r)[:200])
pump(lambda m:m.get('method')=='turn/completed' and m.get('params',{}).get('threadId')==d, 180)
print('compaction events:',[ (m.get('method'), json.dumps(m.get('params'),ensure_ascii=False)[:200]) for m in EV[n0:] if 'ompact' in json.dumps(m)])
print('all methods seen:',sorted(set(m.get('method') for m in EV if m.get('method'))))
P.terminate()
