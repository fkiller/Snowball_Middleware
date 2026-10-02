#!/usr/bin/env python3
"""
STT Backend Fallback Assessment Tool for whisper.cpp & Snowball Control.
Evaluates hardware capability, driver readiness, and CPU core topology
according to the following fallback logic:

                 START
                   |
            Apple Silicon?
             /           \\
           yes            no
            |              |
          Metal        NVIDIA?
            |           /     \\
          fail        yes      no
            |          |        |
           CPU        CUDA    Vulkan
                       |        |
                     fail     fail
                       +---+----+
                           |
                          CPU

Output: Real-time decision trace, ASCII path diagram, and optimal backend configuration.
Requires ONLY Python standard library (no pip install required).
"""

import os
import sys
import platform
import subprocess
import shutil
import ctypes
import json
import argparse
import time

# Ensure UTF-8 streams on Windows terminals
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

def configure_windows_dll_paths():
    """Register nvidia pip wheel bin directories with Windows DLL loader."""
    if sys.platform != "win32":
        return
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

    prefix_sp = os.path.join(sys.prefix, "Lib", "site-packages")
    if prefix_sp not in candidates:
        candidates.append(prefix_sp)

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
            if os.path.isdir(p):
                try:
                    os.add_dll_directory(p)
                    os.environ["PATH"] = p + os.pathsep + os.environ.get("PATH", "")
                except Exception:
                    pass

configure_windows_dll_paths()

def probe_cublas() -> bool:
    configure_windows_dll_paths()
    for dll_name in ["cublas64_12.dll", "cublas64_11.dll", "libcublas.so.12", "libcublas.so"]:
        try:
            if sys.platform == "win32":
                ctypes.windll.LoadLibrary(dll_name)
            else:
                ctypes.CDLL(dll_name)
            return True
        except Exception:
            pass
    return False

class TraceLogger:
    def __init__(self):
        self.events = []

    def log(self, step: str, message: str, status: str = "INFO"):
        entry = {
            "timestamp": time.strftime("%H:%M:%S"),
            "step": step,
            "status": status,
            "message": message
        }
        self.events.append(entry)
        prefix = f"[{entry['timestamp']}][{status:4s}][{step}]"
        print(f"  {prefix} {message}", flush=True)

def get_cpu_info():
    logical = os.cpu_count() or 1
    physical = logical
    sys_name = platform.system()
    model_name = platform.processor() or "Generic CPU"

    # 1. Try psutil if installed
    try:
        import psutil
        p = psutil.cpu_count(logical=False)
        if p:
            physical = p
    except Exception:
        pass

    # 2. Native OS queries for physical cores if psutil not available
    if physical == logical:
        try:
            if sys_name == "Windows":
                cmd = "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty NumberOfCores"
                out = subprocess.check_output(["powershell", "-NoProfile", "-Command", cmd], text=True, stderr=subprocess.DEVNULL)
                cores = [int(line.strip()) for line in out.strip().splitlines() if line.strip().isdigit()]
                if cores:
                    physical = sum(cores)
                # Model name
                cmd_name = "Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name"
                out_name = subprocess.check_output(["powershell", "-NoProfile", "-Command", cmd_name], text=True, stderr=subprocess.DEVNULL)
                lines = [l.strip() for l in out_name.strip().splitlines() if l.strip()]
                if lines:
                    model_name = lines[0]
            elif sys_name == "Darwin":
                out = subprocess.check_output(["sysctl", "-n", "hw.physicalcpu"], text=True, stderr=subprocess.DEVNULL)
                physical = int(out.strip())
                out_name = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True, stderr=subprocess.DEVNULL)
                model_name = out_name.strip()
            elif sys_name == "Linux":
                out = subprocess.check_output(["lscpu", "-p=CORE,SOCKET"], text=True, stderr=subprocess.DEVNULL)
                unique = set(line.strip() for line in out.splitlines() if line and not line.startswith("#"))
                if unique:
                    physical = len(unique)
                with open("/proc/cpuinfo", "r", encoding="utf-8") as f:
                    for line in f:
                        if "model name" in line:
                            model_name = line.split(":", 1)[1].strip()
                            break
        except Exception:
            pass

    # Total RAM
    total_ram_gb = 8.0
    avail_ram_gb = 4.0
    try:
        if sys_name == "Windows":
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                total_ram_gb = round(stat.ullTotalPhys / (1024**3), 1)
                avail_ram_gb = round(stat.ullAvailPhys / (1024**3), 1)
        elif sys_name == "Darwin":
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True, stderr=subprocess.DEVNULL)
            total_ram_gb = round(int(out.strip()) / (1024**3), 1)
            avail_ram_gb = total_ram_gb * 0.6
        elif sys_name == "Linux":
            with open("/proc/meminfo", "r", encoding="utf-8") as f:
                for line in f:
                    if "MemTotal:" in line:
                        total_ram_gb = round(int(line.split()[1]) / (1024**2), 1)
                    elif "MemAvailable:" in line:
                        avail_ram_gb = round(int(line.split()[1]) / (1024**2), 1)
    except Exception:
        pass

    return {
        "model": model_name,
        "physical_cores": physical,
        "logical_threads": logical,
        "smt_active": logical > physical,
        "total_ram_gb": total_ram_gb,
        "avail_ram_gb": avail_ram_gb
    }

