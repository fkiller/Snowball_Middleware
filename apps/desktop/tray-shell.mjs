import { EventEmitter } from 'node:events';

/**
 * Tray-only desktop shell for Snowball Middleware.
 * Never creates a native main window; all configuration and supervision
 * happens in the user's default browser via same-origin loopback API.
 */
export class TrayShell extends EventEmitter {
  /** Explicitly enforces that no native main window is created on startup. */
  get hasMainWindow() {
    return false;
  }

  _status = 'ready'; // 'ready' | 'paused' | 'attention' | 'degraded'
  _isSingleInstance = true;

  constructor(options = {}) {
    super();
    this.options = options;
  }

  get status() {
    return this._status;
  }

  get isSingleInstance() {
    return this._isSingleInstance;
  }

  /** Update status based on API settings / health. */
  updateStatus(newStatus) {
    if (this._status !== newStatus) {
      this._status = newStatus;
      this.emit('statusChanged', this._status);
    }
  }

  /**
   * Generates the tray context menu structure according to packaging specs:
   * 1. Status header
   * 2. Open Supervisor
   * 3. Pause / Resume control commands
   * 4. Settings...
   * 5. Diagnostics...
   * 6. Quit Middleware...
   */
  getMenuItems(controlPaused = false) {
    return [
      {
        id: 'status',
        label: `Snowball · ${this._status === 'paused' ? '연결 일시중지' : this._status === 'attention' ? '확인 필요' : '연결됨'}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        id: 'open-supervisor',
        label: 'Supervisor 열기',
        action: () => this.emit('openSupervisor'),
      },
      {
        id: 'toggle-pause',
        label: controlPaused ? '제어 명령 재개' : '제어 명령 일시중지',
        action: () => this.emit('togglePause', !controlPaused),
      },
      { type: 'separator' },
      {
        id: 'open-settings',
        label: '설정…',
        action: () => this.emit('openSettings'),
      },
      {
        id: 'open-diagnostics',
        label: '진단…',
        action: () => this.emit('openDiagnostics'),
      },
      { type: 'separator' },
      {
        id: 'quit',
        label: '미들웨어 종료…',
        action: () => this.emit('quit'),
      },
    ];
  }

  /**
   * Reports the exact scope affected by quitting the middleware.
   * Truthfully distinguishes stopping local runtime from preserved external harnesses.
   */
  getQuitScope(activeCommandsCount = 0) {
    return {
      stoppingProcesses: ['snowball-middleware-runtime'],
      externalProcessesPreserved: ['codex', 'antigravity', 'opencode'],
      activeCommandsCount,
      notice: '미들웨어 종료 시: 로컬 리스너가 닫히고 새 제어 명령이 중단되지만, 외부에서 실행 중인 Codex/Harness 프로세스는 임의 종료되지 않습니다.',
    };
  }
}
