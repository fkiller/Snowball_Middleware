/**
 * Wire protocol between Snowball Control Host and MK20 Device over UDP (Port 7701)
 */

export interface DeviceInputPacket {
  type: "key" | "knob_left" | "knob_right" | "ping";
  keyId?: number;     // 1..20
  isDown?: boolean;   // true = press, false = release
  delta?: number;     // -1 CCW, +1 CW
  isClick?: boolean;  // 1 if push button
  seq?: number;
}

export interface HostKeySync {
  id: number;          // 1..20
  top: string;         // Max 16 chars
  main: string;        // Max 24 chars
  sub?: string;        // Max 24 chars
  flags: number;       // bit 0: filled (selected), bit 1: editing (amber), bit 2: focused, bit 3: disabled, bit 4: list, bit 5: lines
  items?: string[];
  colors?: number[];
  activeItem?: number;
}

export const KEY_FLAG_FILLED   = (1 << 0);
export const KEY_FLAG_EDITING  = (1 << 1);
export const KEY_FLAG_FOCUSED  = (1 << 2);
export const KEY_FLAG_DISABLED = (1 << 3);
export const KEY_FLAG_LIST     = (1 << 4);
export const KEY_FLAG_LINES    = (1 << 5);

export interface HostSyncPacket {
  type: "v2_sync";
  seq: number;
  viewMode: string;
  topTitle: string;
  topSubtitle: string;
  topBody: string;     // Multi-line conversation text or file text
  topScroll: number;   // Active scroll line index
  topTotalLines?: number; // Total document lines for scrollbar tracking
  volume: number;      // 0..100
  isMuted: boolean;
  keys: HostKeySync[];
}