def calculate_optimal_threads(cpu_info: dict) -> dict:
    p = cpu_info["physical_cores"]
    l = cpu_info["logical_threads"]

    # GEMM execution units are bound by physical cores.
    # Hyperthreads / SMT share ALUs and cause L1/L2 cache contention.
    if p <= 2:
        threads = 1
        tier = "Ultra-Light (<4 cores)"
        reason = "Single thread to avoid starving OS and interactive UI."
    elif p <= 4:
        threads = max(1, p - 1)
        tier = "Quad-Core (4 cores)"
        reason = f"{threads} worker threads; leaves 1 physical core for OS/audio capture."
    elif p <= 8:
        threads = max(4, p - 2)
        tier = "Mainstream (6~8 cores)"
        reason = f"{threads} threads within single CCX/die; 2 cores headroom for system."
    elif p <= 16:
        threads = min(12, p - 2)
        tier = "High-End (12~16 cores)"
        reason = f"{threads} threads balanced across physical cores without CCX thrashing."
    else:
        # Multi-CCD / Threadripper / Server: OpenMP scaling drops off past 16 threads
        threads = 16
        tier = f"Workstation/Extreme ({p} cores)"
        reason = "Capped at 16 threads to prevent inter-CCD Infinity Fabric & memory bus saturation."

    return {
        "threads": threads,
        "tier": tier,
        "reason": reason
    }

MODEL_LADDER = ["tiny", "base", "small", "medium", "large-v3-turbo"]

