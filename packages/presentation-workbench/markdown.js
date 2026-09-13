  const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i;

  export function parseMarkdown(value) {
    const lines = value.replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (line.trim() === '') {
        index += 1;
        continue;
      }
      const fence = line.match(/^\s*```([^`]*)\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        if (index < lines.length) index += 1;
        blocks.push({ kind: 'code', lines: code, language: fence[1].trim() });
        continue;
      }
      const heading = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        blocks.push({ kind: 'heading', lines: [heading[2]], level: heading[1].length });
        index += 1;
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        const list = [];
        while (index < lines.length && (/^\s*[-*+]\s+/.test(lines[index]) || /^\s*\d+[.)]\s+/.test(lines[index]))) {
          list.push(lines[index].replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''));
          index += 1;
        }
        blocks.push({ kind: 'list', lines: list });
        continue;
      }
      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() !== '' && !/^\s*```/.test(lines[index]) && !/^\s*#{1,3}\s+/.test(lines[index]) && !/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[index])) {
        paragraph.push(lines[index].trim());
        index += 1;
      }
      blocks.push({ kind: 'paragraph', lines: [paragraph.join('\n')] });
    }
    return blocks;
  }

  export function inlineSegments(value) {
    const segments = [];
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\[([^\]\n]+)\]\(([^)\n]+)\))/g;
    let last = 0;
    for (const match of value.matchAll(pattern)) {
      const start = match.index ?? 0;
      if (start > last) segments.push({ kind: 'text', value: value.slice(last, start) });
      const token = match[0];
      if (token.startsWith('`')) segments.push({ kind: 'code', value: token.slice(1, -1) });
      else if (token.startsWith('**') || token.startsWith('__')) segments.push({ kind: 'strong', value: token.slice(2, -2) });
      else if (match[2] && match[3] && SAFE_LINK.test(match[3])) segments.push({ kind: 'link', value: match[2], href: match[3] });
      else segments.push({ kind: 'text', value: token });
      last = start + token.length;
    }
    if (last < value.length) segments.push({ kind: 'text', value: value.slice(last) });
    return segments;
  }


export function displayMarkdown(content){return content.replace(/\n?\[AIBO_CONTEXT_ATTACHMENTS\][\s\S]*?\[\/AIBO_CONTEXT_ATTACHMENTS\]/g,'').trimEnd();}
export function markdownTargets(content){
 const targets=[];
 for(const [index,block] of parseMarkdown(displayMarkdown(content)).entries()){
  if(block.kind==='code')targets.push({kind:'code',index,value:block.lines.join('\n')});
  else for(const line of block.lines)for(const segment of inlineSegments(line))if(segment.kind==='link'&&!targets.some(target=>target.kind==='link'&&target.value===segment.href))targets.push({kind:'link',index,value:segment.href});
 }
 return targets;
}
