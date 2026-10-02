import subprocess, os, struct, zlib, sys
from pathlib import Path

ADB = r'C:\Users\wondo\AppData\Local\Temp\Codex-MK20-ADB\platform-tools\adb.exe'
DEVICE = '127.0.0.1:15555'
OUT_DIR = r'C:\Users\wondo\.gemini\antigravity\brain\71580c38-7aed-4754-8f87-ffb7b94b98eb'

def raw_to_png(raw_bytes, out_png, w, h):
    expected_len = w * h * 2
    raw = raw_bytes[:expected_len]
    rgb = bytearray()
    for (v,) in struct.iter_unpack('<H', raw):
        rgb.extend(((v >> 11) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31))
    def chunk(k, v):
        return struct.pack('>I', len(v)) + k + v + struct.pack('>I', zlib.crc32(k + v) & 0xffffffff)
    scan = b''.join(b'\0' + rgb[y * w * 3:(y + 1) * w * 3] for y in range(h))
    png_data = (b'\x89PNG\r\n\x1a\n' +
                chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
                chunk(b'IDAT', zlib.compress(scan)) +
                chunk(b'IEND', b''))
    Path(out_png).write_bytes(png_data)

def dump_fb(fb_num, out_name, w, h):
    remote_raw = f'/tmp/{out_name}.raw'
    local_raw = os.path.join(OUT_DIR, f'{out_name}.raw')
    local_png = os.path.join(OUT_DIR, f'{out_name}.png')
    subprocess.run([ADB, '-s', DEVICE, 'shell', f'dd if=/dev/fb{fb_num} of={remote_raw} bs={w*h*2} count=1 2>/dev/null'], capture_output=True)
    subprocess.run([ADB, '-s', DEVICE, 'pull', remote_raw, local_raw], capture_output=True)
    if os.path.exists(local_raw):
        raw_to_png(Path(local_raw).read_bytes(), local_png, w, h)
        print(f'Dumped fb{fb_num} -> {local_png}')

prefix = sys.argv[1] if len(sys.argv) > 1 else 'current'
dump_fb(21, f'{prefix}_top', 428, 142)
for k in [1, 5, 9, 10, 13, 14, 18, 20]:
    dump_fb(k, f'{prefix}_k{k}', 128, 128)