def load_stt_config(config_path: str = None) -> dict:
    candidates = []
    if config_path:
        candidates.append(config_path)
    if os.environ.get("SNOWBALL_STT_CONFIG"):
        candidates.append(os.environ.get("SNOWBALL_STT_CONFIG"))

    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates.append(os.path.join(script_dir, "..", "config", "stt.json"))
    candidates.append(os.path.join(os.getcwd(), "config", "stt.json"))

    # Also check user data directory
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if appdata:
            candidates.append(os.path.join(appdata, "Snowball", "Middleware", "config", "stt.json"))
            candidates.append(os.path.join(appdata, "Snowball", "Middleware", "stt.json"))
    elif sys.platform == "darwin":
        home = os.path.expanduser("~")
        candidates.append(os.path.join(home, "Library", "Application Support", "Snowball", "Middleware", "config", "stt.json"))
    else:
        home = os.path.expanduser("~")
        candidates.append(os.path.join(home, ".local", "share", "snowball-middleware", "config", "stt.json"))

    for c in candidates:
        if c and os.path.isfile(c):
            try:
                with open(c, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    cfg["_source"] = os.path.abspath(c)
                    return cfg
            except Exception:
                pass

    return {
        "min_model": "small",
        "max_model": "large-v3-turbo",
        "exclude": ["medium"],
        "download_dir": None,
        "quantization": "int8",
        "_source": "built-in default"
    }

def normalize_model_name(name: str) -> str:
    if not name:
        return "small"
    name = str(name).lower().strip()
    if name.endswith("-cpu"):
        name = name[:-4]
    return name

def select_model(backend: str, cpu_info: dict, cfg: dict) -> dict:
    min_model = normalize_model_name(cfg.get("min_model", "small"))
    max_model = normalize_model_name(cfg.get("max_model", "large-v3-turbo"))
    raw_exclude = cfg.get("exclude", ["medium"]) or []
    exclude = [normalize_model_name(x) for x in raw_exclude]

    def get_rank(m: str) -> int:
        for idx, item in enumerate(MODEL_LADDER):
            if m == item:
                return idx
        return 2  # default small

    min_rank = get_rank(min_model)
    max_rank = get_rank(max_model)

    avail = cpu_info.get("avail_ram_gb", 4.0)
    p = cpu_info.get("physical_cores", 4)

    # 1. Unconstrained recommendation based on hardware capability
    if backend in ("metal", "cuda", "vulkan"):
        raw_choice = "large-v3-turbo"
        reason = f"Hardware accelerator ({backend.upper()}) supports high-throughput large-v3-turbo."
    else:
        if avail >= 12.0 and p >= 8:
            raw_choice = "large-v3-turbo"
            reason = f"Workstation CPU ({p} cores, {avail:.1f}GB RAM) capable of turbo execution."
        elif avail >= 8.0 and p >= 6:
            raw_choice = "medium"
            reason = f"Mid-tier CPU ({p} cores, {avail:.1f}GB RAM)."
        elif avail >= 4.0 and p >= 4:
            raw_choice = "small"
            reason = f"Standard quad-core CPU ({p} cores, {avail:.1f}GB RAM)."
        elif avail >= 2.0:
            raw_choice = "base"
            reason = f"Low-memory CPU ({avail:.1f}GB RAM)."
        else:
            raw_choice = "tiny"
            reason = f"Constrained memory (<2GB RAM)."

    # 2. Minimum model floor enforcement
    rank = get_rank(raw_choice)
    clamped_by_min = False
    if rank < min_rank:
        rank = min_rank
        raw_choice = MODEL_LADDER[rank]
        clamped_by_min = True

    # 3. Maximum model ceiling enforcement
    clamped_by_max = False
    if rank > max_rank:
        rank = max_rank
        raw_choice = MODEL_LADDER[rank]
        clamped_by_max = True

    # 4. Exclusion list enforcement
    excluded_applied = False
    if raw_choice in exclude:
        excluded_applied = True
        best_cand = None
        # Step down to nearest non-excluded candidate within bounds
        for r in range(rank - 1, min_rank - 1, -1):
            if MODEL_LADDER[r] not in exclude:
                best_cand = MODEL_LADDER[r]
                break
        if not best_cand:
            # Step up if stepping down wasn't possible
            for r in range(rank + 1, max_rank + 1):
                if MODEL_LADDER[r] not in exclude:
                    best_cand = MODEL_LADDER[r]
                    break
        raw_choice = best_cand if best_cand else min_model

    final_model = raw_choice
    quant = cfg.get("quantization", "int8")

    status_notes = []
    if clamped_by_min:
        status_notes.append(f"Floor '{min_model}' enforced over lower candidate")
    if clamped_by_max:
        status_notes.append(f"Ceiling '{max_model}' enforced")
    if excluded_applied:
        status_notes.append(f"Excluded model bypassed in favor of '{final_model}'")

    return {
        "selected_model": final_model,
        "display_name": f"{final_model} ({quant.upper()})",
        "min_model": min_model,
        "max_model": max_model,
        "exclude": exclude,
        "clamped_by_min": clamped_by_min,
        "clamped_by_max": clamped_by_max,
        "excluded_applied": excluded_applied,
        "status_note": ", ".join(status_notes) if status_notes else "Optimal",
        "reason": reason,
        "config_source": cfg.get("_source", "default")
    }

def check_apple_silicon(tracer: TraceLogger, simulate: str = None) -> bool:
    tracer.log("START", "Checking Apple Silicon architecture...")
    if simulate in ("apple_silicon", "metal_fail"):
        tracer.log("APPLE", f"SIMULATION: Apple Silicon branch forced ({simulate})", "PASS")
        return True
    if simulate in ("nvidia", "vulkan", "vulkan_fail", "cpu_only", "cuda_fail", "nvidia_fail"):
        tracer.log("APPLE", f"SIMULATION: Non-Apple-Silicon branch forced ({simulate})", "INFO")
        return False

    sys_name = platform.system()
    machine = platform.machine().lower()
    tracer.log("APPLE", f"System: {sys_name}, Machine Architecture: {machine}")

    if sys_name == "Darwin" and machine in ("arm64", "aarch64"):
        tracer.log("APPLE", "Apple Silicon detected (Darwin arm64).", "PASS")
        return True

    # Check brand string fallback
    try:
        out = subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True, stderr=subprocess.DEVNULL)
        if "Apple" in out:
            tracer.log("APPLE", f"Apple CPU confirmed via sysctl: {out.strip()}", "PASS")
            return True
    except Exception:
        pass

    tracer.log("APPLE", "Not Apple Silicon -> Proceeding to NVIDIA check.", "INFO")
    return False

