#!/usr/bin/env python
"""桌宠猫娘姿态图集：8 格「坐着/蜷着/回头/伸懒腰/跑/跳/抱心/站」静帧。

用法（需要 Pillow + numpy + opencv）：
    python scripts/assets/build-girl-poses.py   # 先产出 7 格高清姿态表
    python scripts/assets/build-girl-pet-poses.py

输入：scripts/assets/generated/girl-poses.png（build-girl-poses.py 的 7 格产物）
产物（提交进 git）：
    scripts/assets/generated/girl-pet-poses.png 8 格图集，每格 340×248
    src/renderer/public/pet/girl-poses.webp     桌宠运行时图集（带透明通道）
    src/renderer/pet/girl-pet-poses-meta.ts     格号 / 锚点 / 每格的墨框与脸框

为什么在 7 格表上再切一刀：
  那张表的 `sitwave` / `curl` 是真正的坐姿，`lookback` 是真正的回头；桌宠以前的坐/趴
  是把跳舞帧压扁（v1.13 的 sprawl），用户一眼就看出来「还是那支舞」。这里把真姿态
  单独装成桌宠表，让待机底子不再是舞蹈。

为什么要 inpaint 一颗心：
  `heart` 是「双手捧心」——心是道具，不是她身体的一部分。待机站着时捧一颗心会读成
  「一直在示爱」。把心抠掉、保留合抱的爪子，就得到一张安静的站立底图；原图另存为
  `love` 格，留给「想你了」的稀有瞬间。
"""
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_ATLAS = os.path.join(ROOT, "scripts", "assets", "generated", "girl-poses.png")
OUT_ATLAS = os.path.join(ROOT, "scripts", "assets", "generated", "girl-pet-poses.png")
OUT_WEBP = os.path.join(ROOT, "src", "renderer", "public", "pet", "girl-poses.webp")
OUT_META = os.path.join(ROOT, "src", "renderer", "pet", "girl-pet-poses-meta.ts")

CELL_W, CELL_H = 340, 248
ANCHOR_X = CELL_W // 2
ANCHOR_Y = 238
INK_REF_PX = 229.0
INK_VB = 91
COLS = 8
ROWS = 1

SOURCE_ORDER = ["sitwave", "heart", "jump", "run", "stretch", "lookback", "curl"]

# 输出格号 / 源格 / 脸框（格子像素，cx,cy,w,h）/ 是否把胸前那颗心 inpaint 掉
# 脸框是 2026-10-26 在 2× 网格图上逐格量的：白脸（含眼与腮）的包围盒，
# 不含耳朵与后脑。记号（腮红/Zzz/饰品）只认这张脸，不认整颗头。
POSES = [
    ("stand", "heart", (170, 102, 100, 78), True),
    ("sit", "sitwave", (167, 104, 100, 78), False),
    ("curl", "curl", (158, 122, 108, 80), False),
    ("look", "lookback", (148, 104, 96, 80), False),
    ("stretch", "stretch", (156, 108, 98, 80), False),
    ("run", "run", (160, 109, 98, 80), False),
    ("joy", "jump", (160, 108, 98, 80), False),
    ("love", "heart", (170, 102, 100, 78), False),
]

# 心形道具的紧掩膜（格子像素）。只在 `heart` 源格上用；爪子在心后面，inpaint 会补上。
HEART_MASK = (140, 127, 164, 149)


def cell_of(atlas: Image.Image, name: str) -> Image.Image:
    i = SOURCE_ORDER.index(name)
    return atlas.crop((i * CELL_W, 0, (i + 1) * CELL_W, CELL_H))


def remove_heart(cell: Image.Image) -> Image.Image:
    arr = np.asarray(cell.convert("RGBA")).copy()
    x0, y0, x1, y1 = HEART_MASK
    mask = np.zeros(arr.shape[:2], np.uint8)
    mask[y0:y1, x0:x1] = 255
    bgr = cv2.cvtColor(arr[:, :, :3], cv2.COLOR_RGB2BGR)
    filled = cv2.inpaint(bgr, mask, 3, cv2.INPAINT_TELEA)
    arr[:, :, :3] = cv2.cvtColor(filled, cv2.COLOR_BGR2RGB)
    return Image.fromarray(arr, "RGBA")


