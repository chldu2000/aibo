import {readFile} from 'node:fs/promises';
/** Bundle this package's fixed, dependency-free modules without executing their source. */
export async function workbenchSource(){
 const modules=['tree','metadata','markdown','rich-text','navigation','conversation','git','inspector','capability','workbench'];
 let source='self.aiboWorkbench=(()=>{const modules={};\n';
 for(const name of modules){
  let code=await readFile(new URL(name+'.js',import.meta.url),'utf8');
  const exports=[...code.matchAll(/export (?:const|function) (\w+)/g)].map(match=>match[1]);
  code=code.replace(/import \{([^}]+)\} from '\.\/([\w-]+)\.js';/g,(_,names,dependency)=>{
   if(!modules.slice(0,modules.indexOf(name)).includes(dependency))throw Error('invalid_workbench_dependency');
   return `const {${names}}=modules[${JSON.stringify(dependency)}];`;
  }).replaceAll('export ','');
  if(/\bimport\s/.test(code))throw Error('unexpected_workbench_import');
  source+=`modules[${JSON.stringify(name)}]=(()=>{${code}\nreturn {${exports.join(',')}};})();\n`;
 }
 return source+'return modules.workbench.renderWorkbench;})();\n';
}