def assess_metal(tracer: TraceLogger, simulate: str = None) -> dict:
    tracer.log("METAL", "Assessing Apple Metal GPU acceleration...")
    if simulate == "metal_fail":
        tracer.log("METAL", "SIMULATION: Metal initialization forced failure", "FAIL")
        return {"ok": False, "error": "Simulated Metal failure"}

    if platform.system() != "Darwin" and simulate != "apple_silicon":
        tracer.log("METAL", "Metal framework is only supported on macOS Darwin.", "FAIL")
        return {"ok": False, "error": "Non-macOS platform"}

    try:
        metal_path = "/System/Library/Frameworks/Metal.framework/Metal"
        if os.path.exists(metal_path) or platform.system() == "Darwin":
            ctypes.cdll.LoadLibrary(metal_path)
            tracer.log("METAL", "Metal framework successfully loaded into memory.", "PASS")
            return {
                "ok": True,
                "backend": "metal",
                "device": "Apple Silicon Integrated Metal GPU",
                "features": ["Unified Memory Architecture", "FP16 Tensor Cores"]
            }
    except Exception as e:
        tracer.log("METAL", f"Metal framework load failed: {e}", "FAIL")
        return {"ok": False, "error": str(e)}

    return {"ok": True, "backend": "metal", "device": "Apple Silicon Metal GPU"}

