import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SUPPORTED_LANGUAGES = {
  ko: {
    id: 'ko',
    name: '한국어',
    nativeName: '한국어',
    locale: 'ko-KR',
    resources: {
      fontFamily: 'D2Coding, monospace',
      labels: {
        ready: '준비 완료',
        recording: '음성 녹음 중...',
        transcribing: '음성 인식 중...',
        speaking: '음성 출력 중...',
        stop: '중지',
      },
    },
    stt: {
      whisperCode: 'ko',
      supported: true,
      modelSuitability: 'multilingual',
    },
    tts: {
      engine: 'supertonic',
      langCode: 'ko',
      defaultVoice: 'F1',
      fallback: ['supertonic-gpu', 'supertonic-cpu', 'os-native'],
    },
  },
  en: {
    id: 'en',
    name: 'English',
    nativeName: 'English',
    locale: 'en-US',
    resources: {
      fontFamily: 'monospace',
      labels: {
        ready: 'Ready',
        recording: 'Recording...',
        transcribing: 'Transcribing...',
        speaking: 'Speaking...',
        stop: 'Stop',
      },
    },
    stt: {
      whisperCode: 'en',
      supported: true,
      modelSuitability: 'multilingual',
    },
    tts: {
      engine: 'supertonic',
      langCode: 'en',
      defaultVoice: 'F1',
      fallback: ['supertonic-gpu', 'supertonic-cpu', 'os-native'],
    },
  },
  ja: {
    id: 'ja',
    name: 'Japanese',
    nativeName: '日本語',
    locale: 'ja-JP',
    resources: {
      fontFamily: 'Noto Sans JP, monospace',
      labels: {
        ready: '準備完了',
        recording: '録音中...',
        transcribing: '認識中...',
        speaking: '発話中...',
        stop: '停止',
      },
    },
    stt: {
      whisperCode: 'ja',
      supported: true,
      modelSuitability: 'multilingual',
    },
    tts: {
      engine: 'supertonic',
      langCode: 'ja',
      defaultVoice: 'F1',
      fallback: ['supertonic-gpu', 'supertonic-cpu', 'os-native'],
    },
  },
  zh: {
    id: 'zh',
    name: 'Chinese',
    nativeName: '中文',
    locale: 'zh-CN',
    resources: {
      fontFamily: 'Noto Sans SC, monospace',
      labels: {
        ready: '就绪',
        recording: '录音中...',
        transcribing: '识别中...',
        speaking: '播放中...',
        stop: '停止',
      },
    },
    stt: {
      whisperCode: 'zh',
      supported: true,
      modelSuitability: 'multilingual',
    },
    tts: {
      engine: 'supertonic',
      langCode: 'zh',
      defaultVoice: 'F1',
      fallback: ['supertonic-gpu', 'supertonic-cpu', 'os-native'],
    },
  },
};

export class LanguageManager {
  constructor(stateDir = path.resolve(__dirname, '../.state')) {
    this.stateDir = stateDir;
    this.configFile = path.join(this.stateDir, 'languages.json');
    this.state = this.loadState();
  }

  /**
   * Detect operating system UI / display culture.
   */
  detectOsLanguage() {
    try {
      if (process.platform === 'win32') {
        const out = execSync(
          'powershell -NoProfile -NonInteractive -Command "(Get-Culture).Name"',
          { encoding: 'utf-8', timeout: 3000 }
        ).trim();
        return out || 'ko-KR';
      }
      const envLang = process.env.LANG || process.env.LC_ALL || '';
      if (envLang.includes('ko')) return 'ko-KR';
      if (envLang.includes('ja')) return 'ja-JP';
      if (envLang.includes('zh')) return 'zh-CN';
      return 'en-US';
    } catch {
      return 'ko-KR';
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.configFile)) {
        const raw = JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
        if (raw.primary && Array.isArray(raw.enabled)) {
          return raw;
        }
      }
    } catch {}

    const osCulture = this.detectOsLanguage();
    const primaryId = osCulture.startsWith('ko') ? 'ko' : 'en';
    const enabled = primaryId === 'ko' ? ['ko', 'en'] : ['en', 'ko'];

    const initialState = {
      primary: primaryId,
      enabled,
      autoDetect: true,
      osDetected: osCulture,
      updatedAt: new Date().toISOString(),
    };
    this.saveState(initialState);
    return initialState;
  }

  saveState(state = this.state) {
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      fs.writeFileSync(this.configFile, JSON.stringify(state, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[LanguageManager] Failed to persist state:', err.message);
    }
  }

  getPrimaryLanguage() {
    const p = this.state.primary || 'ko';
    return SUPPORTED_LANGUAGES[p] || SUPPORTED_LANGUAGES.ko;
  }

  getActiveLanguages() {
    return this.state.enabled
      .map((id) => SUPPORTED_LANGUAGES[id])
      .filter(Boolean);
  }

  getAllSupportedLanguages() {
    return Object.values(SUPPORTED_LANGUAGES);
  }

  getStatus() {
    return {
      primary: this.getPrimaryLanguage(),
      enabled: this.getActiveLanguages(),
      supported: this.getAllSupportedLanguages(),
      osDetected: this.state.osDetected,
      autoDetect: this.state.autoDetect,
    };
  }

  setPrimaryLanguage(langId) {
    const norm = langId.toLowerCase();
    if (!SUPPORTED_LANGUAGES[norm]) {
      throw new Error(`Unsupported language code: ${langId}`);
    }
    if (!this.state.enabled.includes(norm)) {
      this.state.enabled.push(norm);
    }
    this.state.primary = norm;
    this.state.updatedAt = new Date().toISOString();
    this.saveState();
    return this.getStatus();
  }

  async addLanguage(langId) {
    const norm = langId.toLowerCase();
    if (!SUPPORTED_LANGUAGES[norm]) {
      throw new Error(`Unsupported language code: ${langId}. Available: ${Object.keys(SUPPORTED_LANGUAGES).join(', ')}`);
    }
    if (!this.state.enabled.includes(norm)) {
      this.state.enabled.push(norm);
      this.state.updatedAt = new Date().toISOString();
      this.saveState();
    }
    return this.getStatus();
  }

  async removeLanguage(langId) {
    const norm = langId.toLowerCase();
    if (this.state.primary === norm) {
      throw new Error(`Cannot remove primary language '${norm}'. Change primary language before removing.`);
    }
    this.state.enabled = this.state.enabled.filter((id) => id !== norm);
    this.state.updatedAt = new Date().toISOString();
    this.saveState();
    return this.getStatus();
  }
}

export const languageManager = new LanguageManager();
