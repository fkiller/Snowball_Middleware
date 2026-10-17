// MK20's 400px reader: 8px ASCII / 16px Unicode, four 19px rows.
// Parse complete messages before wrapping/windowing so fences survive scrolling.
export function inlinePreview(source) {
  const literals = [];
  const hold = value => `\u0000${literals.push(value) - 1}\u0000`;
  // Protect spans before handling prose escapes: backslashes inside code are
  // literal source characters, including before Markdown punctuation.
  const raw = String(source);
  let text = '';
  for (let i = 0; i < raw.length;) {
    if (raw[i] === '\\' && /[\\`*_{}\[\]()#+.!>|~-]/.test(raw[i + 1] || '')) {
      text += hold(raw[i + 1]); i += 2; continue;
    }
    if (raw[i] === '`') {
      let count = 1;
      while (raw[i + count] === '`') count++;
      const ticks = '`'.repeat(count);
      let end = raw.indexOf(ticks, i + count);
      while (end >= 0 && (raw[end - 1] === '`' || raw[end + count] === '`')) end = raw.indexOf(ticks, end + count);
      if (end >= 0) {
        let code = raw.slice(i + count, end).replace(/\n/g, ' ');
        if (/^ .+ $/.test(code) && code.trim()) code = code.slice(1, -1);
        text += hold(code); i = end + count; continue;
      }
      text += ticks; i += count; continue;
    }
    text += raw[i++];
  }
  text = text.replace(/!?\[([^\]]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1');
  text = text.replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1');
  text = text.replace(/(\*\*|__|~~)(?=\S)(.+?\S|\S)\1/g, '$2');
  text = text.replace(/(^|[\s(])([*_])(?=\S)(.+?\S|\S)\2(?=$|[\s.,!?:;)])/g, '$1$3');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => literals[Number(i)]);
}

const width = text => Array.from(text).reduce((n, ch) => n + (ch.codePointAt(0) < 128 ? 1 : 2), 0);

export function markdownPreview(source, firstPrefix = '', contPrefix = '', columns = 50) {
  const lines = [], styles = [];
  let first = true;
  const emit = (text, style = 't', indent = '', hanging = 2) => {
    let rest = String(text).replace(/\t/g, '    ');
    do {
      const prefix = first ? firstPrefix : contPrefix;
      const pad = indent;
      const limit = Math.max(2, columns - width(prefix + pad));
      const chars = Array.from(rest);
      let n = 0, used = 0, space = -1;
      while (n < chars.length && used + width(chars[n]) <= limit) {
        used += width(chars[n]);
        if (chars[n] === ' ') space = n;
        n++;
      }
      // Preserve code exactly; prose wraps at words where possible, CJK at cells.
      if (style !== 'c' && n < chars.length && space > n / 2) n = space;
      const part = chars.slice(0, n).join('');
      lines.push(prefix + pad + part);
      styles.push(style);
      first = false;
      rest = chars.slice(n).join('');
      if (style !== 'c') rest = rest.replace(/^ +/, '');
      // List continuation aligns with its text, rather than repeating the bullet.
      if (style === 'l') { style = 't'; indent += ' '.repeat(hanging); }
    } while (rest);
  };
  const rows = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  let fence = null;
  const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(s => s.trim().replace(/\\\|/g, '|'));
  const tableRule = line => cells(line).every(s => /^:?-{3,}:?$/.test(s));
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const mark = raw.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
      else emit(raw, 'c');
      continue;
    }
    if (mark && (mark[1][0] !== '`' || !mark[2].includes('`'))) {
      fence = mark[1];
      if (mark[2].trim()) emit(mark[2].trim(), 'h');
      continue;
    }
    if (!raw.trim()) {
      if (lines.length && lines.at(-1).trim()) emit('');
      continue;
    }
    if (raw.includes('|') && i + 1 < rows.length && rows[i + 1].includes('|') && tableRule(rows[i + 1])) {
      const headers = cells(raw).map(inlinePreview);
      i += 2;
      for (; i < rows.length && rows[i].includes('|') && rows[i].trim(); i++) {
        const values = cells(rows[i]);
        values.forEach((value, c) => emit(`${headers[c] || c + 1}: ${inlinePreview(value)}`));
        if (i + 1 < rows.length && rows[i + 1].includes('|')) emit('');
      }
      i--;
      continue;
    }
    if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(raw)) { emit('', 'r'); continue; }
    const heading = raw.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) { emit(inlinePreview(heading[1]), 'h'); continue; }
    const quote = raw.match(/^ {0,3}> ?(.*)$/);
    if (quote) { emit(inlinePreview(quote[1]), 'q', '  '); continue; }
    const list = raw.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
    if (list) {
      const indent = ' '.repeat(Math.min(8, width(list[1])));
      const content = inlinePreview(list[3]).replace(/^\[([ xX])\]\s*/, (_, v) => v.trim() ? '(x) ' : '( ) ');
      const marker = /^\d/.test(list[2]) ? list[2] : '-';
      emit(`${marker} ${content}`, 'l', indent, width(marker) + 1);
      continue;
    }
    if (/^ {4}/.test(raw)) { emit(raw.slice(4), 'c'); continue; }
    if (i + 1 < rows.length && /^ {0,3}(?:=+|-+)\s*$/.test(rows[i + 1])) { emit(inlinePreview(raw), 'h'); i++; continue; }
    emit(inlinePreview(raw));
  }
  while (lines.length && !lines.at(-1).trim() && styles.at(-1) === 't') { lines.pop(); styles.pop(); }
  return { lines, styles };
}
