exec(open('/tmp/aibo-08/drive.py').read())
srv=lambda tag:{"command":"python3","args":["/tmp/aibo-08/mcp_probe.py"],"env":{"AIBO_TAG":tag}}
a=req('thread/start',{"cwd":"/tmp/aibo-08/ws","ephemeral":True,"config":{"mcp_servers":{"aibo":srv("A")}}})
b=req('thread/start',{"cwd":"/tmp/aibo-08/ws","ephemeral":True})
c=req('thread/start',{"cwd":"/tmp/aibo-08/ws","ephemeral":True,"config":{"mcp_servers":{"aibo":srv("C")}}})
ids={k:v.get('result',{}).get('thread',{}).get('id') or v for k,v in [('A',a),('B',b),('C',c)]}
print('threads',{k:(v if isinstance(v,str) else json.dumps(v)[:300]) for k,v in ids.items()})
time.sleep(4)
for k,t in ids.items():
    if not isinstance(t,str): continue
    r=req('mcpServerStatus/list',{"threadId":t,"detail":None})
    res=r.get('result') or r.get('error')
    names=[ (s.get('name'), [x.get('name') for x in (s.get('tools') or {}).values()] if isinstance(s.get('tools'),dict) else s.get('tools')) for s in (res.get('data') or [])] if isinstance(res,dict) and 'data' in res else res
    print(k, json.dumps(names,ensure_ascii=False)[:500])
r=req('mcpServerStatus/list',{})
print('global', json.dumps([s.get('name') for s in r.get('result',{}).get('data',[])],ensure_ascii=False))
P.terminate()
