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
import time
import shutil
from urllib.parse import urlparse


def find_tool(name):
    path = shutil.which(name)
    if path:
        return path
    if sys.platform == "darwin":
        for root in ("/opt/homebrew/bin", "/usr/local/bin"):
            candidate = os.path.join(root, name)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return name


def check_dependency(cmd):
    """检查命令是否可用"""
    try:
        result = subprocess.run(
            [find_tool(cmd), "-version"] if cmd in ("ffmpeg", "ffprobe") else [find_tool(cmd), "--help"],
            capture_output=True,
            timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def download_file(url, output_path, timeout=300, referer=None):
    """下载文件"""
    try:
        headers = {"User-Agent": "Mozilla/5.0"}
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            total = int(response.headers.get("Content-Length") or 0)
            downloaded = 0
            started = last_report = time.monotonic()
            print(f"  下载 {os.path.basename(output_path)}" + (f"（共 {total / 1048576:.1f} MB）" if total else ""), flush=True)
            with open(output_path, "wb") as f:
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    now = time.monotonic()
                    if now - last_report >= 2:
                        speed = downloaded / max(now - started, 0.001) / 1048576
                        percent = f" / {total / 1048576:.1f} MB ({downloaded / total:.1%})" if total else " MB"
                        print(f"  已下载 {downloaded / 1048576:.1f}{percent}，平均 {speed:.2f} MB/s", flush=True)
                        last_report = now
            if total and downloaded != total:
                raise IOError(f"下载不完整：期望 {total} 字节，实际 {downloaded} 字节")
            print(f"  ✓ {os.path.basename(output_path)} 下载完成：{downloaded / 1048576:.1f} MB", flush=True)
        return True
    except Exception as e:
        print(f"  ✗ 下载失败: {e}", file=sys.stderr)
        return False


def is_bilibili_page(url):
    host = (urlparse(url).hostname or "").lower()
    return host in {"b23.tv", "bilibili.com", "www.bilibili.com", "m.bilibili.com"}


def download_video(url, output_path, audio_url=None, referer=None, cookies_from_browser=None):
    """页面链接交给 yt-dlp；直链可附带 Referer 和独立音轨。"""
    if is_bilibili_page(url):
        cmd = [sys.executable, "-m", "yt_dlp", "--no-playlist",
               "--format", "bv*+ba/b", "--merge-output-format", "mp4",
               "--remux-video", "mp4", "--ffmpeg-location", find_tool("ffmpeg"), "--output", output_path]
        if cookies_from_browser:
            cmd += ["--cookies-from-browser", cookies_from_browser]
        result = subprocess.run(cmd + [url], capture_output=True, text=True)
        if result.returncode:
            print(f"  ✗ B站下载失败（请安装/更新 yt-dlp，登录内容可用 --cookies-from-browser）: {result.stderr[-1500:]}", file=sys.stderr)
            return False
        return os.path.isfile(output_path)
    if audio_url:
        video_part = output_path + ".video"
        audio_part = output_path + ".audio"
        for source, path in ((url, video_part), (audio_url, audio_part)):
            # 只复用带完成标记的文件，避免把中断下载当作完整文件。
            marker = path + ".complete"
            if os.path.isfile(path) and os.path.isfile(marker):
                print(f"  复用已下载文件: {path}", flush=True)
                continue
            if os.path.exists(marker):
                os.remove(marker)
            if not download_file(source, path, referer=referer):
                return False
            with open(marker, "w") as f:
                f.write("complete")
        print("  正在合并视频和音轨…", flush=True)
        try:
            result = subprocess.run([find_tool("ffmpeg"), "-y", "-i", video_part, "-i", audio_part,
                                     "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", output_path],
                                    capture_output=True)
        except OSError as exc:
            print(f"  ✗ 无法运行 ffmpeg: {exc}；已保留音视频文件，修复后重新运行即可", file=sys.stderr)
            return False
        if result.returncode:
            print(f"  ✗ 合并失败: {result.stderr.decode(errors='replace')[-1500:]}；已保留音视频文件", file=sys.stderr)
            return False
        for path in (video_part, audio_part):
            os.remove(path)
            os.remove(path + ".complete")
        return True
    return download_file(url, output_path, referer=referer)


def get_video_duration(video_path):
    """获取视频时长（秒）"""
    result = subprocess.run(
        [find_tool("ffprobe"), "-v", "error", "-show_entries", "format=duration",
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
        [find_tool("ffmpeg"), "-i", video_path, "-vf", "fps=1", "-q:v", "2",
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
        [find_tool("ffmpeg"), "-y", "-i", video_path, "-vn",
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


def resolve_json_video(path, note_id="unknown"):
    """从扩展导出文件选择视频，同时保留音轨和防盗链请求头。"""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    notes = data.get("notes", [])
    if isinstance(notes, dict):
        notes = list(notes.values())
    notes = [n for n in notes if n.get("video") and
             (note_id == "unknown" or n.get("note_id") == note_id)]
    if len(notes) != 1:
        raise ValueError("请用 --note-id 指定一个视频；匹配到 %d 条" % len(notes))
    note = notes[0]
    video = note["video"]
    page = video.get("page_url")
    if not page and str(note.get("note_id", "")).startswith("BV"):
        page = "https://www.bilibili.com/video/" + note["note_id"]
    url = video.get("video_url") or page
    if not url:
        raise ValueError("所选视频没有可下载地址，请重新采集")
    return note["note_id"], url, video.get("audio_url"), video.get("referer") or page


def main():
    parser = argparse.ArgumentParser(description="视频内容提取（跨平台）")
    parser.add_argument("video_url", help="视频直链、B站页面链接或扩展导出的 JSON 文件路径")
    parser.add_argument("--audio-url", help="独立音轨 URL（B站 DASH）")
    parser.add_argument("--referer", help="下载请求 Referer")
    parser.add_argument("--cookies-from-browser", help="yt-dlp 读取登录状态的浏览器，如 chrome")
    parser.add_argument("output_dir", help="输出目录")
    parser.add_argument("--note-id", default="unknown", help="笔记 ID")
    parser.add_argument("--whisper-model", default="base", help="whisper 模型 (base/small/medium/large)")
    parser.add_argument("--download-only", action="store_true", help="只下载并合并视频，跳过截帧与转写")
    args = parser.parse_args()
    if os.path.isfile(args.video_url):
        try:
            args.note_id, args.video_url, audio_url, referer = resolve_json_video(args.video_url, args.note_id)
            args.audio_url = args.audio_url or audio_url
            args.referer = args.referer or referer
        except (ValueError, KeyError, OSError) as exc:
            parser.error(str(exc))

    required = [] if args.download_only else ["ffmpeg", "ffprobe"]
    if args.audio_url or is_bilibili_page(args.video_url):
        required.append("ffmpeg")
    for tool in set(required):
        if not check_dependency(tool):
            parser.error(f"找不到可用的 {tool}，请安装并加入 PATH（macOS: brew install ffmpeg）；尚未开始下载")

    output_dir = os.path.abspath(args.output_dir)
    frames_dir = os.path.join(output_dir, "frames")
    video_path = os.path.join(output_dir, "video.mp4")
    audio_path = os.path.join(output_dir, "audio.wav")

    os.makedirs(frames_dir, exist_ok=True)

    print(f"=== 视频提取 [note_id: {args.note_id}] ===")

    # Step 1: 下载视频
    print("[1/4] 下载视频...")
    if not download_video(args.video_url, video_path, args.audio_url, args.referer, args.cookies_from_browser):
        sys.exit(1)
    size_mb = os.path.getsize(video_path) / (1024 * 1024)
    print(f"  ✓ 下载完成: {size_mb:.1f}MB")

    if args.download_only:
        print(f"输出视频: {video_path}")
        print("__RESULT__:" + json.dumps({"note_id": args.note_id, "video_path": video_path, "success": True}))
        return

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
