import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readHarnessCli } from './harness-runtime.mjs';

export function parseAntigravityCatalog(output) {
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^([^\t]+)\t(.+)$/);
    if (!match) return [];
    const [, model, displayName] = match;
    // Only advertise a fixed effort encoded by the native model identifier.
    const fixed = model.match(/-(low|medium|high|max)$/)?.[1];
    return [{ model, displayName, efforts: fixed ? [fixed] : [],
      defaultEffort: fixed || null, isDefault: false }];
  }).map((model, idx) => ({ ...model, isDefault: idx === 0 }));
}

export function scanAntigravityCatalog() {
  try { return parseAntigravityCatalog(readHarnessCli('antigravity', ['models'])); }
  catch { console.warn('[Catalog] Antigravity CLI unavailable; no catalog advertised.'); return []; }
}

export function parseOpenCodeCatalog(output, cache) {
  return [...new Set(output.split('\n').map(line => line.trim()).filter(id => /^[^\s/]+\/[^\s]+$/.test(id)))].map((model, idx) => {
    const slash = model.indexOf('/');
    const meta = cache[model.slice(0, slash)]?.models?.[model.slice(slash + 1)] || {};
    const option = meta.reasoning_options?.find?.(value => value?.type === 'effort');
    const efforts = meta.reasoning === false ? [] :
      Array.isArray(option?.values) ? option.values.filter(value => typeof value === 'string') : Object.keys(meta.variants || {});
    return { model, displayName: meta.name || model.slice(slash + 1), efforts,
      defaultEffort: efforts[0] || null, isDefault: idx === 0 };
  });
}

export function scanOpenCodeCatalog() {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cache/opencode/models.json'), 'utf8')); } catch {}
  try { return parseOpenCodeCatalog(readHarnessCli('opencode', ['models']), cache); }
  catch { console.warn('[Catalog] OpenCode CLI unavailable; no catalog advertised.'); return []; }
}

export function scanCodexCatalog() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex/models_cache.json'), 'utf8'));
    const models = Array.isArray(data) ? data : data.models || [];
    return models.filter(model => model?.slug && model.visibility !== 'hide').map((meta, idx) => {
      const efforts = (meta.supported_reasoning_levels || []).map(level => typeof level === 'string' ? level : level?.effort).filter(Boolean);
      return { model: meta.slug, displayName: meta.display_name || meta.slug, efforts,
        defaultEffort: efforts.includes(meta.default_reasoning_level) ? meta.default_reasoning_level : efforts[0] || null,
        isDefault: idx === 0 };
    });
  } catch { console.warn('[Catalog] Codex cache unavailable; no catalog advertised.'); return []; }
}

export function scanAllHarnessCatalogs() {
  return {
    'snowball.codex': scanCodexCatalog(),
    'snowball.antigravity': scanAntigravityCatalog(),
    'snowball.opencode': scanOpenCodeCatalog(),
  };
}
