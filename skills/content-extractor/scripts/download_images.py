#!/usr/bin/env python3
"""
图片批量下载脚本（跨平台：macOS / Linux / Windows）

用法:
    python download_images.py <output_dir> <url1> [url2] [url3] ...
    python download_images.py <output_dir> --urls-file urls.txt

参数:
    output_dir  - 输出目录（会自动创建）
    url1...     - 图片 URL 列表
    --urls-file - 从文件读取 URL（每行一个）

输出:
    output_dir/
    ├── img_01.webp
    ├── img_02.webp
    └── ...
"""

import argparse
import json
import os
import sys
import urllib.request


def guess_extension(url):
    """从 URL 推断文件扩展名"""
    url_lower = url.lower()
    if "webp" in url_lower:
        return "webp"
    elif "png" in url_lower:
        return "png"
    elif "gif" in url_lower:
        return "gif"
    else:
        return "jpg"


def download_file(url, output_path, timeout=30):
    """下载单个文件"""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            with open(output_path, "wb") as f:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    f.write(chunk)
        # 验证文件不为空
        if os.path.getsize(output_path) == 0:
            os.remove(output_path)
            return False
        return True
    except Exception:
        if os.path.exists(output_path):
            os.remove(output_path)
        return False


def main():
    parser = argparse.ArgumentParser(description="图片批量下载（跨平台）")
    parser.add_argument("output_dir", help="输出目录")
    parser.add_argument("urls", nargs="*", help="图片 URL 列表")
    parser.add_argument("--urls-file", help="从文件读取 URL（每行一个）")
    args = parser.parse_args()

    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    # 收集所有 URL
    urls = list(args.urls)
    if args.urls_file:
        with open(args.urls_file, "r") as f:
            urls.extend(line.strip() for line in f if line.strip())

    if not urls:
        print("错误: 没有提供任何 URL", file=sys.stderr)
        sys.exit(1)

    total = len(urls)
    success = 0
    failed = 0

    print(f"=== 开始下载图片 (共 {total} 张) ===")

    for idx, url in enumerate(urls, 1):
        ext = guess_extension(url)
        filename = f"img_{idx:02d}.{ext}"
        filepath = os.path.join(output_dir, filename)

        # 跳过已存在的文件
        if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
            success += 1
            continue

        if download_file(url, filepath):
            size_kb = os.path.getsize(filepath) / 1024
            print(f"  ✓ [{idx}/{total}] {filename} ({size_kb:.0f}KB)")
            success += 1
        else:
            print(f"  ✗ [{idx}/{total}] 下载失败")
            failed += 1

    print(f"\n=== 完成 ===")
    print(f"成功: {success}/{total}")
    if failed > 0:
        print(f"失败: {failed}")

    # 输出 JSON 结果（供调用方解析）
    result = {
        "output_dir": output_dir,
        "total": total,
        "success": success,
        "failed": failed
    }
    print(f"\n__RESULT__:{json.dumps(result)}")


if __name__ == "__main__":
    main()
