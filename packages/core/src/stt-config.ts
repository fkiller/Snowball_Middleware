import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveUserDataDir } from './identity.js';

export interface SttConfig {
  min_model: string;
  max_model: string;
  exclude: string[];
  download_dir?: string | null;
  quantization?: string;
  cpu_threads?: number | null;
  _source?: string;
}

export const STT_MODEL_LADDER = ['tiny', 'base', 'small', 'medium', 'large-v3-turbo'] as const;
export type SttModelName = typeof STT_MODEL_LADDER[number];

export const DEFAULT_STT_CONFIG: SttConfig = {
  min_model: 'small',
  max_model: 'large-v3-turbo',
  exclude: ['medium'],
  download_dir: null,
  quantization: 'int8',
  _source: 'built-in default',
};

export function normalizeSttModelName(name?: string): string {
  if (!name) return 'small';
  let clean = String(name).toLowerCase().trim();
  if (clean.endsWith('-cpu')) clean = clean.slice(0, -4);
  return clean;
}

/**
 * Loads STT configuration in priority order:
 * 1. customPath if specified
 * 2. SNOWBALL_STT_CONFIG environment variable
 * 3. userDataDir/config/stt.json or userDataDir/stt.json
 * 4. Application root config/stt.json
 * 5. Built-in defaults (floor: small, max: large-v3-turbo, exclude: [medium])
 */
export function loadSttConfig(customPath?: string, userDataDir?: string): SttConfig {
  const candidates: string[] = [];

  if (customPath) candidates.push(customPath);
  if (process.env.SNOWBALL_STT_CONFIG) candidates.push(process.env.SNOWBALL_STT_CONFIG);

  const uDir = userDataDir || resolveUserDataDir();
  candidates.push(path.join(uDir, 'config', 'stt.json'));
  candidates.push(path.join(uDir, 'stt.json'));

  // Project root candidates
  candidates.push(path.resolve(process.cwd(), 'config', 'stt.json'));
  candidates.push(path.resolve(process.cwd(), '..', 'config', 'stt.json'));

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const raw = fs.readFileSync(c, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          min_model: normalizeSttModelName(parsed.min_model || DEFAULT_STT_CONFIG.min_model),
          max_model: normalizeSttModelName(parsed.max_model || DEFAULT_STT_CONFIG.max_model),
          exclude: Array.isArray(parsed.exclude)
            ? parsed.exclude.map((m: string) => normalizeSttModelName(m))
            : DEFAULT_STT_CONFIG.exclude,
          download_dir: parsed.download_dir || null,
          quantization: parsed.quantization || DEFAULT_STT_CONFIG.quantization,
          cpu_threads: typeof parsed.cpu_threads === 'number' ? parsed.cpu_threads : null,
          _source: path.resolve(c),
        };
      } catch {}
    }
  }

  return { ...DEFAULT_STT_CONFIG };
}

/**
 * Resolves the managed models directory.
 * Defaults to `<userDataDir>/models`, guaranteeing clean deletion on full uninstall.
 */
export function resolveModelsDir(config?: SttConfig, userDataDir?: string): string {
  if (process.env.SNOWBALL_MODELS_DIR) {
    return path.resolve(process.env.SNOWBALL_MODELS_DIR);
  }
  if (config?.download_dir) {
    return path.resolve(config.download_dir);
  }
  const uDir = userDataDir || resolveUserDataDir();
  return path.join(uDir, 'models');
}

export interface SttModelSelectionResult {
  selectedModel: string;
  rawChoice: string;
  minModel: string;
  maxModel: string;
  exclude: string[];
  clampedByMin: boolean;
  clampedByMax: boolean;
  excludedApplied: boolean;
  note: string;
  reason: string;
  source: string;
}

/**
 * Resolves the optimal Whisper model given backend capability and hardware specs,
 * strictly honoring min_model (floor), max_model (ceiling), and exclude list.
 */
