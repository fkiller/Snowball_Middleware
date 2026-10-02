"""Capture real MK20 RGB565 framebuffers without changing its runtime."""
import argparse
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import uuid
import zlib

def raw_to_png(raw, output, width, height):
    if len(raw) != width * height * 2:
        raise ValueError('Incomplete RGB565 framebuffer capture')
    rgb = bytearray()
    for (value,) in struct.iter_unpack('<H', raw):
        rgb.extend(((value >> 11) * 255 // 31, ((value >> 5) & 63) * 255 // 63, (value & 31) * 255 // 31))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\0' + rgb[y * width * 3:(y + 1) * width * 3] for y in range(height))
    output.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', default=os.environ.get('MK20_ADB') or shutil.which('adb'))
    parser.add_argument('--device', default=os.environ.get('SNOWBALL_MK20_ADB_DEVICE'))
    parser.add_argument('--output-dir', type=Path, default=Path('artifacts/mk20-screens'))
    parser.add_argument('--framebuffers', type=int, nargs='+', default=[21, 1, 5, 9, 10, 13, 14, 18, 20])
    args = parser.parse_args()
    if not args.adb or not args.device: parser.error('Set --adb and --device (or MK20_ADB and SNOWBALL_MK20_ADB_DEVICE)')
    if any(fb < 1 or fb > 21 for fb in args.framebuffers): parser.error('Framebuffer must be 1..21')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    def adb(*command):
        return subprocess.run([args.adb, '-s', args.device, *command], check=True, capture_output=True, timeout=30).stdout
    with tempfile.TemporaryDirectory(prefix='snowball-fb-') as scratch:
        for fb in args.framebuffers:
            width, height = map(int, adb('shell', f'cat /sys/class/graphics/fb{fb}/virtual_size').strip().split(b','))
            if not (1 <= width <= 2048 and 1 <= height <= 2048): raise ValueError('Unexpected framebuffer dimensions')
            remote = f'/tmp/snowball_capture_{uuid.uuid4().hex}.raw'
            local = Path(scratch) / f'fb{fb}.raw'
            try:
                adb('shell', f'dd if=/dev/fb{fb} of={remote} bs={width * height * 2} count=1')
                adb('pull', remote, str(local))
                output = args.output_dir / f'fb{fb}.png'
                raw_to_png(local.read_bytes(), output, width, height)
                print(f'fb{fb}: {width}x{height} -> {output.resolve()}')
            finally:
                adb('shell', f'rm -f {remote}')

if __name__ == '__main__': main()
