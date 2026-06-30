#!/bin/bash
# 视频分析脚本：下载视频 → 截取关键帧 → 提取音频 → whisper 转文字
#
# 用法: bash analyze_video.sh <video_url> <output_dir> [note_id]
#
# 参数:
#   video_url  - 视频下载地址
#   output_dir - 输出目录（会自动创建）
#   note_id    - 可选，用于日志标识
#
# 输出结构:
#   output_dir/
#   ├── video.mp4
#   ├── frames/
#   │   ├── frame_001.jpg (第1秒)
#   │   ├── frame_002.jpg ~ frame_006.jpg (等距帧)
#   ├── audio.wav
#   └── transcript.txt

set -e

VIDEO_URL="$1"
OUTPUT_DIR="$2"
NOTE_ID="${3:-unknown}"

if [ -z "$VIDEO_URL" ] || [ -z "$OUTPUT_DIR" ]; then
    echo "用法: bash analyze_video.sh <video_url> <output_dir> [note_id]"
    exit 1
fi

# 检查依赖
if ! command -v ffmpeg &> /dev/null; then
    echo "错误: 未找到 ffmpeg，请先安装"
    exit 1
fi

if ! command -v whisper &> /dev/null; then
    echo "警告: 未找到 whisper，将跳过语音转文字"
    SKIP_WHISPER=1
fi

echo "=== 开始分析视频 [note_id: $NOTE_ID] ==="

# 创建输出目录
mkdir -p "$OUTPUT_DIR/frames"

# Step 1: 下载视频
echo "[1/4] 下载视频..."
if curl -sS -L -o "$OUTPUT_DIR/video.mp4" "$VIDEO_URL" --connect-timeout 30 --max-time 300; then
    echo "  ✓ 视频下载完成: $(du -h "$OUTPUT_DIR/video.mp4" | cut -f1)"
else
    echo "  ✗ 视频下载失败，URL 可能已过期"
    exit 1
fi

# Step 2: 获取视频时长
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT_DIR/video.mp4" 2>/dev/null | cut -d. -f1)
echo "  视频时长: ${DURATION}s"

# Step 3: 截取关键帧
echo "[2/4] 截取关键帧..."

# 截取第1秒（封面/开头）
ffmpeg -y -ss 1 -i "$OUTPUT_DIR/video.mp4" -frames:v 1 -q:v 2 "$OUTPUT_DIR/frames/frame_001.jpg" 2>/dev/null
echo "  ✓ frame_001.jpg (1s - 开头)"

# 等距截取 5 帧
if [ "$DURATION" -gt 10 ]; then
    INTERVAL=$((DURATION / 6))
    for i in $(seq 2 6); do
        TIMESTAMP=$((INTERVAL * (i - 1)))
        if [ "$TIMESTAMP" -lt "$DURATION" ]; then
            ffmpeg -y -ss "$TIMESTAMP" -i "$OUTPUT_DIR/video.mp4" -frames:v 1 -q:v 2 "$OUTPUT_DIR/frames/frame_$(printf '%03d' $i).jpg" 2>/dev/null
            echo "  ✓ frame_$(printf '%03d' $i).jpg (${TIMESTAMP}s)"
        fi
    done
else
    # 短视频：每2秒截一帧
    FRAME_NUM=2
    for ts in $(seq 3 2 "$DURATION"); do
        ffmpeg -y -ss "$ts" -i "$OUTPUT_DIR/video.mp4" -frames:v 1 -q:v 2 "$OUTPUT_DIR/frames/frame_$(printf '%03d' $FRAME_NUM).jpg" 2>/dev/null
        echo "  ✓ frame_$(printf '%03d' $FRAME_NUM).jpg (${ts}s)"
        FRAME_NUM=$((FRAME_NUM + 1))
    done
fi

# Step 4: 提取音频
echo "[3/4] 提取音频..."
ffmpeg -y -i "$OUTPUT_DIR/video.mp4" -vn -acodec pcm_s16le -ar 16000 -ac 1 "$OUTPUT_DIR/audio.wav" 2>/dev/null
echo "  ✓ 音频提取完成: $(du -h "$OUTPUT_DIR/audio.wav" | cut -f1)"

# Step 5: Whisper 转文字
if [ -z "$SKIP_WHISPER" ]; then
    echo "[4/4] 语音转文字 (whisper base 模型)..."
    whisper "$OUTPUT_DIR/audio.wav" \
        --model base \
        --language zh \
        --output_dir "$OUTPUT_DIR" \
        --output_format txt \
        2>/dev/null

    # whisper 输出文件名是 audio.txt，重命名为 transcript.txt
    if [ -f "$OUTPUT_DIR/audio.txt" ]; then
        mv "$OUTPUT_DIR/audio.txt" "$OUTPUT_DIR/transcript.txt"
        echo "  ✓ 转写完成: $(wc -c < "$OUTPUT_DIR/transcript.txt") 字符"
    else
        echo "  ✗ 转写失败，未生成文件"
    fi
else
    echo "[4/4] 跳过语音转文字（whisper 未安装）"
fi

echo ""
echo "=== 分析完成 ==="
echo "输出目录: $OUTPUT_DIR"
echo "文件列表:"
ls -la "$OUTPUT_DIR/" 2>/dev/null
echo ""
echo "关键帧:"
ls "$OUTPUT_DIR/frames/" 2>/dev/null
