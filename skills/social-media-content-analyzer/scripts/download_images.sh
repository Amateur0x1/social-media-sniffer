#!/bin/bash
# 图片批量下载脚本：下载笔记配图到本地以供分析
#
# 用法: bash download_images.sh <output_dir> <url1> [url2] [url3] ...
#
# 参数:
#   output_dir - 输出目录（会自动创建）
#   url1...    - 图片 URL 列表
#
# 输出:
#   output_dir/
#   ├── img_001.webp (或 .jpg/.png，取决于源格式)
#   ├── img_002.webp
#   └── ...

set -e

OUTPUT_DIR="$1"
shift

if [ -z "$OUTPUT_DIR" ] || [ $# -eq 0 ]; then
    echo "用法: bash download_images.sh <output_dir> <url1> [url2] ..."
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "=== 开始下载图片 (共 $# 张) ==="

COUNT=0
FAILED=0

for URL in "$@"; do
    COUNT=$((COUNT + 1))
    FILENAME=$(printf "img_%03d" $COUNT)
    
    # 从 URL 推断扩展名
    if echo "$URL" | grep -q "webp"; then
        EXT="webp"
    elif echo "$URL" | grep -q "png"; then
        EXT="png"
    else
        EXT="jpg"
    fi
    
    FILEPATH="$OUTPUT_DIR/${FILENAME}.${EXT}"
    
    if curl -sS -L -o "$FILEPATH" "$URL" --connect-timeout 15 --max-time 60; then
        SIZE=$(du -h "$FILEPATH" | cut -f1)
        echo "  ✓ [$COUNT/$#] ${FILENAME}.${EXT} ($SIZE)"
    else
        echo "  ✗ [$COUNT/$#] 下载失败: $URL"
        FAILED=$((FAILED + 1))
        rm -f "$FILEPATH"
    fi
done

echo ""
echo "=== 下载完成 ==="
echo "成功: $((COUNT - FAILED))/$COUNT"
if [ $FAILED -gt 0 ]; then
    echo "失败: $FAILED (URL 可能已过期)"
fi
echo "输出目录: $OUTPUT_DIR"
ls -la "$OUTPUT_DIR/" 2>/dev/null
