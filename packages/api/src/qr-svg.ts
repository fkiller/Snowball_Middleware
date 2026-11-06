/**
 * Zero-dependency ISO/IEC 18004 QR Code (Byte Mode, Error Correction Level L)
 * SVG renderer for short-lived pairing invitations.
 */

interface VersionSpec {
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  blocksGroup1: number;
  dataCodewordsGroup1: number;
  blocksGroup2: number;
  dataCodewordsGroup2: number;
  alignment: number[];
}

// ISO/IEC 18004 Table 9 (EC Level L) + Table E.1 alignment locations for Versions 1..15
const VERSION_SPECS: readonly VersionSpec[] = [
  { totalCodewords: 0, ecCodewordsPerBlock: 0, blocksGroup1: 0, dataCodewordsGroup1: 0, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [] },
  { totalCodewords: 26, ecCodewordsPerBlock: 7, blocksGroup1: 1, dataCodewordsGroup1: 19, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [] },
  { totalCodewords: 44, ecCodewordsPerBlock: 10, blocksGroup1: 1, dataCodewordsGroup1: 34, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 18] },
  { totalCodewords: 70, ecCodewordsPerBlock: 15, blocksGroup1: 1, dataCodewordsGroup1: 55, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 22] },
  { totalCodewords: 100, ecCodewordsPerBlock: 20, blocksGroup1: 1, dataCodewordsGroup1: 80, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 26] },
  { totalCodewords: 134, ecCodewordsPerBlock: 26, blocksGroup1: 1, dataCodewordsGroup1: 108, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 30] },
  { totalCodewords: 172, ecCodewordsPerBlock: 18, blocksGroup1: 2, dataCodewordsGroup1: 68, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 34] },
  { totalCodewords: 196, ecCodewordsPerBlock: 20, blocksGroup1: 2, dataCodewordsGroup1: 78, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 22, 38] },
  { totalCodewords: 242, ecCodewordsPerBlock: 24, blocksGroup1: 2, dataCodewordsGroup1: 97, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 24, 42] },
  { totalCodewords: 292, ecCodewordsPerBlock: 30, blocksGroup1: 2, dataCodewordsGroup1: 116, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 26, 46] },
  { totalCodewords: 346, ecCodewordsPerBlock: 18, blocksGroup1: 2, dataCodewordsGroup1: 68, blocksGroup2: 2, dataCodewordsGroup2: 69, alignment: [6, 28, 50] },
  { totalCodewords: 404, ecCodewordsPerBlock: 20, blocksGroup1: 4, dataCodewordsGroup1: 81, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 30, 54] },
  { totalCodewords: 466, ecCodewordsPerBlock: 24, blocksGroup1: 2, dataCodewordsGroup1: 92, blocksGroup2: 2, dataCodewordsGroup2: 93, alignment: [6, 32, 58] },
  { totalCodewords: 532, ecCodewordsPerBlock: 26, blocksGroup1: 4, dataCodewordsGroup1: 107, blocksGroup2: 0, dataCodewordsGroup2: 0, alignment: [6, 34, 62] },
  { totalCodewords: 581, ecCodewordsPerBlock: 30, blocksGroup1: 3, dataCodewordsGroup1: 115, blocksGroup2: 1, dataCodewordsGroup2: 116, alignment: [6, 26, 46, 66] },
  { totalCodewords: 655, ecCodewordsPerBlock: 22, blocksGroup1: 5, dataCodewordsGroup1: 87, blocksGroup2: 1, dataCodewordsGroup2: 88, alignment: [6, 26, 48, 70] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

function reedSolomonGenerator(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ poly[j]!;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j]!, root);
    }
    poly = next;
  }
  return poly.subarray(1);
}

function reedSolomonRemainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = reedSolomonGenerator(degree);
  const rem = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem[0]!;
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < degree; j++) rem[j] = (rem[j] ?? 0) ^ gfMul(gen[j]!, factor);
    }
  }
  return rem;
}

function chooseVersion(byteLength: number): number {
  for (let v = 1; v < VERSION_SPECS.length; v++) {
    const spec = VERSION_SPECS[v]!;
    const dataCapacityBytes = spec.blocksGroup1 * spec.dataCodewordsGroup1 + spec.blocksGroup2 * spec.dataCodewordsGroup2;
    const headerBytes = v <= 9 ? 2 : 3; // 4-bit mode + (8 or 16)-bit length + 4-bit terminator
    if (byteLength + headerBytes <= dataCapacityBytes) return v;
  }
  throw new Error('QR payload exceeds supported capacity');
}

