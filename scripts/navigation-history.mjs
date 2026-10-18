import fs from 'node:fs';
import path from 'node:path';

// Shared ordering only. This grants no access and never changes a controller's selection.
export class NavigationHistory {
  constructor(directory, now = Date.now) {
    this.now = now; this.records = {}; this.file = directory && path.join(directory, 'navigation-history.v1.json');
    if (this.file) {
      try {
        const stat = fs.lstatSync(this.file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw Error('invalid_navigation_history');
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (saved.schema !== 1 || !saved.records || typeof saved.records !== 'object') throw Error('invalid_navigation_history');
        this.records = Object.fromEntries(Object.entries(saved.records).filter(([key, time]) => key.length < 4096 && Number.isSafeInteger(time) && time > 0));
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  touch(keys) {
    const stamp = Math.max(this.now(), ...Object.values(this.records).map(n => n + 1));
    for (const key of keys.filter(Boolean)) this.records[key] = stamp;
    this.records = Object.fromEntries(Object.entries(this.records).sort((a,b) => b[1]-a[1]).slice(0,512));
    if (this.file) {
      const temporary = this.file + `.${process.pid}.tmp`;
      try { fs.writeFileSync(temporary, JSON.stringify({schema:1,records:this.records})+'\n', {mode:0o600}); fs.renameSync(temporary,this.file); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
  }
  order(items, key) { return [...items].sort((a,b) => (this.records[key(b)] || 0) - (this.records[key(a)] || 0)); }
}
