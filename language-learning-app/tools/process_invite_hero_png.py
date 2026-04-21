#!/usr/bin/env python3
"""Remove matte black from invite hero PNG: preserve blue shadow, soften alpha to reduce fringing."""
from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


def has_blue_cast(r: int, g: int, b: int) -> bool:
    """True for shadow / icon blues — do not treat as flat black background."""
    return b > r + 4 and b > g + 2


def edge_flood_mask(w: int, h: int, rgb_load, sum_max: int = 50) -> bytearray:
    """1 = remove (matte), 0 = keep. Flood from image border through dark neutral pixels only."""

    def is_matte(x: int, y: int) -> bool:
        r, g, b = rgb_load[x, y]
        if r + g + b > sum_max:
            return False
        if has_blue_cast(r, g, b):
            return False
        return True

    remove = bytearray(w * h)

    def i(x: int, y: int) -> int:
        return y * w + x

    q: deque[tuple[int, int]] = deque()
    for x in range(w):
        for y in (0, h - 1):
            j = i(x, y)
            if is_matte(x, y) and not remove[j]:
                remove[j] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            j = i(x, y)
            if is_matte(x, y) and not remove[j]:
                remove[j] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                j = i(nx, ny)
                if not remove[j] and is_matte(nx, ny):
                    remove[j] = 1
                    q.append((nx, ny))
    return remove


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--blur", type=float, default=1.6, help="Gaussian blur radius on alpha (reduces speckles)")
    args = ap.parse_args()

    src_img = Image.open(args.src).convert("RGBA")
    w, h = src_img.size
    rgb = src_img.convert("RGB")
    rgb_load = rgb.load()

    remove = edge_flood_mask(w, h, rgb_load)
    alpha = Image.new("L", (w, h), 255)
    apx = alpha.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            if remove[row + x]:
                apx[x, y] = 0

    if args.blur > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(radius=args.blur))

    r, g, b = rgb.split()
    out = Image.merge("RGBA", (r, g, b, alpha))
    args.dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.dst, optimize=True)
    print("wrote", args.dst, w, h)


if __name__ == "__main__":
    main()
