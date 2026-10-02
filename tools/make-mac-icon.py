#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 build/liantai-app-icon-v3.png 生成 macOS 用的 build/icon.icns。

为什么需要这一步：
  Windows 的 .ico 是「满幅圆角方块」——图标自己填满整个画布。
  macOS 的规矩不是这样：1024 的画布里只有中间 824x824 是图形，四周留出透明边距，
  系统再按这套比例把图标放进 Dock。直接把满幅图当 .icns 用，Dock 里会比旁边所有图标
  大一圈，像是被放大了的缩略图。

做法（只用系统自带工具 + 纯标准库，不装任何依赖）：
  1) sips 把源图缩到 824x824（CoreGraphics 的缩放质量比自己写重采样好）；
  2) 本脚本用 zlib 把这张 824 的图贴进 1024x1024 的透明画布中央（纯拷贝，不重采样）；
  3) sips 生成 iconset 各档尺寸，iconutil 打成 .icns。

用法：
  python3 tools/make-mac-icon.py            # 默认写 build/icon.icns
  python3 tools/make-mac-icon.py --keep     # 保留中间产物（排查用）
"""

import os
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "build", "liantai-app-icon-v3.png")
OUT = os.path.join(ROOT, "build", "icon.icns")

CANVAS = 1024          # .icns 最大档的画布边长
CONTENT = 824          # macOS 图形在画布里的占比（Apple 的图标网格）
PAD = (CANVAS - CONTENT) // 2


def read_png_rgba(path):
    """读 8bit RGBA、非隔行的 PNG，返回 (宽, 高, bytearray)。别的格式直接报错。"""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("不是 PNG：" + path)

    pos = 8
    width = height = None
    idat = bytearray()
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            (width, height, depth, color, comp, filt, interlace) = struct.unpack(">IIBBBBB", body)
            if depth != 8 or color != 6 or interlace != 0:
                raise SystemExit(
                    "只支持 8bit RGBA 非隔行 PNG（当前 depth=%d color=%d interlace=%d）" % (depth, color, interlace)
                )
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break

    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    out = bytearray(stride * height)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if ftype == 1:      # Sub
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif ftype == 2:    # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:    # Average
            for i in range(stride):
                left = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:    # Paeth
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        elif ftype != 0:
            raise SystemExit("未知的 PNG 行过滤器：%d" % ftype)
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, out


def write_png_rgba(path, width, height, pixels):
    """写 8bit RGBA、逐行 filter=0 的 PNG。"""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw += pixels[y * stride:(y + 1) * stride]

    def chunk(ctype, body):
        return (
            struct.pack(">I", len(body))
            + ctype
            + body
            + struct.pack(">I", zlib.crc32(ctype + body) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)


def run(args):
    r = subprocess.run(args, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("命令失败：" + " ".join(args) + "\n" + r.stderr.decode("utf-8", "replace"))


def main():
    keep = "--keep" in sys.argv
    if not os.path.exists(SRC):
        raise SystemExit("找不到源图：" + SRC)

    tmp = tempfile.mkdtemp(prefix="liantai-icon-")
    content_png = os.path.join(tmp, "content.png")
    padded_png = os.path.join(tmp, "padded.png")
    iconset = os.path.join(tmp, "icon.iconset")
    os.makedirs(iconset, exist_ok=True)

    # 1) 缩放（交给 sips）
    run(["sips", "-z", str(CONTENT), str(CONTENT), SRC, "--out", content_png])

    # 2) 贴进透明画布
    w, h, px = read_png_rgba(content_png)
    if (w, h) != (CONTENT, CONTENT):
        raise SystemExit("缩放结果不是 %dx%d（拿到 %dx%d）" % (CONTENT, CONTENT, w, h))
    corner_alpha = px[3]   # 左上角像素的 alpha：应当是 0（源图自带圆角）
    canvas = bytearray(CANVAS * CANVAS * 4)
    for y in range(CONTENT):
        src_off = y * CONTENT * 4
        dst_off = ((y + PAD) * CANVAS + PAD) * 4
        canvas[dst_off:dst_off + CONTENT * 4] = px[src_off:src_off + CONTENT * 4]
    write_png_rgba(padded_png, CANVAS, CANVAS, canvas)

    # 3) iconset 各档尺寸（@2x 是同一张图，只是命名不同）
    specs = [
        (16, "icon_16x16.png"), (32, "icon_16x16@2x.png"),
        (32, "icon_32x32.png"), (64, "icon_32x32@2x.png"),
        (128, "icon_128x128.png"), (256, "icon_128x128@2x.png"),
        (256, "icon_256x256.png"), (512, "icon_256x256@2x.png"),
        (512, "icon_512x512.png"), (1024, "icon_512x512@2x.png"),
    ]
    for size, name in specs:
        out = os.path.join(iconset, name)
        if size == CANVAS:
            open(out, "wb").write(open(padded_png, "rb").read())
        else:
            run(["sips", "-z", str(size), str(size), padded_png, "--out", out])

    # 4) 打包
    run(["iconutil", "-c", "icns", iconset, "-o", OUT])
    print("已生成 " + OUT)
    print("  画布 %dx%d，图形 %dx%d，四周透明边距 %dpx（源图左上角 alpha=%d）" % (CANVAS, CANVAS, CONTENT, CONTENT, PAD, corner_alpha))
    if keep:
        print("中间产物保留在 " + tmp)


if __name__ == "__main__":
    main()
