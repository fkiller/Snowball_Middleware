// Opt-in real OpenCode observer proof. Never commands an existing task.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { connectOwnedOpenCode } from '../apps/supervisor/opencode-owned.mjs';
import { ensurePrivateStateDirectory } from '../apps/supervisor/private-state.mjs';

const selected = process.argv[2];
if (!selected || !path.isAbsolute(selected)) throw new Error('Absolute OpenCode executable required');
const executable = fs.realpathSync(selected);
const sha256 = createHash('sha256').update(fs.readFileSync(executable)).digest('hex');
const parent = fs.realpathSync(os.tmpdir());
const directory = path.join(parent, 'snowball-owned-opencode-' + randomUUID());
ensurePrivateStateDirectory(directory);
let binding;
try {
  binding = await connectOwnedOpenCode({ hostId: 'host_' + 'a'.repeat(32), instanceId: 'verification', executable, sha256, dataDir: directory });
  const status = binding.adapter.status();
  const sessions = await binding.adapter.listSessions();
  const models = await binding.adapter.listModels();
  if (!status.connected || !status.readOnly || status.providerVersion !== '1.18.31' || sessions.some(s => !s.readOnly || s.ownerId) || !Array.isArray(models) || models.some(m => m.efforts.length || m.defaultEffort !== null)) throw new Error('Observer claimed unverified control');
  console.log(JSON.stringify({ version: status.providerVersion, connected: true, isolatedSessions: sessions.length,
    modelCatalogCount: models.length, modelIds: models.map(m=>m.model), readOnly: true, existingTaskCommanded: false, environmentInherited: false }));
} finally {
  await binding?.adapter.stop();
  const resolved = fs.realpathSync(directory);
  const relative = path.relative(parent, resolved);
  if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Refusing unsafe cleanup');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
