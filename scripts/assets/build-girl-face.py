#!/usr/bin/env python
"""从桌宠图集逐帧测出「脸块」与「墨框」，生成 girl-face-meta.ts。

用法（需要 Pillow + opencv-python + numpy）：
    python scripts/assets/build-girl-face.py

为什么要这张表：
  猫娘的帧是位图，脸在格子里的位置逐帧不同（坐下、举手、鞠躬时整身都在移动）。
  表情记号（腮红、汗滴、「！」、眩晕星）若按固定格坐标钉，会落在头发或空气上。
  这里在构建期把每帧的脸量出来，运行时只做「格内比例 → 绘制空间」的线性换算。

脸的判据（2026-10-25 按 146 帧实测校准，探测图见 .cache/girl-face-probe.png）：
  1. 取最大连通域（排除闪烁星星/尘土）；
  2. 在该帧墨框上沿往下 58% 的范围内找「亮部」（min(r,g,b) > 120）；
  3. 最大亮部连通域即脸部皮肤。猫耳内侧的粉、衣服的白都更暗或更小，
     举手时手套虽然亮，但面积远小于脸。

产物（提交进 git）：
    src/renderer/pet/girl-face-meta.ts
"""
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ATLAS = os.path.join(ROOT, "src", "renderer", "public", "pet", "girl-anim.webp")
OUT = os.path.join(ROOT, "src", "renderer", "pet", "girl-face-meta.ts")

CELL_W, CELL_H = 170, 124
COLS, COUNT = 10, 146

ALPHA_MIN = 24
BRIGHT_MIN = 120
FACE_BAND = 0.58


def main_component(alpha: np.ndarray) -> np.ndarray:
    mask = (alpha > ALPHA_MIN).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        raise RuntimeError("空帧")
    best = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])
    return labels == best


def measure(cell: np.ndarray) -> tuple[tuple[float, float, float, float], tuple[float, float, float, float]]:
    alpha = cell[:, :, 3]
    main = main_component(alpha)
    ys, xs = np.where(main)
    if len(xs) == 0:
        raise RuntimeError("主连通域为空")
    ix0, iy0, ix1, iy1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    ink = (ix0 / CELL_W, iy0 / CELL_H, (ix1 - ix0 + 1) / CELL_W, (iy1 - iy0 + 1) / CELL_H)

    rgb = cell[:, :, :3].astype(np.int32)
    bright = ((rgb.min(axis=2) > BRIGHT_MIN) & main).astype(np.uint8)
    cut = int(iy0 + (iy1 - iy0) * FACE_BAND)
    bright[cut:, :] = 0
    n, _, stats, cents = cv2.connectedComponentsWithStats(bright, connectivity=8)
    if n <= 1:
        raise RuntimeError("该帧找不到脸")
    best = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])
    fx, fy, fw, fh, area = (int(v) for v in stats[best])
    area = int(stats[best, cv2.CC_STAT_AREA])
    if area < 120:
        raise RuntimeError(f"脸块太小：{area}px")
    cx, cy = cents[best]
    face = (cx / CELL_W, cy / CELL_H, fw / CELL_W, fh / CELL_H)

    # 脸必须落在墨框里，且不应该贴到墨框顶部/底部（那是头发与脚）
    if not (ix0 <= cx <= ix1 and iy0 <= cy <= iy1):
        raise RuntimeError(f"脸心 {cx:.0f},{cy:.0f} 跑出墨框 {ix0},{iy0}..{ix1},{iy1}")
    if not (0.10 <= face[0] <= 0.90 and 0.10 <= face[1] <= 0.70):
        raise RuntimeError(f"脸心比例异常：{face}")
    if not (0.08 <= face[2] <= 0.40 and 0.12 <= face[3] <= 0.50):
        raise RuntimeError(f"脸块尺寸异常：{face}")
    return face, ink


def main() -> int:
    im = Image.open(ATLAS).convert("RGBA")
    faces: list[tuple[float, float, float, float]] = []
    inks: list[tuple[float, float, float, float]] = []
    for i in range(COUNT):
        x = (i % COLS) * CELL_W
        y = (i // COLS) * CELL_H
        cell = np.asarray(im.crop((x, y, x + CELL_W, y + CELL_H)))
        face, ink = measure(cell)
        faces.append(face)
        inks.append(ink)

    face_lines = "\n".join(
        "  [%.5f, %.5f, %.5f, %.5f]," % f for f in faces
    )
    ink_lines = "\n".join(
        "  [%.5f, %.5f, %.5f, %.5f]," % k for k in inks
    )
    meta = f"""// 由 scripts/assets/build-girl-face.py 从 girl-anim.webp 实测生成，不要手改。
// 每帧一格，比例都是「格子内的 0..1」（不是绘制空间）。
/** 脸部皮肤块：脸心 cx/cy + 宽高（用于腮红、汗滴、「！」等记号的落位）。 */
export const GIRL_FACE: ReadonlyArray<readonly [number, number, number, number]> = [
{face_lines}
];

/** 主体墨框（已排除闪烁星星/尘土）：x/y/宽/高（用于脚底投影宽度与越界检查）。 */
export const GIRL_INK_BOX: ReadonlyArray<readonly [number, number, number, number]> = [
{ink_lines}
];
"""
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(meta)

    fx = [v[0] for v in faces]
    fy = [v[1] for v in faces]
    fw = [v[2] for v in faces]
    fh = [v[3] for v in faces]
    print(f"wrote {OUT}")
    print(f"  frames={len(faces)} face cx={min(fx):.3f}..{max(fx):.3f} cy={min(fy):.3f}..{max(fy):.3f}")
    print(f"  face w={min(fw):.3f}..{max(fw):.3f} h={min(fh):.3f}..{max(fh):.3f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
