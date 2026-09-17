import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioTransport } from '../dist/audio/transport.js';

test('pcm3chToMonoWav correctly extracts Channel 3 into valid 16kHz mono WAV', () => {
  // Synthesize 100 frames of 3-channel 16-bit PCM (6 bytes per sample frame)
  const nFrames = 100;
  const raw3ch = Buffer.alloc(nFrames * 6);

  for (let i = 0; i < nFrames; i++) {
    // Channel 1 (index 0, 1) = 0x1111
    raw3ch.writeInt16LE(0x1111, i * 6);
    // Channel 2 (index 2, 3) = 0x2222
    raw3ch.writeInt16LE(0x2222, i * 6 + 2);
    // Channel 3 (index 4, 5) = (i * 10) & 0x7FFF (variable physical mic signal)
    raw3ch.writeInt16LE((i * 10) & 0x7fff, i * 6 + 4);
  }

  const wav = AudioTransport.pcm3chToMonoWav(raw3ch);

  // WAV header validations
  assert.equal(wav.toString('utf-8', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), 36 + nFrames * 2);
  assert.equal(wav.toString('utf-8', 8, 12), 'WAVE');
  assert.equal(wav.toString('utf-8', 12, 16), 'fmt ');
  assert.equal(wav.readUInt32LE(16), 16); // Subchunk1Size
  assert.equal(wav.readUInt16LE(20), 1);  // AudioFormat (PCM)
  assert.equal(wav.readUInt16LE(22), 1);  // NumChannels (1 = Mono)
  assert.equal(wav.readUInt32LE(24), 16000); // SampleRate
  assert.equal(wav.readUInt32LE(28), 32000); // ByteRate (16000 * 1 * 2)
  assert.equal(wav.readUInt16LE(32), 2);  // BlockAlign
  assert.equal(wav.readUInt16LE(34), 16); // BitsPerSample
  assert.equal(wav.toString('utf-8', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), nFrames * 2); // DataSize

  // Validate extracted audio payload matches Channel 3
  for (let i = 0; i < nFrames; i++) {
    const val = wav.readInt16LE(44 + i * 2);
    const expected = (i * 10) & 0x7fff;
    assert.equal(val, expected, `Sample ${i} mismatch`);
  }
});
