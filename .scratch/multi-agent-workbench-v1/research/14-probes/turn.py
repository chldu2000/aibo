import subprocess, json, threading, queue, time
P=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open('/tmp/aibo-14/appserver2.err','w'),text=True,cwd='/tmp/aibo-14/ws')
Q=queue.Queue(); NID=[0]
threading.Thread(target=lambda:[Q.put(json.loads(l)) for l in P.stdout],daemon=True).start()
def send(o): P.stdin.write(json.dumps(o)+"\n"); P.stdin.flush()
def req(method,params,timeout=30):
    NID[0]+=1; i=NID[0]; send({"id":i,"method":method,"params":params}); end=time.time()+timeout
    while time.time()<end:
        try: m=Q.get(timeout=1)
        except queue.Empty: continue
        if m.get('id')==i: return m
        print('NOTIF',json.dumps(m)[:400])
req('initialize',{"clientInfo":{"name":"aibo-probe","version":"0"}}); send({"method":"initialized"})
t=req('thread/start',{"cwd":"/tmp/aibo-14/ws"}); print('thread/start',json.dumps(t)[:300])
tid=t['result']['thread']['id']
print('turn/start',json.dumps(req('turn/start',{"threadId":tid,"input":[{"type":"text","text":"hi"}]}))[:300])
end=time.time()+40
while time.time()<end:
    try: m=Q.get(timeout=1)
    except queue.Empty: continue
    s=json.dumps(m)
    if 'delta' in m.get('method',''): continue
    print('EV',s[:500])
    if m.get('method')=='turn/completed': break
P.kill()