export function resolveSttModel(
  backend: 'metal' | 'cuda' | 'vulkan' | 'cpu' | string,
  hardware: { cores?: number; totalRamGb?: number; availRamGb?: number },
  config: SttConfig = DEFAULT_STT_CONFIG
): SttModelSelectionResult {
  const minModel = normalizeSttModelName(config.min_model || 'small');
  const maxModel = normalizeSttModelName(config.max_model || 'large-v3-turbo');
  const exclude = (config.exclude || ['medium']).map(normalizeSttModelName);

  const getRank = (m: string): number => {
    const idx = (STT_MODEL_LADDER as readonly string[]).indexOf(m);
    return idx >= 0 ? idx : 2; // default small
  };

  const minRank = getRank(minModel);
  const maxRank = getRank(maxModel);

  const cores = hardware.cores || os.cpus().length || 4;
  const availRam = typeof hardware.availRamGb === 'number'
    ? hardware.availRamGb
    : (os.freemem() / (1024 ** 3));

  // 1. Natural capability assessment
  let rawChoice: string;
  let reason: string;

  if (['metal', 'cuda', 'vulkan'].includes(backend.toLowerCase())) {
    rawChoice = 'large-v3-turbo';
    reason = `Hardware acceleration (${backend.toUpperCase()}) supports high-accuracy large-v3-turbo.`;
  } else {
    // CPU
    if (availRam >= 12.0 && cores >= 8) {
      rawChoice = 'large-v3-turbo';
      reason = `Workstation CPU (${cores} cores, ${availRam.toFixed(1)}GB RAM) capable of turbo execution.`;
    } else if (availRam >= 8.0 && cores >= 6) {
      rawChoice = 'medium';
      reason = `Mid-tier CPU (${cores} cores, ${availRam.toFixed(1)}GB RAM).`;
    } else if (availRam >= 4.0 && cores >= 4) {
      rawChoice = 'small';
      reason = `Standard quad-core CPU (${cores} cores, ${availRam.toFixed(1)}GB RAM).`;
    } else if (availRam >= 2.0) {
      rawChoice = 'base';
      reason = `Low-memory CPU (${availRam.toFixed(1)}GB RAM).`;
    } else {
      rawChoice = 'tiny';
      reason = `Constrained memory (<2GB RAM).`;
    }
  }

  const initialChoice = rawChoice;
  let rank = getRank(rawChoice);
  let clampedByMin = false;
  if (rank < minRank) {
    rank = minRank;
    rawChoice = STT_MODEL_LADDER[rank] ?? 'small';
    clampedByMin = true;
  }

  let clampedByMax = false;
  if (rank > maxRank) {
    rank = maxRank;
    rawChoice = STT_MODEL_LADDER[rank] ?? 'large-v3-turbo';
    clampedByMax = true;
  }

  let excludedApplied = false;
  if (exclude.includes(rawChoice)) {
    excludedApplied = true;
    let fallback: string | undefined;

    // Step down to nearest non-excluded candidate within [minRank, maxRank]
    for (let r = rank - 1; r >= minRank; r--) {
      const cand = STT_MODEL_LADDER[r];
      if (cand && !exclude.includes(cand)) {
        fallback = cand;
        break;
      }
    }
    if (!fallback) {
      // Step up if lower wasn't found
      for (let r = rank + 1; r <= maxRank; r++) {
        const cand = STT_MODEL_LADDER[r];
        if (cand && !exclude.includes(cand)) {
          fallback = cand;
          break;
        }
      }
    }
    rawChoice = fallback || minModel;
  }

  const notes: string[] = [];
  if (clampedByMin) notes.push(`Floor '${minModel}' enforced`);
  if (clampedByMax) notes.push(`Ceiling '${maxModel}' enforced`);
  if (excludedApplied) notes.push(`Excluded model bypassed in favor of '${rawChoice}'`);

  return {
    selectedModel: rawChoice,
    rawChoice: initialChoice,
    minModel,
    maxModel,
    exclude,
    clampedByMin,
    clampedByMax,
    excludedApplied,
    note: notes.length > 0 ? notes.join(', ') : 'Optimal',
    reason,
    source: config._source || 'default',
  };
}
