import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const defaults = {autostart: false, language: 'ko', controlPaused: false, notifications: true};
const validate = value => {
  if (!value || typeof value !== 'object' || Object.keys(defaults).some(k => k === 'language' ? !['ko','en'].includes(value[k]) : typeof value[k] !== 'boolean')) throw new Error('Invalid local settings');
  return Object.fromEntries(Object.keys(defaults).map(k => [k, value[k]]));
};
export function loadSettings(directory) {
  const file = path.join(directory, 'settings.v1.json');
  try {
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error('Invalid settings file');
    const value = JSON.parse(fs.readFileSync(file, 'utf8')); if (value.version !== 1) throw new Error('Unsupported settings version'); return validate(value.settings);
  } catch (error) { if (error.code === 'ENOENT') return {...defaults}; throw error; }
}
export function saveSettings(directory, settings) {
  const file = path.join(directory, 'settings.v1.json'); const temporary = path.join(directory, `settings-${process.pid}-${randomUUID()}.tmp`);
  const payload = JSON.stringify({version:1, settings:validate(settings)}) + '\n';
  let fd;
  try { fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, payload); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.renameSync(temporary, file); }
  finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
