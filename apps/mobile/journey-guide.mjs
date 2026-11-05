// Copy for the currently disabled mobile connection path. It describes the
// prerequisites without claiming that store releases or pairing exist.
export function remoteJourneyGuide(locale) {
  const english = typeof locale === 'string' && locale.toLowerCase().startsWith('en');
  return english ? {
    title: 'Connect to your computer',
    intro: 'Snowball Remote needs Snowball running on your own Windows PC or Mac.',
    steps: [
      '1. Install and start Snowball on the computer you want to use. Store distribution is still in preparation.',
      '2. Use Snowball locally on that computer. A hardware device is optional.',
      '3. Secure phone pairing is still in development. You cannot connect this app yet.',
    ],
    notice: 'No credentials are sent while gateway identity verification is unavailable. Local computer control remains separate.',
    forget: 'Delete previously saved connection information',
    forgetDone: 'Connection information was deleted from this device. Revoke the credential on the computer as well.',
    forgetFailed: 'Could not delete connection information from secure storage. Try again.',
    loadFailed: 'Could not read saved connection information.',
    storageFailed: 'Could not open secure storage.',
  } : {
    title: '내 컴퓨터에 연결',
    intro: 'Snowball Remote를 사용하려면 내 Windows PC 또는 Mac에서 Snowball이 실행 중이어야 합니다.',
    steps: [
      '1. 사용하려는 컴퓨터에 Snowball을 설치하고 실행합니다. 스토어 배포는 아직 준비 중입니다.',
      '2. 컴퓨터에서 Snowball을 로컬로 사용합니다. 하드웨어 기기는 선택 사항입니다.',
      '3. 안전한 휴대폰 페어링은 개발 중이므로 이 앱은 아직 연결할 수 없습니다.',
    ],
    notice: '게이트웨이 신원을 확인할 수 있을 때까지 자격증명을 전송하지 않습니다. 컴퓨터의 로컬 제어는 별도로 사용할 수 있습니다.',
    forget: '이전에 저장한 연결 정보 삭제',
    forgetDone: '이 기기의 저장된 연결 정보를 삭제했습니다. PC에서 자격증명도 철회하세요.',
    forgetFailed: '보안 저장소에서 연결 정보를 삭제하지 못했습니다. 다시 시도해 주세요.',
    loadFailed: '저장된 연결 정보를 읽을 수 없습니다.',
    storageFailed: '보안 저장소를 열 수 없습니다.',
  };
}
