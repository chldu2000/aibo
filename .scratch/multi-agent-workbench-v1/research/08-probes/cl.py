import subprocess, json, sys
allowed = sys.argv[1]=='allow'
mcp={"mcpServers":{"aibo":{"type":"stdio","command":"python3","args":["/tmp/aibo-08/mcp_probe.py"],"env":{"AIBO_TAG":"CL-"+sys.argv[1]}}}}
cmd=['claude','-p','--input-format','stream-json','--output-format','stream-json','--verbose','--model','haiku',
     '--mcp-config',json.dumps(mcp),'--strict-mcp-config']
if allowed: cmd+=['--allowedTools','mcp__aibo__*']
P=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd='/tmp/aibo-08/ws')
def say(t): P.stdin.write(json.dumps({"type":"user","message":{"role":"user","content":t}})+"\n"); P.stdin.flush()
def until_result(tag):
    for line in P.stdout:
        try: e=json.loads(line)
        except: continue
        t=e.get('type'); st=e.get('subtype')
        if t=='system': print(tag,'system',st, json.dumps({k:v for k,v in e.items() if k not in('tools','mcp_servers','slash_commands','agents','skills','plugins','capabilities')},ensure_ascii=False)[:260])
        elif t=='assistant':
            for c in e['message']['content']:
                print(tag,'assistant',c.get('type'), (c.get('text') or c.get('name') or '')[:100])
        elif t=='user':
            for c in e['message']['content'] if isinstance(e['message']['content'],list) else []:
                if c.get('type')=='tool_result': print(tag,'tool_result', json.dumps(c.get('content'),ensure_ascii=False)[:160])
        elif t=='result': print(tag,'result',st, 'denials=',json.dumps(e.get('permission_denials'),ensure_ascii=False)[:200]); return
        else: print(tag,t,st, json.dumps(e,ensure_ascii=False)[:200])
say('Call the read_reference tool with ref_id "ref_test1", then reply with exactly the text it returned. Do nothing else.')
until_result('T1')
if allowed:
    say('/compact'); until_result('T2')
P.stdin.close(); P.wait(timeout=60)
