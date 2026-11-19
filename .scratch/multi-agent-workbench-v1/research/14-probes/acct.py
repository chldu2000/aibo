import subprocess, json, sys, threading, queue, time
P=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=open('/tmp/aibo-14/appserver.err','w'),text=True,cwd='/tmp/aibo-14/ws')
Q=queue.Queue(); NID=[0]
def reader():
    for line in P.stdout:
        try: Q.put(json.loads(line))
        except: pass
threading.Thread(target=reader,daemon=True).start()
def send(o): P.stdin.write(json.dumps(o)+"\n"); P.stdin.flush()
def req(method,params,timeout=30):
    NID[0]+=1; i=NID[0]; send({"id":i,"method":method,"params":params}); end=time.time()+timeout
    while time.time()<end:
        try: m=Q.get(timeout=1)
        except queue.Empty: continue
        if m.get('id')==i: return m
        print('NOTIF',json.dumps(m)[:300])
def red(o):
    s=json.dumps(o,ensure_ascii=False)
    import re
    s=re.sub(r'"(email|userId|chatgptAccountId)": "[^"]*"', r'"\1": "<redacted>"', s)
    return s
print('initialize', red(req('initialize',{"clientInfo":{"name":"aibo-probe","version":"0"},"capabilities":{"experimentalApi":True}})))
send({"method":"initialized"})
print('account/read', red(req('account/read',{})))
print('account/read refresh=false', red(req('account/read',{"refreshToken":False})))
P.stdin.close(); P.wait(timeout=10)