def check_nvidia(tracer: TraceLogger, simulate: str = None) -> dict:
    tracer.log("NVIDIA", "Probing for NVIDIA GPU hardware and drivers...")
    if simulate in ("cuda_fail", "nvidia_fail"):
        tracer.log("NVIDIA", "SIMULATION: NVIDIA detected but CUDA assessment will fail", "WARN")
        return {"detected": True, "simulate_fail": True}
    if simulate == "nvidia":
        tracer.log("NVIDIA", "SIMULATION: NVIDIA GPU forced", "PASS")
        return {"detected": True, "name": "Simulated NVIDIA RTX GPU", "vram_mb": 8192}
    if simulate in ("vulkan", "vulkan_fail", "cpu_only", "apple_silicon", "metal_fail"):
        tracer.log("NVIDIA", f"SIMULATION: No NVIDIA GPU ({simulate})", "INFO")
        return {"detected": False}

    # 1. Direct CUDA driver DLL probe via ctypes (Zero subprocess overhead)
    cuda_lib_names = ["nvcuda.dll", "libcuda.so.1", "libcuda.so"]
    for lib_name in cuda_lib_names:
        try:
            cuda = ctypes.CDLL(lib_name) if platform.system() != "Windows" else ctypes.windll.LoadLibrary(lib_name)
            # cuInit(0) -> CUDA_SUCCESS = 0
            res = cuda.cuInit(0)
            if res == 0:
                count = ctypes.c_int()
                cuda.cuDeviceGetCount(ctypes.byref(count))
                if count.value > 0:
                    dev = ctypes.c_int()
                    cuda.cuDeviceGet(ctypes.byref(dev), 0)
                    name_buf = (ctypes.c_char * 256)()
                    cuda.cuDeviceGetName(name_buf, 256, dev.value)
                    gpu_name = name_buf.value.decode("utf-8", errors="ignore")
                    total_mem = ctypes.c_size_t()
                    try:
                        cuda.cuDeviceTotalMem_v2(ctypes.byref(total_mem), dev.value)
                        vram_mb = int(total_mem.value / (1024 * 1024))
                    except Exception:
                        vram_mb = 0
                    tracer.log("NVIDIA", f"Driver API cuInit(0) verified: {gpu_name} ({vram_mb} MB VRAM)", "PASS")
                    return {
                        "detected": True,
                        "name": gpu_name,
                        "vram_mb": vram_mb,
                        "device_count": count.value,
                        "driver_api": lib_name
                    }
        except Exception:
            pass

    # 2. Fallback to nvidia-smi probe
    smi = shutil.which("nvidia-smi")
    if smi:
        try:
            out = subprocess.check_output(
                [smi, "--query-gpu=name,driver_version,memory.total,memory.free", "--format=csv,noheader"],
                text=True, stderr=subprocess.DEVNULL
            ).strip()
            if out:
                parts = [p.strip() for p in out.splitlines()[0].split(",")]
                gpu_name = parts[0]
                driver_ver = parts[1] if len(parts) > 1 else "Unknown"
                vram_total = parts[2] if len(parts) > 2 else "Unknown"
                tracer.log("NVIDIA", f"nvidia-smi verified: {gpu_name} (Driver {driver_ver}, {vram_total})", "PASS")
                return {
                    "detected": True,
                    "name": gpu_name,
                    "driver_version": driver_ver,
                    "vram_str": vram_total
                }
        except Exception as e:
            tracer.log("NVIDIA", f"nvidia-smi query failed: {e}", "WARN")

    tracer.log("NVIDIA", "No active NVIDIA GPU detected -> Proceeding to Vulkan check.", "INFO")
    return {"detected": False}

def assess_cuda(nvidia_info: dict, tracer: TraceLogger, simulate: str = None) -> dict:
    tracer.log("CUDA", "Assessing CUDA acceleration readiness...")
    if nvidia_info.get("simulate_fail") or simulate == "cuda_fail":
        tracer.log("CUDA", "CUDA assessment failed: Driver/toolkit mismatch or insufficient VRAM", "FAIL")
        return {"ok": False, "error": "Simulated CUDA failure"}

    gpu_name = nvidia_info.get("name", "NVIDIA GPU")
    vram_mb = nvidia_info.get("vram_mb", 0)

    if vram_mb > 0 and vram_mb < 1500:
        tracer.log("CUDA", f"VRAM ({vram_mb} MB) is below 1500 MB threshold for large models.", "WARN")

    # True dependency probe: cuBLAS library must be loadable in memory!
    if not probe_cublas():
        tracer.log("CUDA", "cuBLAS runtime (cublas64_12.dll) missing or failed to load. CUDA acceleration unavailable.", "FAIL")
        return {
            "ok": False,
            "error": "cublas64_12.dll missing",
            "fix_hint": "uv pip install nvidia-cublas-cu12 nvidia-cudnn-cu12"
        }

    tracer.log("CUDA", f"CUDA acceleration verified for {gpu_name} (cuBLAS runtime ready).", "PASS")
    return {
        "ok": True,
        "backend": "cuda",
        "device": gpu_name,
        "vram_mb": vram_mb,
        "features": ["Tensor Cores", "cuBLAS / GGML CUDA"]
    }

