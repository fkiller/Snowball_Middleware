export const labels = language => language === 'en' ? {
  starting: 'Starting local control…', degraded: 'Connection degraded', paused: 'Control paused', attention: 'Needs attention', connected: 'Connected',
  open: 'Open Supervisor', resume: 'Resume control', pause: 'Pause control', autostart: 'Start at login',
  settings: 'Settings…', diagnostics: 'Diagnostics…', state: 'Local control status', quit: 'Quit middleware', guide: 'Getting started…',
  connectCodex: 'Connect Codex CLI…', connectSuccess: 'Codex CLI connected. Open Supervisor to select a task.',
  connectFailed: 'Codex CLI connection failed. Check the selected version, login, paths and private state.',
  notification: 'A task needs your attention. Open Supervisor to review it.',
} : {
  starting: '로컬 제어 시작 중…', degraded: '연결 저하', paused: '제어 일시중지', attention: '확인 필요', connected: '연결됨',
  open: 'Supervisor 열기', resume: '제어 명령 재개', pause: '제어 명령 일시중지', autostart: '로그인 시 자동 실행',
  settings: '설정…', diagnostics: '진단…', state: '로컬 제어 상태', quit: '미들웨어 종료', guide: '시작하기…',
  connectCodex: 'Codex CLI 연결…', connectSuccess: 'Codex CLI가 연결됐습니다. Supervisor에서 작업을 선택하세요.',
  connectFailed: 'Codex CLI 연결에 실패했습니다. 선택한 버전, 로그인, 경로와 비공개 상태를 확인하세요.',
  notification: '확인이 필요한 작업이 있습니다. Supervisor에서 검토하세요.',
};

// This is guidance, not a claim that a phone or device has been discovered.
export function desktopJourneyGuide(language, deviceSetupAvailable) {
  return language === 'en' ? {
    message: 'Use Snowball on this computer',
    detail: [
      'Open Supervisor from the tray and connect a supported harness on this computer.',
      deviceSetupAvailable ? 'Optional hardware: choose Device setup in the tray to inspect and pair a supported device.' : 'Optional hardware: device setup is not currently available in this installation.',
      'Optional phone: secure Snowball Remote pairing is still in development.',
      'Other computers run their own Snowball installation. Unified control across computers is not yet available.',
    ].join('\n\n'),
  } : {
    message: '이 컴퓨터에서 Snowball 사용하기',
    detail: [
      '트레이에서 Supervisor를 열고 이 컴퓨터의 지원 하네스를 연결하세요.',
      deviceSetupAvailable ? '선택 사항인 하드웨어는 트레이의 기기 설정에서 확인하고 페어링할 수 있습니다.' : '선택 사항인 하드웨어의 기기 설정은 현재 이 설치에서 사용할 수 없습니다.',
      '선택 사항인 휴대폰의 안전한 Snowball Remote 페어링은 개발 중입니다.',
      '다른 컴퓨터에서는 각자의 Snowball을 실행합니다. 여러 컴퓨터의 통합 제어는 아직 제공되지 않습니다.',
    ].join('\n\n'),
  };
}

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
