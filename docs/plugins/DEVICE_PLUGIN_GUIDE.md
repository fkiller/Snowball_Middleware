# DEVICE PLUGIN GUIDE (디바이스 플러그인 표준 및 개발 가이드)

## 1. 개요 및 목적
디바이스 플러그인(Device Plugin)은 물리적 하드웨어 콘솔(예: MK20, Stream Deck, Loupedeck 등) 또는 가상 터미널을 Snowball 미들웨어에 연결하여, **입력 이벤트(키, 노브, 터치)를 수신**하고 **출력 디스플레이(LCD 키, 메인 HUD 등)에 UI를 렌더링**하는 어댑터입니다.

---

## 2. 디바이스 플러그인 인터페이스 및 라이프사이클

모든 디바이스 플러그인은 다음의 표준 라이프사이클을 준수해야 합니다:

```typescript
export interface DevicePlugin {
  readonly id: string;           // 고유 식별자 (예: 'device.mk20', 'device.streamdeck')
  readonly name: string;         // 표시 이름
  readonly transportType: 'lan-udp' | 'usb-hid' | 'usb-cdc' | 'virtual';

  /** 기기 감지 및 초기 연결 시도 */
  probe(options?: DeviceProbeOptions): Promise<DeviceProbeResult>;

  /** 연결 수립 및 이벤트 리스너 등록 */
  connect(): Promise<void>;

  /** 연결 해제 및 리소스 정리 */
  disconnect(): Promise<void>;

  /** 디바이스 상태 전송 (LCD 화면 갱신 데이터) */
  render(state: DeviceDisplayState): Promise<void>;

  /** 사용자 입력 이벤트 구독 */
  onInput(callback: (event: DeviceInputEvent) => void): void;
}
```

### 라이프사이클 단계
1. **Probe (탐색)**: 로컬 LAN 브로드캐스트(UDP), USB 디바이스 열거(VID/PID), 직렬 COM 포트 탐색을 통해 지원 기기가 연결되어 있는지 확인합니다.
2. **Connect (연결)**: 소켓 바인딩 또는 HID 핸들을 오픈하고, 기기의 초기화 패킷(해상도, 펌웨어 버전 등)을 교환합니다.
3. **Event Loop (이벤트 루프)**:
   - 기기 -> 미들웨어: 키 눌림/뗌(`keydown`, `keyup`), 노브 회전(`knob`), 터치 제스처를 `DeviceInputEvent` 표준 규격으로 변환하여 `onInput` 콜백으로 방출합니다.
   - 미들웨어 -> 기기: `ContextManager`가 생성한 20개 키 화면 및 메인 HUD 프레임버퍼를 기기 프로토콜 데이터그램으로 패킹하여 전송합니다.
4. **Disconnect (해제)**: 기기 분리 또는 미들웨어 종료 시 소켓 및 핸들을 안전하게 닫고 화면을 기본 대기 모드로 복귀시킵니다.

---

## 3. 디스플레이 렌더링 규격 (Wire Format)

### MK20 기준 와이어 포맷 (`plugins/device-mk20`)
- **Key Matrix LCD (K1 ~ K20)**:
  - 128x128 픽셀 RGB565 (16-bit) 포맷.
  - 패킷 헤더: `[KeyId (1B)][Flags (1B)][Width (2B)][Height (2B)][Payload...]`.
  - 플래그: `KEY_FLAG_FILLED (1)`, `KEY_FLAG_FOCUSED (2)`, `KEY_FLAG_DISABLED (8)`, `KEY_FLAG_LIST (16)`.
- **Top HUD Display (fb21)**:
  - 400x120 픽셀 RGB565 또는 분할 청크 전송.
  - 헤더 2줄(기기/하네스/볼륨 정보, 프로젝트/세션 정보), 본문 4줄(텍스트 스트림).

---

## 4. 신규 디바이스 플러그인 개발 튜토리얼 (Step-by-Step)

새로운 하드웨어(예: `Stream Deck MK.2`) 플러그인을 추가하는 예시입니다:

### 1단계: 플러그인 매니페스트 작성 (`package.json`)
```json
{
  "name": "@snowball/device-streamdeck",
  "version": "0.1.0",
  "main": "./dist/index.js",
  "snowball": {
    "type": "device",
    "supportedVidPid": [
      { "vid": "0x0fd9", "pid": "0x0080" }
    ]
  }
}
```

### 2단계: 어댑터 클래스 구현
```typescript
import { DevicePlugin, DeviceDisplayState, DeviceInputEvent } from '@snowball/plugin-sdk';
import { openStreamDeck } from 'streamdeck-sdk'; // 예시 HID 드라이버

export class StreamDeckPlugin implements DevicePlugin {
  readonly id = 'device.streamdeck';
  readonly name = 'Elgato Stream Deck';
  readonly transportType = 'usb-hid';
  private deck: any = null;
  private inputCallback?: (event: DeviceInputEvent) => void;

  async probe() {
    // HID 열거를 통해 기기 존재 여부 확인
    return { status: 'supported', available: true };
  }

  async connect() {
    this.deck = await openStreamDeck();
    this.deck.on('down', (keyIndex: number) => {
      this.inputCallback?.({
        type: 'keydown',
        keyId: keyIndex + 1,
        timestamp: Date.now()
      });
    });
  }

  async render(state: DeviceDisplayState) {
    // ContextManager의 128x128 픽셀 버퍼를 StreamDeck 규격(72x72 또는 96x96 JPEG/BMP)으로 리사이즈 및 전송
    for (const key of state.keys) {
      if (key.imageBuffer) {
        await this.deck.fillKeyBuffer(key.keyId - 1, key.imageBuffer);
      }
    }
  }

  async disconnect() {
    if (this.deck) {
      await this.deck.clearAllKeys();
      await this.deck.close();
    }
  }

  onInput(callback: (event: DeviceInputEvent) => void) {
    this.inputCallback = callback;
  }
}
```

### 3단계: 미들웨어 디바이스 레지스트리 등록
`scripts/start-all.mjs`의 `deviceRegistry`에 해당 플러그인을 주입하여 기기 연결 즉시 통합 제어를 수행합니다.
