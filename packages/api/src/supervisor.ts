import fs from 'node:fs/promises';
import path from 'node:path';
export interface SupervisorAssets { html: string; script: string; style: string; client: string }
/** Trusted runtime supplies its installed package root, never a browser-controlled directory. */
export async function loadSupervisorAssets(repositoryRoot: string): Promise<SupervisorAssets> {
  const read = async (relative: string) => {
    const bytes = await fs.readFile(path.join(repositoryRoot, relative));
    if (bytes.length > 1024 * 1024) throw new Error('Supervisor asset too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  };
  const [html, script, style, client] = await Promise.all([
    read('apps/supervisor/index.html'), read('apps/supervisor/app.js'),
    read('apps/supervisor/style.css'), read('packages/client-sdk/dist/index.js'),
  ]);
  return { html, script, style, client };
}
