import { createRequire } from 'node:module';

export interface HidDescriptor {
  path: string; vendorId: number; productId: number; release: number;
  interface: number; usagePage: number; usage: number;
  serialNumber?: string; product?: string;
}
/** Read-only surface deliberately has no write/feature-report/shell operation. */
export interface HidHandle {
  info(): Promise<HidDescriptor>;
  onData(callback: (data: Buffer) => void): void;
  onError(callback: (error: unknown) => void): void;
  close(): Promise<void>;
}
export interface HidBackend {
  enumerate(vendorId: number, productId: number): Promise<HidDescriptor[]>;
  open(path: string): Promise<HidHandle>;
}
interface NativeHandle {
  getDeviceInfo(): Promise<HidDescriptor>;
  on(event: string, cb: (...args: any[]) => void): void;
  removeAllListeners(event: string): void;
  pause(): void; close(): Promise<void>;
}
interface NativeHid {
  devicesAsync(vendorId: number, productId: number): Promise<HidDescriptor[]>;
  HIDAsync: { open(path: string, options: { nonExclusive: boolean }): Promise<NativeHandle> };
}
/** Invoke only within the isolated plugin worker, after explicit start. */
export function loadNativeBackend(): HidBackend {
  const hid = createRequire(import.meta.url)('node-hid') as NativeHid;
  return {
    enumerate: (vendorId, productId) => hid.devicesAsync(vendorId, productId),
    async open(path) {
      const handle = await hid.HIDAsync.open(path, { nonExclusive: true });
      // Native errors may occur before the caller installs its handler.
      let earlyError: unknown; let receiveError: ((error: unknown) => void) | undefined;
      handle.on('error', error => { if (receiveError) receiveError(error); else earlyError = error; });
      return {
        info: () => handle.getDeviceInfo(),
        onData(callback) { handle.on('data', callback); },
        onError(callback) { receiveError = callback; if (earlyError) callback(earlyError); },
        async close() { handle.pause(); handle.removeAllListeners('data'); await handle.close(); },
      };
    },
  };
}
