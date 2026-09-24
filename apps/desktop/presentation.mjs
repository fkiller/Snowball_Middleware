export const labels = language => language === 'en' ? {
  degraded: 'Connection degraded', paused: 'Control paused', attention: 'Needs attention', connected: 'Connected',
  open: 'Open Supervisor', resume: 'Resume control', pause: 'Pause control', autostart: 'Start at login',
  settings: 'Settings…', diagnostics: 'Diagnostics…', state: 'Local control status', quit: 'Quit middleware',
  connectCodex: 'Connect Codex CLI…', connectSuccess: 'Codex CLI connected. Open Supervisor to select a task.',
  connectFailed: 'Codex CLI connection failed. Check the selected version, login, paths and private state.',
  notification: 'A task needs your attention. Open Supervisor to review it.',
} : {
  degraded: '연결 저하', paused: '제어 일시중지', attention: '확인 필요', connected: '연결됨',
  open: 'Supervisor 열기', resume: '제어 명령 재개', pause: '제어 명령 일시중지', autostart: '로그인 시 자동 실행',
  settings: '설정…', diagnostics: '진단…', state: '로컬 제어 상태', quit: '미들웨어 종료',
  connectCodex: 'Codex CLI 연결…', connectSuccess: 'Codex CLI가 연결됐습니다. Supervisor에서 작업을 선택하세요.',
  connectFailed: 'Codex CLI 연결에 실패했습니다. 선택한 버전, 로그인, 경로와 비공개 상태를 확인하세요.',
  notification: '확인이 필요한 작업이 있습니다. Supervisor에서 검토하세요.',
};

/** Notify only on newly observed attention, without disclosing task content to the OS. */
export class AttentionNotifications {
  #previous;
  update(snapshot) {
    const current = new Set([
      ...(snapshot.decisions ?? []).filter(d => d.status === 'pending').map(d => `decision:${d.decisionId}`),
      ...(snapshot.commands ?? []).filter(c => ['unknown', 'failed'].includes(c.status)).map(c => `command:${c.commandId}:${c.status}`),
    ].slice(0, 2048));
    const notify = this.#previous !== undefined && snapshot.settings?.notifications === true && [...current].some(key => !this.#previous.has(key));
    this.#previous = current;
    return notify;
  }
}
