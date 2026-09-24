import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseManifest } from '@snowball/plugin-sdk';
/** Artifact metadata only. Caller approval is separate; this does not start the worker. */
export async function codexManifest() {
  return parseManifest({ id: 'snowball.codex', publisher: 'Snowball', version: '0.1.0', kind: 'harness', sdkApiRange: '^1.0.0', entrypoint: 'dist/worker.js', platforms: ['win32', 'darwin'], architectures: ['x64', 'arm64'], capabilities: [
    ...['status', 'list', 'read', 'refreshAuth', 'models'].map(name => ({ operation: `harness.${name}`, access: 'observe' })),
    ...['connect', 'attach', 'create', 'execute', 'disconnect'].map(name => ({ operation: `harness.${name}`, access: 'control' })),
  ], permissions: ['selected-codex-home', 'selected-native-executable'], configSchema: { type: 'object', properties: {}, additionalProperties: false }, integrity: { entrySha256: createHash('sha256').update(await readFile(new URL('./worker.js', import.meta.url))).digest('hex') }, license: 'UNLICENSED' });
}
