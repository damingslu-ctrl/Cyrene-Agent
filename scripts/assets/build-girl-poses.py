#!/usr/bin/env python
"""参考立绘（7 张高清姿态图）→ 客户端姿态静帧图集 + 桌宠高清立绘。

用法（需要 Pillow + numpy）：
    python scripts/assets/build-girl-poses.py

输入：scripts/assets/source/poses/*.jpg（1136×912，浅粉纯色底）
产物（提交进 git）：
    scripts/assets/generated/girl-poses.png   7 格图集，每格 340×248（与 girl-stills 同尺）
    src/renderer/pet/girl-poses-meta.ts       格号 / 锚点 / 墨高
    src/renderer/public/pet/girl-large.webp   高清整身立绘（512 高，Loading 与欢迎页用）

为什么用色差抠像而不是按亮度：
  底色是浅粉（≈248,237,241）而角色有大量白肚皮与白袜（≈250,250,250）——按亮度会把肚皮
  一起抠掉。改为「离底色多远」判前景，白肚皮与粉底的色差主要在绿/蓝通道上，能分开。
"""
import glob
import json
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_DIR = os.path.join(ROOT, "scripts", "assets", "source", "poses")
GEN = os.path.join(ROOT, "scripts", "assets", "generated")
OUT_ATLAS = os.path.join(GEN, "girl-poses.png")
OUT_META = os.path.join(ROOT, "src", "renderer", "pet", "girl-poses-meta.ts")
OUT_LARGE = os.path.join(ROOT, "src", "renderer", "public", "pet", "girl-large.webp")

# 顺序即格号；键要与 client 侧的姿态/情绪名对得上。
ORDER = ["sitwave", "heart", "jump", "run", "stretch", "lookback", "curl"]

# 12 个 PoseName → 高清格名。只列「参考图里有同类姿态」的 6 个：
# run 在 PoseName 里没有同类，不硬套；lie/prone/wash/yawn/sleep 五种参考图没覆盖。
POSE_FROM_HIRES = {
    "sit": "sitwave",
    "happy": "jump",
    "stretch": "stretch",
    "peek": "lookback",
    "pout": "heart",
    "tilt": "curl",
}

CELL_W, CELL_H = 340, 248          # 与 girl-stills 同尺（客户端 256px 图约 1:1）
ANCHOR_X = CELL_W // 2             # 躯干轴
ANCHOR_Y = 238                     # 脚线
INK_REF_PX = 229.0                 # 站立帧墨高（与 girl-stills 同一条 91vb 的尺）
INK_VB = 91
COLS = 7
ROWS = 1


def key_out(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """色差种子 → 只留角色主体（最大连通域）→ 外缘软 alpha。

    参考图背景不是纯色：角色后面有一团粉色柔光，还撒了星星与光斑。
    只按色差判前景会把这层光晕整片留下（深色桌布上看得见一片灰雾）。
    最大连通域与次大差了两个数量级（实测 274923 vs 1730），所以「只保留最大连通域
    并填洞」是稳的：星星与光斑都是独立小块，会被整片丢掉。
    """
    h, w, _ = rgb.shape
    edge = np.concatenate([
        rgb[:8, :, :].reshape(-1, 3), rgb[-8:, :, :].reshape(-1, 3),
        rgb[:, :8, :].reshape(-1, 3), rgb[:, -8:, :].reshape(-1, 3),
    ])
    bg = np.median(edge, axis=0)
    dist = np.linalg.norm(rgb - bg, axis=2)

    # 1) 硬种子：色差够大才算「确定是角色」；白肚皮与粉底的差在绿/蓝通道，t=40 实测安全。
    seed = (dist > 40.0).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(seed, connectivity=8)
    if n <= 1:
        raise RuntimeError("没找到角色主体")
    main = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])

    # 2) 闭运算焊上内部细缝（连体衣↔白袜），再取最大域的实心掩膜并填洞。
    mask = (lab == main).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    main2 = max(range(1, n2), key=lambda i: stats2[i, cv2.CC_STAT_AREA])
    solid = (lab2 == main2).astype(np.uint8)
    # 填洞：从边界泛洪背景，没被淹到的就是内部
    ff = solid.copy()
    hh, ww = solid.shape
    m2 = np.zeros((hh + 2, ww + 2), np.uint8)
    cv2.floodFill(ff, m2, (0, 0), 1)
    solid = solid | (1 - ff)

    # 3) 外缘软 alpha：只用与主体相邻的一圈按色差给过渡，避免硬边。
    ring = cv2.dilate(solid, np.ones((5, 5), np.uint8)) - solid
    soft = np.clip((dist - 12.0) / 28.0, 0.0, 1.0)
    soft = soft * soft * (3.0 - 2.0 * soft)
    alpha = np.where(solid > 0, 1.0, np.where(ring > 0, soft, 0.0)).astype(np.float32)
    return alpha, bg


