/** Host owns destination/draft state; platform workers own native audio capture. */
export interface NativeVoiceProvider {
  start(captureId: string): Promise<void>;
  finish(captureId: string): Promise<string>;
  cancel(captureId: string): Promise<void>;
  close(): void;
}