def ink_box(cell: Image.Image) -> tuple[int, int, int, int]:
    alpha = np.asarray(cell.getchannel("A"))
    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        raise RuntimeError("空格子")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def main() -> int:
    if not os.path.exists(SRC_ATLAS):
        raise RuntimeError(f"缺 7 格高清姿态表：{SRC_ATLAS}（先跑 build-girl-poses.py）")
    src = Image.open(SRC_ATLAS).convert("RGBA")
    if src.size != (CELL_W * len(SOURCE_ORDER), CELL_H):
        raise RuntimeError(f"源表尺寸 {src.size} ≠ 7 格 {CELL_W}×{CELL_H}")

    cells = []
    inks = []
    for name, source, face, strip_heart in POSES:
        cell = cell_of(src, source)
        if strip_heart:
            cell = remove_heart(cell)
        cells.append((name, cell, face))
        inks.append(ink_box(cell))

    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
    for i, (name, cell, face) in enumerate(cells):
        atlas.alpha_composite(cell, (i * CELL_W, 0))
        print(f"{name:8s} cell={i} ink={inks[i]} face={face}")

    os.makedirs(os.path.dirname(OUT_ATLAS), exist_ok=True)
    atlas.save(OUT_ATLAS, "PNG", optimize=True)
    os.makedirs(os.path.dirname(OUT_WEBP), exist_ok=True)
    atlas.save(OUT_WEBP, "WEBP", lossless=True, quality=100, method=6)

    cells_lines = "\n".join(f'  {name}: {i},' for i, (name, _, _) in enumerate(cells))
    ink_lines = "\n".join(
        f'  {name}: [{inks[i][0]}, {inks[i][1]}, {inks[i][2]}, {inks[i][3]}],'
        for i, (name, _, _) in enumerate(cells)
    )
    face_lines = "\n".join(
        f'  {name}: [{face[0]}, {face[1]}, {face[2]}, {face[3]}],'
        for name, _, face in cells
    )
    meta = f"""// 由 scripts/assets/build-girl-pet-poses.py 生成；改姿态请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/generated/girl-poses.png（7 张高清立绘，1136×912，浅粉纯底）。
// `stand` 是把 `heart` 胸前那颗心 inpaint 掉后的合爪站姿；`love` 保留原图。
export const GIRL_PET_POSES = {{
  src: "./pet/girl-poses.webp",
  cellW: {CELL_W},
  cellH: {CELL_H},
  cols: {COLS},
  rows: {ROWS},
  count: {len(cells)},
  /** 躯干轴在格子里的位置（0..1）。 */
  anchorX: {ANCHOR_X / CELL_W:.6f},
  anchorY: {ANCHOR_Y / CELL_H:.6f},
  /** 站立帧的墨高（图集像素）→ 与静态立绘同一条 91vb 的尺。 */
  inkRefPx: {INK_REF_PX},
  inkVb: {INK_VB},
}} as const;

/** 姿态名 → 格号。 */
export const GIRL_PET_POSE_CELLS = {{
{cells_lines}
}} as const;

export type GirlPoseId = keyof typeof GIRL_PET_POSE_CELLS;

/** 每格的墨框（格子像素 [x0, y0, x1, y1] 边缘坐标），alpha 实测。 */
export const GIRL_PET_POSE_INK: Record<GirlPoseId, readonly [number, number, number, number]> = {{
{ink_lines}
}};

/** 每格的脸框（格子像素 [cx, cy, w, h]），2× 网格逐格手工量；只含白脸，不含耳朵。 */
export const GIRL_PET_POSE_FACE: Record<GirlPoseId, readonly [number, number, number, number]> = {{
{face_lines}
}};
"""
    with open(OUT_META, "w", encoding="utf-8", newline="\n") as f:
        f.write(meta)

    print("atlas", OUT_ATLAS, os.path.getsize(OUT_ATLAS) // 1024, "KB")
    print("webp ", OUT_WEBP, os.path.getsize(OUT_WEBP) // 1024, "KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
