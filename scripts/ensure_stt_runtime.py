#!/usr/bin/env python3
"""
Snowball STT Runtime & Dependency Manager
Ensures whisper runtime, faster-whisper, and hardware accelerator libraries (CUDA cuBLAS/cuDNN)
are verified and installed without manual user intervention.
"""

import os
import sys
import platform
import subprocess
import shutil
import ctypes
import json
import argparse

def configure_windows_dll_paths():
    """Register nvidia pip wheel bin directories with Windows DLL loader."""
    if sys.platform != "win32":
        return []

    added = []
    candidates = []
    try:
        import site
        if hasattr(site, "getsitepackages"):
            candidates.extend(site.getsitepackages())
        if hasattr(site, "getusersitepackages"):
            u = site.getusersitepackages()
            if isinstance(u, str):
                candidates.append(u)
    except Exception:
        pass

    # Also inspect sys.prefix
    prefix_sp = os.path.join(sys.prefix, "Lib", "site-packages")
    if prefix_sp not in candidates:
        candidates.append(prefix_sp)

    # Inspect parent .venv-whisper if running outside venv
    repo_dirs = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".venv-whisper", "Lib", "site-packages")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "Snowball_Control", "host", ".venv-whisper", "Lib", "site-packages")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "host", ".venv-whisper", "Lib", "site-packages")),
    ]
    for rd in repo_dirs:
        if os.path.isdir(rd) and rd not in candidates:
            candidates.append(rd)

    for sp in candidates:
        if not sp or not os.path.isdir(sp):
            continue
        for sub in ["nvidia/cublas/bin", "nvidia/cudnn/bin", "nvidia/cuda_nvrtc/bin"]:
            p = os.path.join(sp, sub.replace("/", os.sep))
            if os.path.isdir(p) and p not in added:
                try:
                    os.add_dll_directory(p)
                    added.append(p)
                    os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")
                except Exception:
                    pass
    return added

def probe_cublas() -> dict:
    """Probes if cuBLAS DLLs are genuinely loadable into memory."""
    configure_windows_dll_paths()
    dll_candidates = ["cublas64_12.dll", "cublas64_11.dll", "libcublas.so.12", "libcublas.so"]
    for dll_name in dll_candidates:
        try:
            if sys.platform == "win32":
                dll = ctypes.windll.LoadLibrary(dll_name)
            else:
                dll = ctypes.CDLL(dll_name)
            return {"loaded": True, "library": dll_name, "handle": str(dll)}
        except Exception:
            pass
    return {"loaded": False, "library": None}

def check_nvidia_hardware() -> dict:
    """Probes NVIDIA GPU presence via driver API or nvidia-smi."""
    if sys.platform == "win32":
        try:
            cuda = ctypes.windll.LoadLibrary("nvcuda.dll")
            if cuda.cuInit(0) == 0:
                count = ctypes.c_int()
                cuda.cuDeviceGetCount(ctypes.byref(count))
                if count.value > 0:
                    dev = ctypes.c_int()
                    cuda.cuDeviceGet(ctypes.byref(dev), 0)
                    name_buf = (ctypes.c_char * 256)()
                    cuda.cuDeviceGetName(name_buf, 256, dev.value)
                    return {"detected": True, "name": name_buf.value.decode("utf-8", errors="ignore")}
        except Exception:
            pass

    smi = shutil.which("nvidia-smi")
    if smi:
        try:
            out = subprocess.check_output([smi, "--query-gpu=name", "--format=csv,noheader"], text=True, stderr=subprocess.DEVNULL).strip()
            if out:
                return {"detected": True, "name": out.splitlines()[0].strip()}
        except Exception:
            pass

    return {"detected": False, "name": None}

def check_status() -> dict:
    has_faster_whisper = False
    try:
        import faster_whisper
        has_faster_whisper = True
    except Exception:
        pass

    gpu_info = check_nvidia_hardware()
    cublas_info = probe_cublas()

    ready = has_faster_whisper
    if gpu_info["detected"]:
        cuda_ready = cublas_info["loaded"]
    else:
        cuda_ready = False

    return {
        "python_version": platform.python_version(),
        "executable": sys.executable,
        "faster_whisper": has_faster_whisper,
        "nvidia_gpu": gpu_info["detected"],
        "gpu_name": gpu_info["name"],
        "cublas_ready": cublas_info["loaded"],
        "cuda_ready": cuda_ready,
        "optimal_backend": "cuda" if (gpu_info["detected"] and cublas_info["loaded"]) else "cpu"
    }

