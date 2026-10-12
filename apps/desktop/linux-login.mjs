import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';

// XDG autostart records the next graphical login; it does not start a second tray.
export function linuxLogin(config, identity, predecessors = [], directory = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart')) {
  const label = 'local.snowball.middleware.' + createHash('sha256').update(identity).digest('hex').slice(0, 12);
  const file = path.join(directory, label + '.desktop');
  const text = value => {
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw Error('Invalid login argument');
    return value;
  };
  // Desktop Entry Exec quoting is distinct from shell quoting. No shell is used.
  const quote = value => '"' + text(value).replaceAll('%', '%%').replace(/["`$\\]/g, '\\$&').replaceAll('\\', '\\\\') + '"';
  const payloadFor = selected => '[Desktop Entry]\nType=Application\nVersion=1.0\nName=Snowball Middleware\nExec=' + [selected.path, ...selected.args].map(quote).join(' ') + '\nTerminal=false\nX-GNOME-Autostart-enabled=true\n';
  const payload = payloadFor(config);
  const current = () => {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Unexpected login entry');
      return fs.readFileSync(file, 'utf8');
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const write = () => {
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    fs.writeFileSync(file + '.tmp', payload, {mode: 0o600, flag: 'wx'});
    fs.renameSync(file + '.tmp', file);
  };
  return {
    get: () => current() === payload,
    migrate() {
      const existing = current();
      if (existing !== payload && predecessors.some(previous => existing === payloadFor(previous))) write();
    },
    set(enabled) {
      const existing = current();
      if (existing !== null && existing !== payload) throw Error('Existing login entry differs; registration refused');
      if (enabled && existing === null) write();
      else if (!enabled && existing !== null) fs.unlinkSync(file);
      if ((current() === payload) !== enabled) throw Error('Login entry state was not confirmed');
    }
  };
}