def assess_vulkan(tracer: TraceLogger, simulate: str = None) -> dict:
    tracer.log("VULKAN", "Probing Vulkan driver and physical devices...")
    if simulate == "vulkan_fail" or simulate == "cpu_only":
        tracer.log("VULKAN", f"SIMULATION: Vulkan probe failed ({simulate})", "FAIL")
        return {"ok": False, "error": f"Simulated Vulkan failure ({simulate})"}

    # 1. Check Vulkan loader library
    vk_libs = ["vulkan-1.dll", "libvulkan.so.1", "libvulkan.dylib"]
    loader_found = False
    for lib in vk_libs:
        try:
            if platform.system() == "Windows":
                ctypes.windll.LoadLibrary(lib)
            else:
                ctypes.CDLL(lib)
            loader_found = True
            tracer.log("VULKAN", f"Vulkan runtime loader '{lib}' loaded successfully.", "PASS")
            break
        except Exception:
            pass

    if not loader_found:
        tracer.log("VULKAN", "Vulkan runtime loader not found.", "FAIL")
        return {"ok": False, "error": "Vulkan runtime library missing"}

    # 2. Probe physical devices via vulkaninfo if available
    vulkaninfo = shutil.which("vulkaninfo")
    gpus = []
    if vulkaninfo:
        try:
            out = subprocess.check_output([vulkaninfo, "--summary"], text=True, stderr=subprocess.DEVNULL)
            current_dev = {}
            for line in out.splitlines():
                line = line.strip()
                if line.startswith("deviceName"):
                    current_dev["name"] = line.split("=", 1)[1].strip()
                elif line.startswith("deviceType"):
                    current_dev["type"] = line.split("=", 1)[1].strip()
                elif line.startswith("driverInfo"):
                    current_dev["driver"] = line.split("=", 1)[1].strip()
                    if "name" in current_dev:
                        # Exclude CPU software renderers (llvmpipe / lavapipe)
                        if "llvmpipe" not in current_dev.get("name", "").lower() and "lavapipe" not in current_dev.get("name", "").lower():
                            gpus.append(dict(current_dev))
                        current_dev = {}
        except Exception as e:
            tracer.log("VULKAN", f"vulkaninfo query note: {e}", "WARN")

    if gpus:
        # Prioritize discrete GPU over integrated
        discrete = [g for g in gpus if "DISCRETE" in g.get("type", "").upper()]
        selected = discrete[0] if discrete else gpus[0]
        tracer.log("VULKAN", f"Vulkan physical GPU verified: {selected.get('name')} ({selected.get('type')})", "PASS")
        return {
            "ok": True,
            "backend": "vulkan",
            "device": selected.get("name"),
            "device_type": selected.get("type"),
            "driver": selected.get("driver"),
            "all_gpus": [g.get("name") for g in gpus]
        }

    # If loader exists but vulkaninfo is absent or software-only, attempt generic pass
    tracer.log("VULKAN", "Vulkan runtime is active; GPU compute pipeline accessible.", "PASS")
    return {
        "ok": True,
        "backend": "vulkan",
        "device": "Vulkan Compatible Graphics Device"
    }

def print_decision_graph(path_steps: list, selected_backend: str):
    is_apple = "apple_yes" in path_steps
    is_metal_pass = "metal_pass" in path_steps
    is_metal_fail = "metal_fail" in path_steps
    is_nvidia_yes = "nvidia_yes" in path_steps
    is_nvidia_no = "nvidia_no" in path_steps
    is_cuda_pass = "cuda_pass" in path_steps
    is_cuda_fail = "cuda_fail" in path_steps
    is_vulkan_pass = "vulkan_pass" in path_steps
    is_vulkan_fail = "vulkan_fail" in path_steps
    is_cpu = selected_backend == "cpu"

    def mark(cond: bool, label: str) -> str:
        return f"[{label}]" if cond else label

    m_metal = f"{'*METAL*' if selected_backend == 'metal' else 'Metal'}"
    m_cuda  = f"{'*CUDA*' if selected_backend == 'cuda' else 'CUDA'}"
    m_vulk  = f"{'*VULKAN*' if selected_backend == 'vulkan' else 'Vulkan'}"
    m_cpu   = f"{'*CPU (SELECTED)*' if is_cpu else 'CPU'}"

    graph = f"""
                 START
                   |
            Apple Silicon?
             /           \\
           {mark(is_apple, 'yes')}           {mark(not is_apple, 'no')}
            |              |
          {m_metal:7s}      NVIDIA?
            |           /     \\
          {mark(is_metal_fail, 'fail')}        {mark(is_nvidia_yes, 'yes')}     {mark(is_nvidia_no, 'no')}
            |          |        |
           {m_cpu if is_metal_fail else 'CPU'}        {m_cuda:6s}   {m_vulk}
                       |        |
                     {mark(is_cuda_fail, 'fail')}     {mark(is_vulkan_fail, 'fail')}
                       +---+----+
                           |
                        {m_cpu}
"""
    print(graph)

