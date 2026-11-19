import subprocess, json
P=subprocess.Popen(['codex','app-server'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,cwd='/tmp/aibo-14/ws')
def send(o): P.stdin.write(json.dumps(o)+"\n"); P.stdin.flush()
def wait(i):
    for l in P.stdout:
        m=json.loads(l)
        if m.get('id')==i: return m
send({"id":0,"method":"account/read","params":{}}); print('before-init', json.dumps(wait(0)))
send({"id":1,"method":"initialize","params":{"clientInfo":{"name":"aibo","version":"0"}}}); wait(1); send({"method":"initialized"})
send({"id":2,"method":"no/such","params":{}}); print('unknown', json.dumps(wait(2)))
P.kill()
