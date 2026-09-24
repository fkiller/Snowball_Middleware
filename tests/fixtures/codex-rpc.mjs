import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const r = JSON.parse(line); if (!r.method) return;
  if (r.method === 'collision') {
    send({ id: r.id, method: 'item/commandExecution/requestApproval', params: { threadId: 'owned', turnId: 'turn' } });
    send({ id: r.id, result: { confirmed: true } });
  } else if (r.method === 'large-metadata') send({id:r.id,result:{preview:'x'.repeat(300000)}});
  else if (r.method === 'flood') process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1));
  else if (r.method === 'wait') send({ method: 'fixture/waiting', params: {} });
  else send({ id: r.id, result: r.params });
});
