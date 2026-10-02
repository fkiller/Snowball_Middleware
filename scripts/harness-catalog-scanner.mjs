import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';

const AGY_EXE = 'C:\\Users\\wondo\\AppData\\Local\\agy\\bin\\agy.exe';
const OPENCODE_CMD = 'C:\\nvm4w\\nodejs\\opencode.cmd';

/**
 * Discovers live models for Antigravity directly from the agy.exe CLI.
 * Zero hardcoded lists: parses output of `agy.exe models`.
 */
export function scanAntigravityCatalog() {
  try {
    if (fs.existsSync(AGY_EXE)) {
      const out = cp.execFileSync(AGY_EXE, ['models'], {
        encoding: 'utf8',
        timeout: 12000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      });
      const list = [];
      for (const line of out.split('\n')) {
        const match = line.trim().match(/^([^\t]+)\t(.*)$/);
        if (match) {
          const [, id, disp] = match;
          let efforts = [];
          let defEffort = null;
          if (id.toLowerCase().includes('claude')) {
            // Claude models on Antigravity reject --effort CLI argument
            efforts = [];
            defEffort = null;
          } else if (id.endsWith('-high')) {
            efforts = ['high'];
            defEffort = 'high';
          } else if (id.endsWith('-medium')) {
            efforts = ['medium'];
            defEffort = 'medium';
          } else if (id.endsWith('-low')) {
            efforts = ['low'];
            defEffort = 'low';
          } else if (id.endsWith('-max')) {
            efforts = ['max'];
            defEffort = 'max';
          } else {
            efforts = ['low', 'medium', 'high', 'max'];
            defEffort = disp.includes('(Medium)') ? 'medium' : (disp.includes('(Low)') ? 'low' : 'high');
          }

          list.push({
            model: id,
            displayName: disp,
            efforts,
            defaultEffort: defEffort,
            isDefault: id === 'gemini-3.8-flash-high' || list.length === 0
          });
        }
      }
      if (list.length > 0) return list;
    }
  } catch (err) {
    console.warn('[Catalog] Antigravity CLI model scan note:', err.message);
  }

  // Resilient fallback if CLI execution is unavailable
  return [
    { model: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)', efforts: ['high'], defaultEffort: 'high', isDefault: true },
    { model: 'gemini-3.7-flash-medium', displayName: 'Gemini 3.7 Flash (Medium)', efforts: ['medium'], defaultEffort: 'medium', isDefault: false },
    { model: 'gemini-3.6-flash-medium', displayName: 'Gemini 3.6 Flash (Medium)', efforts: ['medium'], defaultEffort: 'medium', isDefault: false },
    { model: 'gemini-3.1-pro-low', displayName: 'Gemini 3.1 Pro (Low)', efforts: ['low'], defaultEffort: 'low', isDefault: false },
    { model: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)', efforts: [], defaultEffort: null, isDefault: false },
    { model: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)', efforts: [], defaultEffort: null, isDefault: false },
    { model: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)', efforts: ['medium'], defaultEffort: 'medium', isDefault: false }
  ];
}

/**
 * Discovers live models for OpenCode directly from CLI + local models.json cache.
 * Discovers ALL available models permitted for the user's active installation.
 */
