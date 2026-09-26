import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export async function serveHostToolMcp() {
  const endpoint=process.env.AIBO_HOST_TOOL_ENDPOINT, token=process.env.AIBO_HOST_TOOL_TOKEN;
  if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(endpoint??'') || !/^[a-f0-9]{64}$/.test(token??'')) throw Error('Invalid host tool bridge configuration');
  const request=async(path,input)=>{
    const response=await fetch(endpoint+path,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});
    const text=await response.text();if(Buffer.byteLength(text)>262144)throw Error('Host tool result exceeds transport limit');
    const result=JSON.parse(text);if(!response.ok)throw Error(result.error??'Host tool unavailable');return result;
  };
  const server=new Server({name:'aibo-host-tools',version:'1.0.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,()=>request('/list',{}));
  server.setRequestHandler(CallToolRequestSchema,async({params})=>{
    try {const {result}=await request('/call',params);return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}
    catch(error){return {content:[{type:'text',text:String(error.message??error)}],isError:true};}
  });
  await server.connect(new StdioServerTransport());
  process.stdin.once('end',()=>void server.close());
}
