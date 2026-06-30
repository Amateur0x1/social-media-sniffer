#!/usr/bin/env python3
"""
视频内容提取脚本（跨平台：macOS / Linux / Windows）

功能：下载视频 → 每秒截帧 → 提取音频 → whisper 转写

用法:
    python extract_video.py <video_url> <output_dir> [--note-id NOTE_ID] [--whisper-model base]

参数:
    video_url    - 视频下载地址
    output_dir   - 输出目录（会自动创建）
    --note-id    - 可选，笔记 ID，用于日志标识
    --whisper-model - whisper 模型，默认 base（可选 small/medium/large）

输出结构:
    output_dir/
    ├── video.mp4
    ├── frames/
    │   ├── frame_001.jpg
    │   ├── frame_002.jpg
    │   └── ...
    ├── audio.wav
    └── transcript.txt
"""

import argparse
import os
import subprocess
import sys
import urllib.request
import json


def check_dependency(cmd):
    """检查命令是否可用"""
    try:
        subprocess.run(
            [cmd, "-version"] if cmd == "ffmpeg" else [cmd, "--help"],
            capture_output=True,
            timeout=10
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def download_file(url, output_path, timeout=300):
    """下载文件"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            with open(output_path, "wb") as f:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
        return True
    except Exception as e:
        print(f"  ✗ 下载失败: {e}", file=sys.stderr)
        return False


def get_video_duration(video_path):
    """获取视频时长（秒）"""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", video_path],
        capture_output=True, text=True
    )
    try:
        return int(float(result.stdout.strip()))
    except (ValueError, AttributeError):
        return 0


def extract_frames(video_path, frames_dir):
    """每秒截取一帧"""
    os.makedirs(frames_dir, exist_ok=True)
    result = subprocess.run(
        ["ffmpeg", "-i", video_path, "-vf", "fps=1", "-q:v", "2",
         os.path.join(frames_dir, "frame_%03d.jpg")],
        capture_output=True
    )
    if result.returncode != 0:
        print(f"  ✗ 截帧失败: {result.stderr.decode()[:200]}", file=sys.stderr)
        return False
    return True


def extract_audio(video_path, audio_path):
    """提取音频为 WAV"""
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", video_path, "-vn",
         "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audio_path],
        capture_output=True
    )
    if result.returncode != 0:
        print(f"  ✗ 音频提取失败: {result.stderr.decode()[:200]}", file=sys.stderr)
        return False
    return True


def transcribe_audio(audio_path, output_dir, model="base"):
    """用 whisper 转写音频"""
    result = subprocess.run(
        ["whisper", audio_path, "--model", model, "--language", "zh",
         "--output_dir", output_dir, "--output_format", "txt"],
        capture_output=True
    )
    if result.returncode != 0:
        print(f"  ✗ 转写失败: {result.stderr.decode()[:200]}", file=sys.stderr)
        return False

    # whisper 输出文件名是 audio.txt，重命名为 transcript.txt
    audio_txt = os.path.join(output_dir, "audio.txt")
    transcript_path = os.path.join(output_dir, "transcript.txt")
    if os.path.exists(audio_txt):
        os.replace(audio_txt, transcript_path)
    return os.path.exists(transcript_path)


def main():
    parser = argparse.ArgumentParser(description="视频内容提取（跨平台）")
    parser.add_argument("video_url", help="视频下载地址")
    parser.add_argument("output_dir", help="输出目录")
    parser.add_argument("--note-id", default="unknown", help="笔记 ID")
    parser.add_argument("--whisper-model", default="base", help="whisper 模型 (base/small/medium/large)")
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output_dir)
    frames_dir = os.path.join(output_dir, "frames")
    video_path = os.path.join(output_dir, "video.mp4")
    audio_path = os.path.join(output_dir, "audio.wav")

    os.makedirs(frames_dir, exist_ok=True)

    print(f"=== 视频提取 [note_id: {args.note_id}] ===")

    # Step 1: 下载视频
    print("[1/4] 下载视频...")
    if not download_file(args.video_url, video_path):
        sys.exit(1)
    size_mb = os.path.getsize(video_path) / (1024 * 1024)
    print(f"  ✓ 下载完成: {size_mb:.1f}MB")

    # Step 2: 获取时长并截帧
    duration = get_video_duration(video_path)
    print(f"  视频时长: {duration}s")

    print(f"[2/4] 每秒截帧...")
    if extract_frames(video_path, frames_dir):
        frame_count = len([f for f in os.listdir(frames_dir) if f.endswith(".jpg")])
        print(f"  ✓ {frame_count} 帧")
    else:
        print("  ✗ 截帧失败，继续后续步骤")

    # Step 3: 提取音频
    print("[3/4] 提取音频...")
    if extract_audio(video_path, audio_path):
        size_mb = os.path.getsize(audio_path) / (1024 * 1024)
        print(f"  ✓ 音频提取完成: {size_mb:.1f}MB")
    else:
        print("  ✗ 音频提取失败，跳过转写")
        sys.exit(1)

    # Step 4: Whisper 转写
    if check_dependency("whisper"):
        print(f"[4/4] Whisper 转写 (模型: {args.whisper_model})...")
        if transcribe_audio(audio_path, output_dir, args.whisper_model):
            transcript_path = os.path.join(output_dir, "transcript.txt")
            size = os.path.getsize(transcript_path)
            print(f"  ✓ 转写完成: {size} 字节")
        else:
            print("  ✗ 转写失败")
    else:
        print("[4/4] 跳过转写（whisper 未安装）")

    print(f"\n=== 完成 ===")
    print(f"输出目录: {output_dir}")

    # 输出 JSON 结果（供调用方解析）
    result = {
        "note_id": args.note_id,
        "output_dir": output_dir,
        "duration": duration,
        "frames": len([f for f in os.listdir(frames_dir) if f.endswith(".jpg")]) if os.path.exists(frames_dir) else 0,
        "has_transcript": os.path.exists(os.path.join(output_dir, "transcript.txt")),
        "success": True
    }
    print(f"\n__RESULT__:{json.dumps(result)}")


if __name__ == "__main__":
    main()
