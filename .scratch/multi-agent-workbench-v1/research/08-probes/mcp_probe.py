# Minimal stdio MCP server for probing. Logs every request with AIBO_TAG.
import sys, json, os
TAG=os.environ.get('AIBO_TAG','?'); LOG='/tmp/aibo-08/mcp_calls.log'
def log(x):
    open(LOG,'a').write(f"{TAG} {x}\n")
def send(o): sys.stdout.write(json.dumps(o)+"\n"); sys.stdout.flush()
for line in sys.stdin:
    try: m=json.loads(line)
    except: continue
    meth=m.get('method'); log(meth)
    if 'id' not in m: continue
    if meth=='initialize':
        send({"jsonrpc":"2.0","id":m['id'],"result":{"protocolVersion":m['params'].get('protocolVersion','2025-06-18'),"capabilities":{"tools":{}},"serverInfo":{"name":"aibo-probe","version":"0"}}})
    elif meth=='tools/list':
        send({"jsonrpc":"2.0","id":m['id'],"result":{"tools":[{"name":"read_reference","description":"Read a session reference handed to this session. Call it with ref_id.","inputSchema":{"type":"object","properties":{"ref_id":{"type":"string"}},"required":["ref_id"]}}]}})
    elif meth=='tools/call':
        log('CALL '+json.dumps(m['params'],ensure_ascii=False))
        send({"jsonrpc":"2.0","id":m['id'],"result":{"content":[{"type":"text","text":f"[probe {TAG}] reference content: the plan is dual-write + backfill."}]}})
    else:
        send({"jsonrpc":"2.0","id":m['id'],"result":{}})
