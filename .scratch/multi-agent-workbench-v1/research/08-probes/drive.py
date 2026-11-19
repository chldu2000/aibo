# Drive `codex app-server` over stdio JSONL. Usage: drive.py <scenario>
import subprocess, json, sys, threading, queue, time
P=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open('/tmp/aibo-08/appserver.err','w'),text=True,cwd='/tmp/aibo-08/ws')
Q=queue.Queue(); NID=[0]; EV=[]
def reader():
    for line in P.stdout:
        try: Q.put(json.loads(line))
        except: pass
threading.Thread(target=reader,daemon=True).start()
def send(o): P.stdin.write(json.dumps(o)+"\n"); P.stdin.flush()
SERVER_REQ_HANDLER=[None]
def req(method,params,timeout=60):
    NID[0]+=1; i=NID[0]; send({"id":i,"method":method,"params":params}); end=time.time()+timeout
    while time.time()<end:
        try: m=Q.get(timeout=1)
        except queue.Empty: continue
        if m.get('id')==i and ('result' in m or 'error' in m): return m
        handle(m)
    raise TimeoutError(method)
def handle(m):
    EV.append(m)
    if 'method' in m and 'id' in m and SERVER_REQ_HANDLER[0]: send({"id":m['id'],"result":SERVER_REQ_HANDLER[0](m)})
def pump(until,timeout=180):
    end=time.time()+timeout
    while time.time()<end:
        try: m=Q.get(timeout=1)
        except queue.Empty: continue
        handle(m)
        if until(m): return m
print(json.dumps(req('initialize',{"clientInfo":{"name":"aibo-probe","version":"0"},"capabilities":{"experimentalApi":True}})['result'],ensure_ascii=False)[:300])
send({"method":"initialized"})