def bbox_of(alpha: np.ndarray, thr: float = 8 / 255.0) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(alpha > thr)
    if len(xs) == 0:
        raise RuntimeError("抠像后为空")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def main() -> int:
    os.makedirs(GEN, exist_ok=True)
    paths = [os.path.join(SRC_DIR, n + ".jpg") for n in ORDER]
    for p in paths:
        if not os.path.exists(p):
            raise RuntimeError(f"缺参考图：{p}")

    cells = []
    feet_xs = []
    for name, p in zip(ORDER, paths):
        rgb = np.asarray(Image.open(p).convert("RGB")).astype(np.float32)
        alpha, bg = key_out(rgb)
        x0, y0, x1, y1 = bbox_of(alpha)
        # 去污色：C = a*F + (1-a)*B  →  F = (C - (1-a)*B) / a
        a3 = alpha[:, :, None]
        fg = np.where(a3 > 0.004, (rgb - (1.0 - a3) * bg) / np.maximum(a3, 0.004), rgb)
        out = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
        out[:, :, :3] = np.clip(fg, 0, 255).astype(np.uint8)
        out[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
        im = Image.fromarray(out, "RGBA")

        # 脚心 = 最底 6% 墨迹的横向中点（与 girl-stills 同一口径）
        ink_h = y1 - y0
        band = out[max(y0, y1 - max(2, round(ink_h * 0.06))):y1, :, 3]
        bx = np.nonzero((band > 128).any(axis=0))[0]
        feet_x = float((bx.min() + bx.max() + 1) / 2) if len(bx) else (x0 + x1) / 2
        feet_xs.append(feet_x)

        # 缩放到「墨高 = INK_REF_PX」，再按脚心/脚线钉到格子里
        scale = INK_REF_PX / ink_h
        new_w = max(1, round(im.width * scale))
        new_h = max(1, round(im.height * scale))
        scaled = im.resize((new_w, new_h), Image.LANCZOS)
        sx, sy = feet_x * scale, y1 * scale
        cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        cell.alpha_composite(scaled, (round(ANCHOR_X - sx), round(ANCHOR_Y - sy)))
        # 溢出格子就当场报错：宁可重取景，不要静默裁掉耳朵或脚
        bb = cell.getchannel("A").getbbox()
        if bb is None:
            raise RuntimeError(f"{name} 落格后为空")
        if bb[0] < 0 or bb[1] < 0 or bb[2] > CELL_W or bb[3] > CELL_H:
            raise RuntimeError(f"{name} 溢出格子：{bb}（{CELL_W}×{CELL_H}）")
        cells.append((name, cell, bb, ink_h, scale))

    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
    for i, (name, cell, bb, ink_h, scale) in enumerate(cells):
        atlas.alpha_composite(cell, (i * CELL_W, 0))
        print(f"{name:9s} ink={ink_h:4d}px scale={scale:.3f} bbox={bb}")

    atlas.save(OUT_ATLAS, "PNG", optimize=True)

    # 高清整身立绘：取「坐下打招呼」原图（构图最正），512 高
    rgb = np.asarray(Image.open(paths[0]).convert("RGB")).astype(np.float32)
    alpha, bg = key_out(rgb)
    x0, y0, x1, y1 = bbox_of(alpha)
    a3 = alpha[:, :, None]
    fg = np.where(a3 > 0.004, (rgb - (1.0 - a3) * bg) / np.maximum(a3, 0.004), rgb)
    out = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
    out[:, :, :3] = np.clip(fg, 0, 255).astype(np.uint8)
    out[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
    hero = Image.fromarray(out, "RGBA").crop((x0, y0, x1, y1))
    hero = hero.resize((round(hero.width * 512 / hero.height), 512), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT_LARGE), exist_ok=True)
    hero.save(OUT_LARGE, "WEBP", quality=92, method=6)

    cells_lines = "\n".join(f'  {n}: {i},' for i, n in enumerate(ORDER))
    map_lines = "\n".join(f'  {k}: "{v}",' for k, v in POSE_FROM_HIRES.items())
    meta = f"""// 由 scripts/assets/build-girl-poses.py 生成；改姿态请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/source/poses/*.jpg（用户给的 7 张高清立绘，1136×912，浅粉纯底）。
export const GIRL_HIRES = {{
  src: "./pet/girl-poses",
  cellW: {CELL_W},
  cellH: {CELL_H},
  cols: {COLS},
  rows: {ROWS},
  count: {len(ORDER)},
  /** 躯干轴在格子里的位置（0..1）。 */
  anchorX: {ANCHOR_X / CELL_W:.6f},
  anchorY: {ANCHOR_Y / CELL_H:.6f},
  /** 站立帧的墨高（图集像素）→ 与静态立绘同一条 91vb 的尺。 */
  inkRefPx: {INK_REF_PX},
  inkVb: {INK_VB},
}} as const;

/** 姿态名 → 格号。 */
export const GIRL_POSE_CELLS = {{
{cells_lines}
}} as const;

export type GirlPoseName = keyof typeof GIRL_POSE_CELLS;

/**
 * 12 个姿势名 → 高清姿态格名（只列有对应参考图的；其余仍取 30 格静帧表）。
 *
 * 7 张参考图能对上 6 个姿势；`run`（奔跑）在 12 个 PoseName 里没有同类，不硬套
 * （跑姿套到「鼓起脸」上比复用视频帧更假）。剩下 lie / prone / wash / yawn / sleep
 * 五种是「躺着/趴着/舔爪/打哈欠/睡着」，参考图里没有同类姿态，继续走静帧表。
 */
export const GIRL_POSE_FROM_HIRES: Partial<Record<string, GirlPoseName>> = {{
{map_lines}
}};
"""
    with open(OUT_META, "w", encoding="utf-8", newline="\n") as f:
        f.write(meta)

    print("atlas", OUT_ATLAS, os.path.getsize(OUT_ATLAS) // 1024, "KB")
    print("large", OUT_LARGE, os.path.getsize(OUT_LARGE) // 1024, "KB", hero.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