function encodeDataCodewords(bytes: Uint8Array, version: number): Uint8Array {
  const spec = VERSION_SPECS[version]!;
  const totalData = spec.blocksGroup1 * spec.dataCodewordsGroup1 + spec.blocksGroup2 * spec.dataCodewordsGroup2;
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, version <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i++) pushBits(bytes[i]!, 8);
  const maxBits = totalData * 8;
  const terminator = Math.min(4, maxBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);
  const data = new Uint8Array(totalData);
  const byteCount = bits.length >>> 3;
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]!;
    data[i] = b;
  }
  for (let i = byteCount, pad = 0; i < totalData; i++, pad ^= 1) {
    data[i] = pad === 0 ? 0xec : 0x11;
  }
  return data;
}

function interleaveCodewords(data: Uint8Array, version: number): Uint8Array {
  const spec = VERSION_SPECS[version]!;
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let i = 0; i < spec.blocksGroup1; i++) {
    const block = data.subarray(offset, offset + spec.dataCodewordsGroup1);
    offset += spec.dataCodewordsGroup1;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonRemainder(block, spec.ecCodewordsPerBlock));
  }
  for (let i = 0; i < spec.blocksGroup2; i++) {
    const block = data.subarray(offset, offset + spec.dataCodewordsGroup2);
    offset += spec.dataCodewordsGroup2;
    dataBlocks.push(block);
    ecBlocks.push(reedSolomonRemainder(block, spec.ecCodewordsPerBlock));
  }
  const result = new Uint8Array(spec.totalCodewords);
  let pos = 0;
  const maxDataLen = Math.max(spec.dataCodewordsGroup1, spec.dataCodewordsGroup2);
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) result[pos++] = block[i]!;
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const block of ecBlocks) {
      result[pos++] = block[i]!;
    }
  }
  return result;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const spec = VERSION_SPECS[version]!;
  const codewords = interleaveCodewords(encodeDataCodewords(bytes, version), version);
  const size = 17 + version * 4;
  const modules: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false));

  const setFunction = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r]![c] = dark;
    isFunction[r]![c] = true;
  };

  const drawFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFunction(top + r, left + c, inOuter && (onBorder || inInner));
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  for (const r of spec.alignment) {
    for (const c of spec.alignment) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunction(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Reserve format information bits
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setFunction(8, i, false);
      setFunction(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunction(8, size - 1 - i, false);
    setFunction(size - 1 - i, 8, false);
  }
  setFunction(size - 8, 8, true); // Dark module

  // Version information for version >= 7
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const verBits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((verBits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunction(a, b, dark);
      setFunction(b, a, dark);
    }
  }

  // Place data bits in upward/downward 2-column zig-zag
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < size; v++) {
      const r = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunction[r]![c]) {
          let dark = false;
          if (bitIndex < totalBits) {
            dark = ((codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) !== 0;
            bitIndex++;
          }
          modules[r]![c] = dark;
        }
      }
    }
  }

  // Apply mask 0: (r + c) % 2 === 0
  const mask = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r]![c] && (r + c) % 2 === 0) {
        modules[r]![c] = !modules[r]![c];
      }
    }
  }

  // Write format information for EC Level L (01) and mask 0 (000) -> data = 0b01000
  const formatData = (0b01 << 3) | mask;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const formatBits = ((formatData << 10) | rem) ^ 0x5412;

  for (let i = 0; i <= 5; i++) setFunction(8, i, ((formatBits >>> i) & 1) !== 0);
  setFunction(8, 7, ((formatBits >>> 6) & 1) !== 0);
  setFunction(8, 8, ((formatBits >>> 7) & 1) !== 0);
  setFunction(7, 8, ((formatBits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, ((formatBits >>> i) & 1) !== 0);

  for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, ((formatBits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, ((formatBits >>> i) & 1) !== 0);

  return modules;
}

export function renderQrSvg(text: string, margin = 4): string {
  const matrix = encodeQrMatrix(text);
  const size = matrix.length;
  const total = size + margin * 2;
  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r]![c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${pathData}" fill="#000000"/></svg>`;
}
