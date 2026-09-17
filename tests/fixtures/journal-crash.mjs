import fs from 'node:fs';
import path from 'node:path';
import { CommandJournal, formatSessionKey } from '../../packages/core/dist/index.js';
const [directory, stage] = process.argv.slice(2);
const hostId = `host_${'a'.repeat(32)}`;
const sessionKey = formatSessionKey({ hostId, harness: { pluginId: 'snowball.test', instanceId: 'one' }, nativeSessionId: 'native/0' });
const j = new CommandJournal({ directory, hostId });
j.registerSession(sessionKey, 'owner-1');
j.enqueue({ commandId: 'c1', actorId: `ctl_${'b'.repeat(16)}`, sessionKey, ownerId: 'owner-1', expectedRevision: 0, operation: 'sessions.send', payload: { text: 'one execution' } });
if (stage === 'queued') process.kill(process.pid, 'SIGKILL');
await j.dispatchNext(sessionKey, { ownerId: 'owner-1', execute: async () => {
  if (stage === 'after-effect') {
    const fd = fs.openSync(path.join(directory, 'external-effect.txt'), 'wx');
    fs.writeFileSync(fd, 'one execution'); fs.fsyncSync(fd); fs.closeSync(fd);
  }
  process.kill(process.pid, 'SIGKILL');
  return new Promise(() => {});
} });
