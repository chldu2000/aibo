/** Extract only recognized, valid reference envelopes; malformed prose stays visible. */
export function splitSessionReferences(content) {
 const references=[];
 const body=content.replace(/\[AIBO_SESSION_REFERENCES\]\r?\n[^\n]*\r?\n(\[[^\n]*\])\r?\n\[\/AIBO_SESSION_REFERENCES\]/g,(block,payload)=>{
  try {
   const entries=JSON.parse(payload);
   if(!Array.isArray(entries)||!entries.length||entries.some(entry=>!entry?.snapshot||typeof entry.snapshot.sourceSessionId!=='string'))return block;
   for(const entry of entries){
    const snapshot=entry.snapshot;
    const messages=Array.isArray(snapshot.messages)?snapshot.messages:[];
    const excerpts=messages.filter(item=>item&&(item.role==='user'||item.role==='assistant')&&typeof item.content==='string').slice(-12)
      .map(item=>({role:item.role,text:item.content.split('[AIBO_SESSION_REFERENCES]')[0].split('[AIBO_CONTEXT_ATTACHMENTS]')[0].slice(0,1500),truncated:item.truncated===true||item.content.length>1500}));
    references.push({id:String(entry.snapshotId??snapshot.snapshotId??snapshot.sourceSessionId),title:typeof snapshot.sourceLabel==='string'?snapshot.sourceLabel:'引用会话',agent:typeof snapshot.sourceAgent==='string'?snapshot.sourceAgent:'',excerpts,
     note:snapshot.contextMode==='conversation-excerpts'?'对话摘录 · 工具输出未提供':'历史引用 · 仅展示对话摘录',
     omitted:typeof snapshot.omittedMessageCount==='number'?snapshot.omittedMessageCount:null});
   }
   return '';
  }catch{return block;}
 });
 return {body:body.trim(),references};
}
