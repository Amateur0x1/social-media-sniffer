#!/usr/bin/env python3
"""
环境预检脚本（跨平台：macOS / Linux / Windows）

检查 ffmpeg 和 whisper 是否已安装，如果未安装则给出安装指引。
可通过 --install 参数尝试自动安装。

用法:
    python preflight.py           # 仅检查
    python preflight.py --install # 检查并尝试自动安装缺失依赖
"""

import argparse
import os
import platform
import shutil
import subprocess
import sys


def get_platform():
    """获取当前平台"""
    system = platform.system().lower()
    if system == "darwin":
        return "macos"
    elif system == "windows":
        return "windows"
    else:
        return "linux"


def check_command(cmd):
    """检查命令是否在 PATH 中"""
    return shutil.which(cmd) is not None


def get_python_cmd():
    """获取当前 python 命令名"""
    return sys.executable


def check_ffmpeg():
    """检查 ffmpeg"""
    if check_command("ffmpeg") and check_command("ffprobe"):
        try:
            result = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
            version_line = result.stdout.split("\n")[0] if result.stdout else "unknown"
            return {"installed": True, "version": version_line}
        except Exception:
            return {"installed": True, "version": "unknown"}
    return {"installed": False}


def check_whisper():
    """检查 whisper"""
    if check_command("whisper"):
        try:
            result = subprocess.run(["whisper", "--help"], capture_output=True, text=True, timeout=10)
            return {"installed": True, "version": "available"}
        except Exception:
            return {"installed": True, "version": "unknown"}

    # 尝试作为 Python 模块检查
    try:
        result = subprocess.run(
            [sys.executable, "-c", "import whisper; print(whisper.__version__)"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return {"installed": True, "version": result.stdout.strip(), "note": "作为 Python 模块可用，但 CLI 不在 PATH"}
    except Exception:
        pass

    return {"installed": False}


def install_ffmpeg(plat):
    """尝试安装 ffmpeg"""
    print("  正在安装 ffmpeg...")
    try:
        if plat == "macos":
            subprocess.run(["brew", "install", "ffmpeg"], check=True)
        elif plat == "linux":
            # 尝试 apt，失败则尝试 dnf
            try:
                subprocess.run(["sudo", "apt-get", "install", "-y", "ffmpeg"], check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                subprocess.run(["sudo", "dnf", "install", "-y", "ffmpeg"], check=True)
        elif plat == "windows":
            # Windows 用 winget 或 choco
            try:
                subprocess.run(["winget", "install", "ffmpeg", "--accept-source-agreements", "--accept-package-agreements"], check=True)
            except (subprocess.CalledProcessError, FileNotFoundError):
                try:
                    subprocess.run(["choco", "install", "ffmpeg", "-y"], check=True)
                except (subprocess.CalledProcessError, FileNotFoundError):
                    return False
        return check_command("ffmpeg")
    except Exception as e:
        print(f"  ✗ 自动安装失败: {e}")
        return False


def install_whisper():
    """尝试安装 whisper"""
    print("  正在安装 openai-whisper...")
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "-U", "openai-whisper"],
            check=True
        )
        return check_command("whisper")
    except Exception as e:
        print(f"  ✗ 自动安装失败: {e}")
        return False


def print_install_guide(plat, missing):
    """打印手动安装指引"""
    print("\n手动安装指引：")
    print("=" * 50)

    if "ffmpeg" in missing:
        print("\n📦 ffmpeg:")
        if plat == "macos":
            print("  brew install ffmpeg")
        elif plat == "windows":
            print("  # 方式1: winget（推荐）")
            print("  winget install ffmpeg")
            print("")
            print("  # 方式2: choco")
            print("  choco install ffmpeg")
            print("")
            print("  # 方式3: 手动下载")
            print("  https://www.gyan.dev/ffmpeg/builds/ 下载后加入 PATH")
        else:
            print("  # Ubuntu/Debian")
            print("  sudo apt-get install ffmpeg")
            print("  # Fedora/CentOS")
            print("  sudo dnf install ffmpeg")

    if "whisper" in missing:
        print("\n📦 openai-whisper:")
        print(f"  {sys.executable} -m pip install -U openai-whisper")
        print("")
        print("  注意：whisper 依赖 PyTorch，首次安装可能较慢")
        if plat == "windows":
            print("  Windows 用户建议先安装 PyTorch: https://pytorch.org/get-started/locally/")

    print("\n" + "=" * 50)


def main():
    parser = argparse.ArgumentParser(description="环境预检")
    parser.add_argument("--install", action="store_true", help="尝试自动安装缺失依赖")
    parser.add_argument("--json", action="store_true", help="以 JSON 格式输出结果")
    args = parser.parse_args()

    plat = get_platform()
    print(f"平台: {plat} ({platform.platform()})")
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    print("")

    # 检查依赖
    ffmpeg_status = check_ffmpeg()
    whisper_status = check_whisper()

    print(f"ffmpeg:  {'✓ ' + ffmpeg_status.get('version', '') if ffmpeg_status['installed'] else '✗ 未安装'}")
    print(f"whisper: {'✓ ' + whisper_status.get('version', '') if whisper_status['installed'] else '✗ 未安装'}")

    if whisper_status.get("note"):
        print(f"         ⚠ {whisper_status['note']}")

    missing = []
    if not ffmpeg_status["installed"]:
        missing.append("ffmpeg")
    if not whisper_status["installed"]:
        missing.append("whisper")

    if not missing:
        print("\n✓ 所有依赖已就绪！")
        if args.json:
            print(f"\n__RESULT__:{{\"ready\": true, \"platform\": \"{plat}\"}}")
        return

    print(f"\n⚠ 缺少依赖: {', '.join(missing)}")

    if args.install:
        print("\n尝试自动安装...\n")
        if "ffmpeg" in missing:
            if install_ffmpeg(plat):
                print("  ✓ ffmpeg 安装成功")
                missing.remove("ffmpeg")
            else:
                print("  ✗ ffmpeg 自动安装失败")

        if "whisper" in missing:
            if install_whisper():
                print("  ✓ whisper 安装成功")
                missing.remove("whisper")
            else:
                print("  ✗ whisper 自动安装失败")

    if missing:
        print_install_guide(plat, missing)
        if args.json:
            print(f"\n__RESULT__:{{\"ready\": false, \"missing\": {missing}, \"platform\": \"{plat}\"}}")
        sys.exit(1)
    else:
        print("\n✓ 所有依赖已就绪！")
        if args.json:
            print(f"\n__RESULT__:{{\"ready\": true, \"platform\": \"{plat}\"}}")


if __name__ == "__main__":
    main()
