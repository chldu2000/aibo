/** Match explicit attachment IDs, never every attachment sharing a turn (steering shares turns). */
export function splitMessageAttachments(content, attachments = []) {
 const found=[];
 const body=content.replace(/\n?\[AIBO_CONTEXT_ATTACHMENTS\]([\s\S]*?)\[\/AIBO_CONTEXT_ATTACHMENTS\]/g,(_,block)=>{
  for(const line of block.split('\n')) {
   const match=line.match(/^- (.*?) \[attachment:([^\]\r\n]+)\]\s*$/);
   if(!match || found.some(item=>item.id===match[2]))continue;
   const existing=attachments.find(item=>item.id===match[2]);
   found.push(existing??{id:match[2],path:match[1].replace(/ \([^)]*\)$/,''),mediaType:'',size:null});
  }
  return '';
 });
 return {body:body.trimEnd(),attachments:found};
}
