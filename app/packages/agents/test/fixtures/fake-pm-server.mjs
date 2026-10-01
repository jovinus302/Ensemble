import { createInterface } from 'node:readline';
const send = x => process.stdout.write(JSON.stringify(x) + '\n');
const mode = process.env.PM_FIXTURE_MODE;
createInterface({ input: process.stdin }).on('line', line => {
 const r = JSON.parse(line);
 if (r.method === 'initialize') send({id:r.id,result:{}});
 if (r.method === 'thread/start') {
  if (r.params.sandbox !== 'read-only' || r.params.approvalPolicy !== 'never' || r.params.config['features.shell_tool'] !== false) process.exit(9);
  send({id:r.id,result:{thread:{id:'t'}}});
 }
 if (r.method === 'turn/start') {
  if (mode === 'crash') return process.exit(4);
  send({id:r.id,result:{turn:{id:'u'}}});
  if (mode === 'hang') return;
  send({method:'turn/completed',params:{threadId:'t',turn:{id:'u',status:'completed',items:[{type:'agentMessage',id:'i',phase:'final_answer',text: mode === 'invalid' ? '{"value":"wrong"}' : '{"value":7,"optional":null}'}]}}});
 }
 if (r.method === 'turn/interrupt') send({id:r.id,result:{}});
});
