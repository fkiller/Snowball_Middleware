import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseManifest } from '@snowball/plugin-sdk';

/** Artifact metadata only. Caller approval is separate; this does not start the worker. */
export async function opencodeManifest() {
  return parseManifest({
    id: 'snowball.opencode',
    publisher: 'Snowball',
    version: '0.1.0',
    kind: 'harness',
    sdkApiRange: '^1.0.0',
    entrypoint: 'dist/worker.js',
    platforms: ['win32', 'darwin', 'linux'],
    architectures: ['x64', 'arm64'],
    capabilities: [
      ...['status', 'list', 'read', 'models', 'refreshAuth'].map(name => ({ operation: `harness.${name}`, access: 'observe' as const })),
      ...['connect', 'disconnect'].map(name => ({ operation: `harness.${name}`, access: 'control' as const })),
    ],
    permissions: ['opencode-server'],
    configSchema: {
      type: 'object',
      properties: {
        baseUrl: { type: 'string' },
        authPassword: { type: 'string' },
        authUsername: { type: 'string' },
      },
      additionalProperties: false,
    },
    integrity: { entrySha256: createHash('sha256').update(await readFile(new URL('./worker.js', import.meta.url))).digest('hex') },
    license: 'UNLICENSED',
  });
}
