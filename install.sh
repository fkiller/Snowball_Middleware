#!/usr/bin/env bash
# Per-user bootstrap for macOS and desktop Linux. Never runs firmware operations.
set -euo pipefail
umask 077

fail() { printf 'Snowball: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'HELP'
Install Snowball on macOS or desktop Linux (x64/arm64).
Usage: bash install.sh [--root PATH] [--update] [--no-start] [--no-shortcut]
       [--profile all|web|mk20|m5stack] [--python PATH] [--port PORT]
       [--bind PRIVATE_PC_IP] [--data-dir PATH] [--mk20-address IP] [--adb PATH]
Prerequisites: curl, Git, Python >=3.12 with venv/pip, tar; a graphical login
and Electron system libraries for the native tray. Node is prepared locally.
Normal installation/update never probes or flashes USB firmware.
HELP
}

case "$(uname -s)" in
  Darwin) platform=darwin; install_root="$HOME/Library/Application Support/Snowball" ;;
  Linux) platform=linux; install_root="${XDG_DATA_HOME:-$HOME/.local/share}/Snowball" ;;
  *) fail 'Use install.ps1 on Windows; this installer supports macOS and Linux.' ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) fail 'Only x64 and arm64 hosts are supported.' ;;
esac

update=false
profile=all
python_bin=''
forward=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --root|--install-root|--python|--profile|--port|--bind|--data-dir|--mk20-address|--adb|--device)
      [ "$#" -ge 2 ] && [ -n "$2" ] && [[ "$2" != --* ]] || fail "Missing value for $1"
      case "$1" in
        --root|--install-root) install_root="$2" ;;
        --python) python_bin="$2" ;;
        --profile) profile="$2"; forward+=("$1" "$2") ;;
        *) forward+=("$1" "$2") ;;
      esac
      shift 2 ;;
    --update) update=true; forward+=("$1"); shift ;;
    --no-start|--no-shortcut) forward+=("$1"); shift ;;
    *) fail "Unknown option: $1 (see --help)" ;;
  esac
done
case "$profile" in all|web|mk20|m5stack) ;; *) fail 'Choose all, web, mk20 or m5stack.' ;; esac
[ "$(id -u)" -ne 0 ] || fail 'Run as your desktop user, without sudo.'
for tool in curl git tar; do
  command -v "$tool" >/dev/null 2>&1 || fail "Install $tool first (macOS: Homebrew/Xcode tools; Linux: your distribution package manager)."
done
if [ -z "$python_bin" ]; then
  for candidate in python3.12 python3.13 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys, venv; sys.exit(0 if sys.version_info >= (3,12) else 1)' 2>/dev/null; then
      python_bin="$(command -v "$candidate")"; break
    fi
  done
fi
[ -n "$python_bin" ] || fail 'Install Python >=3.12 with venv/pip (macOS: brew install python@3.12; Ubuntu 24.04: sudo apt install python3 python3-venv), or supply --python PATH.'
"$python_bin" -c 'import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)' || fail 'Python >=3.12 is required.'
if [ "$profile" != web ]; then
  "$python_bin" -c 'import venv, ensurepip' || fail 'Python venv/pip is required (Ubuntu: sudo apt install python3-venv).'
fi
python_bin="$("$python_bin" -c 'import sys; print(sys.executable)')"
install_root="$("$python_bin" -c 'import os,sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$install_root")"
if [ "$platform" = linux ]; then
  [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || fail 'A graphical Linux desktop login is required for the tray (headless servers are not supported).'
fi
mkdir -p "$install_root/.snowball/tools"
tools="$install_root/.snowball/tools"
scratch="$(mktemp -d "$tools/bootstrap.XXXXXXXX")"
trap 'rm -rf -- "$scratch"' EXIT
download() { curl --fail --show-error --silent --location --retry 3 --connect-timeout 20 "$1" -o "$2"; }
valid_node() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||a===22&&b>=12?0:1)' >/dev/null 2>&1; }
node_bin="$(command -v node || true)"
if [ -z "$node_bin" ] || ! valid_node "$node_bin"; then
  node_bin=''
  for candidate in "$tools"/node-v*-"$platform"-"$arch"/bin/node; do
    if [ -x "$candidate" ] && valid_node "$candidate"; then node_bin="$candidate"; break; fi
  done
fi
if [ -z "$node_bin" ]; then
  download 'https://nodejs.org/dist/index.json' "$scratch/releases.json"
  version="$("$python_bin" - "$scratch/releases.json" "$platform" "$arch" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    releases = json.load(stream)
for release in releases:
    if release.get('lts') and tuple(map(int, release['version'][1:].split('.'))) >= (22,12,0) and sys.argv[2]+'-'+sys.argv[3] in release['files']:
        print(release['version'])
        break
else:
    raise SystemExit('No supported official Node LTS archive found')
PY
)"
  archive="node-$version-$platform-$arch.tar.gz"
  base="https://nodejs.org/dist/$version"
  download "$base/SHASUMS256.txt" "$scratch/SHASUMS256.txt"
  download "$base/$archive" "$scratch/$archive"
  "$python_bin" - "$scratch" "$archive" <<'PY'
import hashlib, pathlib, sys
directory, name = pathlib.Path(sys.argv[1]), sys.argv[2]
matches = [line.split()[0] for line in (directory/'SHASUMS256.txt').read_text().splitlines() if line.split()[-1] == name]
if len(matches) != 1 or hashlib.file_digest((directory/name).open('rb'), 'sha256').hexdigest() != matches[0]:
    raise SystemExit('Official Node checksum missing or download mismatch; installation stopped')
PY
  tar -xzf "$scratch/$archive" -C "$tools"
  node_bin="$tools/node-$version-$platform-$arch/bin/node"
fi
node_bin="$("$node_bin" -p 'process.execPath')"
export PATH="$(dirname "$node_bin"):$PATH"
npm_cli="$("$python_bin" -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$(command -v npm)")"
[ -f "$npm_cli" ] || fail 'This Node installation lacks npm. Install the official Node distribution.'

middleware="$install_root/Snowball_Middleware"
if [ ! -e "$middleware" ]; then
  git clone --branch main https://github.com/fkiller/Snowball_Middleware.git "$middleware"
fi
origin="$(git -C "$middleware" remote get-url origin)"
case "$origin" in
  https://github.com/fkiller/Snowball_Middleware|https://github.com/fkiller/Snowball_Middleware.git|git@github.com:fkiller/Snowball_Middleware|git@github.com:fkiller/Snowball_Middleware.git) ;;
  *) fail 'Unexpected middleware repository origin.' ;;
esac
[ -z "$(git -C "$middleware" status --porcelain --untracked-files=no)" ] || fail 'Tracked local changes exist; preserve them or use a separate install root.'
if "$update"; then
  git -C "$middleware" fetch origin main
  git -C "$middleware" merge --ff-only origin/main
fi
# Bash 3.2 (the macOS system Bash) treats an empty array as unset with nounset.
"$node_bin" "$middleware/scripts/setup.mjs" --root "$install_root" --npm "$npm_cli" --python "$python_bin" ${forward[@]+"${forward[@]}"}