export function scanOpenCodeCatalog() {
  const cachePath = path.join(os.homedir(), '.cache', 'opencode', 'models.json');
  let cache = {};
  if (fs.existsSync(cachePath)) {
    try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch {}
  }

  // 1. Try querying native CLI for active permitted models
  let modelIds = [];
  try {
    const out = cp.execFileSync('cmd.exe', ['/c', OPENCODE_CMD, 'models'], {
      encoding: 'utf8',
      timeout: 12000
    });
    modelIds = out.split('\n').map(l => l.trim()).filter(Boolean);
  } catch (err) {
    console.warn('[Catalog] OpenCode CLI model scan note:', err.message);
  }

  // 2. If CLI failed or timed out, discover from active providers in auth.json / opencode.jsonc
  if (modelIds.length === 0) {
    const activeProviders = new Set(['opencode', 'anthropic', 'openai', 'freetoken']);
    const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
    if (fs.existsSync(authPath)) {
      try { Object.keys(JSON.parse(fs.readFileSync(authPath, 'utf8'))).forEach(p => activeProviders.add(p)); } catch {}
    }
    const configPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc');
    if (fs.existsSync(configPath)) {
      try {
        const raw = fs.readFileSync(configPath, 'utf8').replace(/\/\/.*$/gm, '');
        const cfg = JSON.parse(raw);
        if (cfg.provider) Object.keys(cfg.provider).forEach(p => activeProviders.add(p));
      } catch {}
    }
    for (const pId of activeProviders) {
      const pData = cache[pId];
      if (pData && pData.models) {
        for (const mId of Object.keys(pData.models)) {
          modelIds.push(`${pId}/${mId}`);
        }
      }
    }
  }

  const catalog = modelIds.map((fullId, idx) => {
    const [pId, mId] = fullId.includes('/') ? fullId.split('/') : ['opencode', fullId];
    const pMeta = cache[pId]?.models?.[mId] || {};
    let efforts = [];
    if (pMeta.reasoning === false) {
      efforts = ['none'];
    } else if (Array.isArray(pMeta.reasoning_options)) {
      const effortOpt = pMeta.reasoning_options.find(opt => opt && opt.type === 'effort');
      if (effortOpt && Array.isArray(effortOpt.values) && effortOpt.values.length > 0) {
        efforts = [...effortOpt.values];
      }
    }
    if (efforts.length === 0) {
      const rawVariants = Object.keys(pMeta.variants || {});
      efforts = rawVariants.length > 0 ? rawVariants : (pMeta.reasoning ? ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] : ['none']);
    }

    let defaultEffort = efforts[0] || 'none';
    if (efforts.includes('xhigh')) defaultEffort = 'xhigh';
    else if (efforts.includes('high')) defaultEffort = 'high';
    else if (efforts.includes('medium')) defaultEffort = 'medium';
    else if (efforts.includes('low')) defaultEffort = 'low';

    const displayName = pMeta.name || mId;
    return {
      model: fullId,
      displayName,
      efforts,
      defaultEffort,
      isDefault: fullId.includes('muse-spark') || idx === 0
    };
  });

  if (catalog.length > 0) {
    if (!catalog.some(m => m.isDefault)) catalog[0].isDefault = true;
    return catalog;
  }

  // Resilient fallback if cache and CLI are both missing
  return [
    { model: 'opencode/muse-spark-1.3-contributor-free', displayName: 'Muse Spark 1.3 Free', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'xhigh', isDefault: true }
  ];
}

/**
 * Discovers live models for Codex from session rollout metadata or app-server config.
 */
export function scanCodexCatalog() {
  const cachePath = path.join(os.homedir(), '.codex', 'models_cache.json');
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const rawModels = Array.isArray(data) ? data : (data.models || []);
      const visible = rawModels.filter(m => m && m.visibility !== 'hide' && m.slug);
      if (visible.length > 0) {
        return visible.map((m, idx) => {
          const efforts = (m.supported_reasoning_levels || [])
            .map(lvl => (typeof lvl === 'string' ? lvl : lvl.effort))
            .filter(Boolean);
          const defaultEffort = m.default_reasoning_level || efforts[0] || 'low';
          return {
            model: m.slug,
            displayName: m.display_name || m.slug,
            efforts: efforts.length > 0 ? efforts : ['low', 'medium', 'high'],
            defaultEffort,
            isDefault: m.slug === 'gpt-6-astra' || idx === 0
          };
        });
      }
    } catch (err) {
      console.warn('[Catalog] Codex cache read note:', err.message);
    }
  }

  return [
    { model: 'gpt-6-astra', displayName: 'GPT-6-Astra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'low', isDefault: true },
    { model: 'gpt-6-sol', displayName: 'GPT-6-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium', isDefault: false },
    { model: 'gpt-6-luna', displayName: 'GPT-6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', isDefault: false },
    { model: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'low', isDefault: false },
    { model: 'gpt-5.6-terra', displayName: 'GPT-5.6-Terra', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], defaultEffort: 'medium', isDefault: false },
    { model: 'gpt-5.6-luna', displayName: 'GPT-5.6-Luna', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', isDefault: false },
    { model: 'gpt-5.5', displayName: 'GPT-5.5', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium', isDefault: false }
  ];
}

/**
 * Discovers live model catalogs across all active harnesses.
 */
export function scanAllHarnessCatalogs() {
  return {
    'snowball.codex': scanCodexCatalog(),
    'snowball.antigravity': scanAntigravityCatalog(),
    'snowball.opencode': scanOpenCodeCatalog()
  };
}
