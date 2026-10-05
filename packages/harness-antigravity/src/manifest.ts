import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseManifest } from '@snowball/plugin-sdk';
import {harnessPresentation} from './presentation.js';

/** Artifact metadata only. Caller approval is separate; this does not start the worker. */
export async function antigravityManifest() {
  return parseManifest({
    id: 'snowball.antigravity',
    publisher: 'Snowball',
    version: '0.1.0',
    kind: 'harness',
    presentation:harnessPresentation,
    sdkApiRange: '^1.0.0',
    entrypoint: 'dist/worker.js',
    platforms: ['win32', 'darwin', 'linux'],
    architectures: ['x64', 'arm64'],
    capabilities: [
      ...['status', 'list', 'read', 'watch', 'models'].map(name => ({ operation: `harness.${name}`, access: 'observe' as const })),
    ],
    permissions: ['antigravity-brain'],
    configSchema: { type: 'object', properties: { appDataDir: { type: 'string' } }, additionalProperties: false },
    integrity: { entrySha256: createHash('sha256').update(await readFile(new URL('./worker.js', import.meta.url))).digest('hex') },
    license: 'Apache-2.0',
  });
}
