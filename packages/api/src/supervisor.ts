import fs from 'node:fs/promises';
import path from 'node:path';
export interface SupervisorAssets { html: string; script: string; style: string; client: string; icon?: Uint8Array; favicon?: Uint8Array }
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
  const binary=async(relative:string)=>{const bytes=await fs.readFile(path.join(repositoryRoot,relative));if(bytes.length>1024*1024)throw new Error('Supervisor asset too large');return bytes;};
  const [icon,favicon]=await Promise.all([binary('assets/icon-256.png'),binary('assets/icon.ico')]);
  return { html, script, style, client, icon, favicon };
}
