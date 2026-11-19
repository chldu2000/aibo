import subprocess, json
P=subprocess.Popen(['claude','-p','--input-format','stream-json','--output-format','stream-json','--verbose','--model','haiku','--permission-prompt-tool','stdio'],
  stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd='/tmp/aibo-13/ws')
def send(o): P.stdin.write(json.dumps(o)+"\n"); P.stdin.flush()
send({"type":"control_request","request_id":"init1","request":{"subtype":"initialize","hooks":None}})
send({"type":"user","message":{"role":"user","content":"Run exactly this shell command with the Bash tool: `touch /tmp/aibo-13/ws/y.txt && npm --version`. Then reply DONE."}})
for line in P.stdout:
    try: e=json.loads(line)
    except: continue
    if e.get('type')=='control_request':
        r=e['request']; print('CONTROL_REQUEST', json.dumps(r,ensure_ascii=False)[:1500])
        if r.get('subtype')=='can_use_tool':
            send({"type":"control_response","response":{"subtype":"success","request_id":e['request_id'],"response":{"behavior":"allow","updatedInput":r.get('input',{})}}})
    elif e.get('type')=='control_response': print('CONTROL_RESPONSE', json.dumps(e,ensure_ascii=False)[:200])
    elif e.get('type')=='result': print('RESULT',str(e.get('result'))[:60]); break
P.stdin.close(); P.wait(timeout=30)