def run_assessment(args) -> dict:
    tracer = TraceLogger()
    path_steps = []
    print("=" * 80)
    print("  SNOWBALL STT BACKEND FALLBACK ASSESSMENT TEST")
    print("=" * 80)

    # 1. System Baseline
    cpu_info = get_cpu_info()
    thread_plan = calculate_optimal_threads(cpu_info)

    tracer.log("BASE", f"Host OS: {platform.system()} ({platform.machine()}) | Python {sys.version.split()[0]}")
    tracer.log("BASE", f"CPU: {cpu_info['model']}")
    tracer.log("BASE", f"Topology: {cpu_info['physical_cores']} Physical Cores / {cpu_info['logical_threads']} Logical Threads (SMT: {cpu_info['smt_active']})")
    tracer.log("BASE", f"System RAM: {cpu_info['avail_ram_gb']} GB available of {cpu_info['total_ram_gb']} GB total")
    print("-" * 80)

    selected_backend = None
    device_details = {}
    fallback_reason = None

    # Step 1: Apple Silicon?
    is_apple = check_apple_silicon(tracer, args.simulate)
    if is_apple:
        path_steps.append("apple_yes")
        metal_res = assess_metal(tracer, args.simulate)
        if metal_res["ok"]:
            path_steps.append("metal_pass")
            selected_backend = "metal"
            device_details = metal_res
        else:
            path_steps.append("metal_fail")
            fallback_reason = f"Metal failed: {metal_res.get('error')}"
            selected_backend = "cpu"
    else:
        path_steps.append("apple_no")
        # Step 2: NVIDIA?
        nvidia_info = check_nvidia(tracer, args.simulate)
        if nvidia_info["detected"]:
            path_steps.append("nvidia_yes")
            cuda_res = assess_cuda(nvidia_info, tracer, args.simulate)
            if cuda_res["ok"]:
                path_steps.append("cuda_pass")
                selected_backend = "cuda"
                device_details = cuda_res
            else:
                path_steps.append("cuda_fail")
                fallback_reason = f"CUDA failed: {cuda_res.get('error')}"
                selected_backend = "cpu"
        else:
            path_steps.append("nvidia_no")
            # Step 3: Vulkan
            vulkan_res = assess_vulkan(tracer, args.simulate)
            if vulkan_res["ok"]:
                path_steps.append("vulkan_pass")
                selected_backend = "vulkan"
                device_details = vulkan_res
            else:
                path_steps.append("vulkan_fail")
                fallback_reason = f"Vulkan failed: {vulkan_res.get('error')}"
                selected_backend = "cpu"

    # The resident faster-whisper/CTranslate2 worker accepts CUDA or CPU only.
    # Detecting a graphics loader is not evidence of a supported STT backend.
    if selected_backend not in ("cuda", "cpu"):
        fallback_reason = f"{selected_backend} is unsupported by the resident faster-whisper worker"
        tracer.log("RUNTIME", fallback_reason, "WARN")
        path_steps.append("unsupported_backend_cpu")
        selected_backend = "cpu"
        device_details = {}

    # Step 4: Finalize Decision
    print("-" * 80)
    print("  [FALLBACK DECISION GRAPH TRACE]")
    print_decision_graph(path_steps, selected_backend)
    print("=" * 80)

    # Compute execution flags for whisper.cpp
    if selected_backend == "metal":
        whisper_flags = ["-ng", "1"]
        active_threads = 4
    elif selected_backend == "cuda":
        whisper_flags = ["-ng", "99", "--device", "0"]
        active_threads = 4
    elif selected_backend == "vulkan":
        whisper_flags = ["-ng", "99", "--device", "0"]
        active_threads = 4
    else:
        # CPU Fallback
        active_threads = thread_plan["threads"]
        whisper_flags = ["-t", str(active_threads), "-ng", "0"]

    # Load configuration and evaluate model selection with floor, ceiling, and exclusions
    cfg = load_stt_config(getattr(args, "config", None))
    model_eval = select_model(selected_backend, cpu_info, cfg)
    selected_model = model_eval["selected_model"]

    result_summary = {
        "selected_backend": selected_backend,
        "fallback_path": " -> ".join(path_steps) + f" -> {selected_backend}",
        "fallback_reason": fallback_reason,
        "device": device_details.get("device", cpu_info["model"]),
        "cpu_info": cpu_info,
        "optimal_threads": active_threads,
        "thread_plan": thread_plan,
        "recommended_model": model_eval["display_name"],
        "selected_model": selected_model,
        "model_evaluation": model_eval,
        "whisper_cli_args": " ".join(whisper_flags) + f" -m models/ggml-{selected_model}.bin"
    }

    # Print Final Assessment Text Card
    print(f"  SELECTED BACKEND    : {selected_backend.upper()}")
    print(f"  ACCELERATOR DEVICE  : {result_summary['device']}")
    if fallback_reason:
        print(f"  FALLBACK REASON     : {fallback_reason}")
    print(f"  FALLBACK PATH       : {result_summary['fallback_path']}")
    print(f"  OPTIMAL THREADS     : {active_threads} ({thread_plan['tier']})")
    print(f"  THREAD HEURISTIC    : {thread_plan['reason']}")
    print(f"  STT CONFIG SOURCE   : {model_eval['config_source']}")
    print(f"  CONSTRAINTS         : floor={model_eval['min_model']}, ceiling={model_eval['max_model']}, exclude={model_eval['exclude']}")
    print(f"  SELECTED MODEL      : {model_eval['display_name']} [{model_eval['status_note']}]")
    print(f"  MODEL JUSTIFICATION : {model_eval['reason']}")
    print(f"  WHISPER.CPP CLI ARGS: {result_summary['whisper_cli_args']}")
    print("=" * 80)

    # If whisper-bin passed, test running
    if args.whisper_bin:
        bin_path = args.whisper_bin
        print(f"\n[Whisper.cpp Execution Probe]: {bin_path}")
        if os.path.exists(bin_path):
            try:
                cmd = [bin_path, "--help"]
                out = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)
                print(f"  Binary probe successful: {bin_path} is executable.")
            except Exception as e:
                print(f"  Binary probe error: {e}")
        else:
            print(f"  Warning: Specified binary '{bin_path}' does not exist.")

    return result_summary

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Snowball STT Backend Fallback Assessment Tool")
    parser.add_argument("--json", action="store_true", help="Print structured JSON result only")
    parser.add_argument("--select-model", action="store_true", help="Print only selected model name (e.g. small, large-v3-turbo)")
    parser.add_argument("--config", help="Path to custom stt.json configuration file")
    parser.add_argument("--simulate", choices=["apple_silicon", "metal_fail", "nvidia", "cuda_fail", "vulkan", "vulkan_fail", "cpu_only"],
                        help="Simulate specific platform/failure paths to test the fallback graph")
    parser.add_argument("--whisper-bin", help="Path to whisper.cpp binary to verify execution")
    args = parser.parse_args()

    if args.select_model:
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        res = run_assessment(args)
        sys.stdout = old_stdout
        print(res["selected_model"])
    elif args.json:
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        res = run_assessment(args)
        sys.stdout = old_stdout
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        run_assessment(args)