def resolve_target_python(target_python: str = None) -> str:
    """Returns valid python executable, creating .venv-whisper if needed."""
    if target_python and os.path.isfile(target_python):
        return target_python

    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.abspath(os.path.join(script_dir, "..", "..", "Snowball_Control", "host", ".venv-whisper")),
        os.path.abspath(os.path.join(script_dir, "..", "host", ".venv-whisper")),
        os.path.abspath(os.path.join(script_dir, "..", ".venv-whisper")),
    ]
    for c in candidates:
        py_bin = os.path.join(c, "Scripts", "python.exe") if sys.platform == "win32" else os.path.join(c, "bin", "python")
        if os.path.isfile(py_bin):
            return py_bin

    # Auto-initialize .venv-whisper if none exists
    target_venv = candidates[0]
    sys.stderr.write(f"[STT-Deps] Initializing Python virtualenv at {target_venv}...\n")
    try:
        uv = shutil.which("uv")
        if uv:
            subprocess.run([uv, "venv", target_venv], check=True, capture_output=True)
        else:
            subprocess.run([sys.executable, "-m", "venv", target_venv], check=True, capture_output=True)
        py_bin = os.path.join(target_venv, "Scripts", "python.exe") if sys.platform == "win32" else os.path.join(target_venv, "bin", "python")
        if os.path.isfile(py_bin):
            return py_bin
    except Exception as e:
        sys.stderr.write(f"[STT-Deps] Virtualenv creation note: {e}\n")

    return sys.executable

def install_dependencies(target_python: str = None) -> bool:
    py_exec = resolve_target_python(target_python)
    gpu_info = check_nvidia_hardware()

    packages = ["faster-whisper>=1.0.0"]
    if gpu_info["detected"]:
        packages.extend(["nvidia-cublas-cu12", "nvidia-cudnn-cu12"])

    sys.stderr.write(f"[STT-Deps] Installing STT dependencies ({', '.join(packages)}) into {py_exec}...\n")

    uv = shutil.which("uv")
    if uv:
        cmd = [uv, "pip", "install", "--python", py_exec] + packages
    else:
        cmd = [py_exec, "-m", "pip", "install"] + packages

    try:
        subprocess.run(cmd, check=True, text=True, capture_output=True)
        sys.stderr.write(f"[STT-Deps] Installation succeeded.\n")
        return True
    except Exception as e:
        sys.stderr.write(f"[STT-Deps] Accelerator dependency installation failed: {e}\n")
        # If installing GPU wheels failed (e.g. download error or platform incompatibility),
        # gracefully fall back to installing base CPU faster-whisper so universal CPU fallback works!
        if gpu_info["detected"]:
            sys.stderr.write(f"[STT-Deps] Falling back to CPU-only base dependencies (faster-whisper)...\n")
            cpu_cmd = [uv, "pip", "install", "--python", py_exec, "faster-whisper>=1.0.0"] if uv else [py_exec, "-m", "pip", "install", "faster-whisper>=1.0.0"]
            try:
                subprocess.run(cpu_cmd, check=True, text=True, capture_output=True)
                sys.stderr.write(f"[STT-Deps] Base CPU dependencies installed successfully. CPU fallback ready.\n")
                return True
            except Exception as cpu_err:
                sys.stderr.write(f"[STT-Deps] CPU fallback installation failed: {cpu_err}\n")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Snowball STT Runtime Manager")
    parser.add_argument("--check", action="store_true", help="Check status and output JSON")
    parser.add_argument("--install", action="store_true", help="Install missing packages")
    parser.add_argument("--python", help="Target python executable for install")
    args = parser.parse_args()

    if args.install:
        success = install_dependencies(args.python)
        sys.exit(0 if success else 1)

    status = check_status()
    print(json.dumps(status, indent=2))
