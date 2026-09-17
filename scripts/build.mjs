import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ['plugin-sdk', 'plugin-host', 'core', 'device-virtual']) {
  const project = `packages/${name}/tsconfig.json`;
  if (fs.existsSync(project)) execFileSync(process.execPath, [require.resolve('typescript/lib/tsc.js'), '-p', project], { stdio: 'inherit' });
}
