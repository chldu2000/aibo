import readline from 'node:readline';
const mode=process.argv[2];
for await(const line of readline.createInterface({input:process.stdin})){
  const request=JSON.parse(line);
  if(request.method==='initialized')continue;
  if(mode==='hang')continue;
  let result;
  if(request.method==='initialize')result={};
  else if(request.method==='account/read'){
    if(request.params.refreshToken!==false)throw Error('Unexpected token refresh');
    result={account:mode==='signed-out'?null:{type:'chatgpt',email:'person@example.test',planType:'plus',accessToken:'SECRET'},refreshToken:'SECRET'};
  }else if(request.method==='account/rateLimits/read')result={rateLimits:{primary:{usedPercent:35,resetsAt:1900000000},secondary:{usedPercent:5}},credential:'SECRET'};
  else throw Error('Unexpected native method');
  process.stdout.write(JSON.stringify(mode==='error'?{id:request.id,error:{message:'SECRET'}}:{id:request.id,result})+'\n');
}
