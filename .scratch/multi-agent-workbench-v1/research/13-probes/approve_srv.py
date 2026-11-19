import sys, json
LOG='/tmp/aibo-13/approve.log'
def send(o): sys.stdout.write(json.dumps(o)+"\n"); sys.stdout.flush()
for line in sys.stdin:
    try: m=json.loads(line)
    except: continue
    if 'id' not in m: continue
    meth=m.get('method')
    if meth=='initialize':
        send({"jsonrpc":"2.0","id":m['id'],"result":{"protocolVersion":m['params'].get('protocolVersion','2025-06-18'),"capabilities":{"tools":{}},"serverInfo":{"name":"aibo","version":"0"}}})
    elif meth=='tools/list':
        send({"jsonrpc":"2.0","id":m['id'],"result":{"tools":[{"name":"approve","description":"permission prompt","inputSchema":{"type":"object","additionalProperties":True}}]}})
    elif meth=='tools/call':
        open(LOG,'a').write(json.dumps(m['params'],ensure_ascii=False)+"\n")
        send({"jsonrpc":"2.0","id":m['id'],"result":{"content":[{"type":"text","text":json.dumps({"behavior":"allow","updatedInput":m['params']['arguments'].get('input',{})})}]}})
    else:
        send({"jsonrpc":"2.0","id":m['id'],"result":{}})
