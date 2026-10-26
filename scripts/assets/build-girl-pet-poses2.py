#!/usr/bin/env python
"""桌宠猫娘姿态图集 II：把「趴下 / 打哈欠 / 洗脸 / 歪头 / 招手 / 鞠躬 / 剪刀手 / 正坐」
装成一张静帧图集。

用法（需要 Pillow + numpy + opencv）：
    python scripts/assets/build-girl-pet-poses2.py            # 产出图集 + 脸框量测底图
    python scripts/assets/build-girl-pet-poses2.py --no-meta  # 只出图，不写 meta（量脸框时用）

输入：scripts/assets/source/poses2/*.png（8 张 1280×1024，浅粉纯底，同一角色同一画风）
产物（提交进 git）：
    scripts/assets/generated/girl-pet-poses2.png   8 格图集
    src/renderer/public/pet/girl-poses2.webp       桌宠运行时图集（带透明通道）
    src/renderer/pet/girl-pet-poses2-meta.ts       格号 / 锚点 / 每格的墨框与脸框

为什么这一张要「全表同一把尺」而不是每格各自撑满墨高：
  图集 I 的七格都是站着/坐着/蜷着的竖构图，逐格把墨高归一到 229px 没问题。
  但 `prone`（趴着）本身就是一个又扁又宽的剪影——按墨高归一会把一只趴着的猫放大成
  「和站着一样高」，渲染层按 `inkVb / inkRefPx` 一条比例尺换算，她会直接撑出窗口。
  所以这里用**一个参考格（`wave`，站姿）定死缩放**，其余七格沿用同一个 scale：
  身体像素尺寸不变，换姿态只换剪影。趴着就该又矮又宽。
"""
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_DIR = os.path.join(ROOT, "scripts", "assets", "source", "poses2")
GEN = os.path.join(ROOT, "scripts", "assets", "generated")
OUT_ATLAS = os.path.join(GEN, "girl-pet-poses2.png")
OUT_SHEET = os.path.join(SRC_DIR, "_measured.png")
OUT_WEBP = os.path.join(ROOT, "src", "renderer", "public", "pet", "girl-poses2.webp")
OUT_META = os.path.join(ROOT, "src", "renderer", "pet", "girl-pet-poses2-meta.ts")

CELL_W, CELL_H = 400, 248
ANCHOR_X = 200          # 躯干轴：站姿脚心在格子的这条竖线上
ANCHOR_Y = 238          # 脚线（地面）
INK_REF_PX = 229.0      # 与图集 I / 静态立绘同一条 91vb 的尺
INK_VB = 91
COLS, ROWS = 8, 1

ORDER = ["prone", "yawn", "wash", "tilt", "wave", "bow", "peace", "kneel"]
REF_POSE = "wave"

# 脸框（格子像素 cx,cy,w,h）：2026-10-26 在 _measured.png 的 20px 网格上逐格量的，
# 只含白脸（含眼与腮），不含耳朵与后脑。记号（腮红/Zzz/饰品/「!」）只认这张脸。
FACE: dict[str, tuple[int, int, int, int]] = {
    "prone": (172, 154, 85, 72),
    "yawn": (200, 96, 100, 68),
    "wash": (197, 101, 95, 67),
    "tilt": (195, 98, 86, 60),
    "wave": (195, 82, 74, 60),
    "bow": (182, 110, 66, 50),
    "peace": (202, 90, 75, 56),
    "kneel": (185, 120, 74, 56),
}


def key_out(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """色差种子 → 只留角色主体（最大连通域）→ 外缘软 alpha。与图集 I 同一套。"""
    edge = np.concatenate([
        rgb[:8, :, :].reshape(-1, 3), rgb[-8:, :, :].reshape(-1, 3),
        rgb[:, :8, :].reshape(-1, 3), rgb[:, -8:, :].reshape(-1, 3),
    ])
    bg = np.median(edge, axis=0)
    dist = np.linalg.norm(rgb - bg, axis=2)

    seed = (dist > 40.0).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(seed, connectivity=8)
    if n <= 1:
        raise RuntimeError("没找到角色主体")
    main = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])

    mask = (lab == main).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    main2 = max(range(1, n2), key=lambda i: stats2[i, cv2.CC_STAT_AREA])
    solid = (lab2 == main2).astype(np.uint8)
    ff = solid.copy()
    hh, ww = solid.shape
    m2 = np.zeros((hh + 2, ww + 2), np.uint8)
    cv2.floodFill(ff, m2, (0, 0), 1)
    solid = solid | (1 - ff)

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


def cut(name: str) -> tuple[Image.Image, tuple[int, int, int, int], float]:
    """抠像 + 去污色 → (RGBA 整幅, 墨框, 脚心 x)。"""
    path = os.path.join(SRC_DIR, f"{name}.png")
    if not os.path.exists(path):
        raise RuntimeError(f"缺参考图：{path}")
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    alpha, bg = key_out(rgb)
    x0, y0, x1, y1 = bbox_of(alpha)
    a3 = alpha[:, :, None]
    fg = np.where(a3 > 0.004, (rgb - (1.0 - a3) * bg) / np.maximum(a3, 0.004), rgb)
    out = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
    out[:, :, :3] = np.clip(fg, 0, 255).astype(np.uint8)
    out[:, :, 3] = np.round(alpha * 255).astype(np.uint8)
    ink_h = y1 - y0
    band = out[max(y0, y1 - max(2, round(ink_h * 0.06))):y1, :, 3]
    bx = np.nonzero((band > 128).any(axis=0))[0]
    feet_x = float((bx.min() + bx.max() + 1) / 2) if len(bx) else (x0 + x1) / 2
    return Image.fromarray(out, "RGBA"), (x0, y0, x1, y1), feet_x


def main() -> int:
    os.makedirs(GEN, exist_ok=True)
    raw = {name: cut(name) for name in ORDER}
    ref_box = raw[REF_POSE][1]
    scale = INK_REF_PX / (ref_box[3] - ref_box[1])

    cells = []
    for name in ORDER:
        im, (x0, y0, x1, y1), feet_x = raw[name]
        scaled = im.resize(
            (max(1, round(im.width * scale)), max(1, round(im.height * scale))),
            Image.LANCZOS,
        )
        sx, sy = feet_x * scale, y1 * scale
        cell = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
        cell.alpha_composite(scaled, (round(ANCHOR_X - sx), round(ANCHOR_Y - sy)))
        bb = cell.getchannel("A").getbbox()
        if bb is None:
            raise RuntimeError(f"{name} 落格后为空")
        if bb[0] < 0 or bb[1] < 0 or bb[2] > CELL_W or bb[3] > CELL_H:
            raise RuntimeError(f"{name} 溢出格子：{bb}（{CELL_W}×{CELL_H}）")
        cells.append((name, cell, bb))
        print(f"{name:6s} scale={scale:.4f} ink={bb} w={bb[2]-bb[0]} h={bb[3]-bb[1]}")

    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * ROWS), (0, 0, 0, 0))
    for i, (_, cell, _) in enumerate(cells):
        atlas.alpha_composite(cell, (i * CELL_W, 0))
    atlas.save(OUT_ATLAS, "PNG", optimize=True)

    # 量脸框用的底图：2× 放大 + 20px（原格像素）网格 + 标尺数字。
    # 分两张（各 4 格竖排），一张读到 800×1984 才还留得住 1px 的判读余量。
    for part, chunk in enumerate((cells[:4], cells[4:])):
        sheet = Image.new("RGBA", (CELL_W * 2, CELL_H * 2 * len(chunk)), (255, 255, 255, 255))
        d = ImageDraw.Draw(sheet)
        for row, (name, cell, bb) in enumerate(chunk):
            big = Image.new("RGBA", (CELL_W * 2, CELL_H * 2), (255, 255, 255, 255))
            big.alpha_composite(cell.resize((CELL_W * 2, CELL_H * 2), Image.NEAREST))
            gd = ImageDraw.Draw(big)
            for gx in range(0, CELL_W, 20):
                gd.line([(gx * 2, 0), (gx * 2, CELL_H * 2)], fill=(0, 200, 0, 120), width=1)
                if gx:
                    gd.text((gx * 2 + 2, 2), str(gx), fill=(200, 0, 0, 255))
            for gy in range(0, CELL_H, 20):
                gd.line([(0, gy * 2), (CELL_W * 2, gy * 2)], fill=(0, 200, 0, 120), width=1)
                if gy:
                    gd.text((2, gy * 2 + 1), str(gy), fill=(0, 0, 200, 255))
            sheet.alpha_composite(big, (0, row * CELL_H * 2))
            d.text((CELL_W * 2 - 120, row * CELL_H * 2 + 2), name, fill=(0, 0, 0, 255))
        out = OUT_SHEET.replace(".png", f"-{part + 1}.png")
        sheet.convert("RGB").save(out)
        print("sheet", out, sheet.size)

    missing = [n for n, _, _ in cells if n not in FACE]
    if missing:
        print(f"缺脸框：{missing}（在 {OUT_SHEET.replace('.png', '-N.png')} 上量完再填 FACE）")
        return 1
    for name, _, bb in cells:
        cx, cy, fw, fh = FACE[name]
        if not (bb[0] <= cx - fw / 2 and cx + fw / 2 <= bb[2]
                and bb[1] <= cy - fh / 2 and cy + fh / 2 <= bb[3]):
            raise RuntimeError(f"{name} 脸框超出墨框：face={FACE[name]} ink={bb}")
    if "--no-meta" in sys.argv:
        return 0

    cells_lines = "\n".join(f"  {name}: {i}," for i, (name, _, _) in enumerate(cells))
    ink_lines = "\n".join(
        f"  {name}: [{bb[0]}, {bb[1]}, {bb[2]}, {bb[3]}]," for name, _, bb in cells
    )
    face_lines = "\n".join(f"  {name}: [{', '.join(str(v) for v in FACE[name])}]," for name, _, _ in cells)
    meta = f"""// 由 scripts/assets/build-girl-pet-poses2.py 生成；改姿态请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/source/poses2/*.png（8 张 1280×1024 高清立绘，浅粉纯底）。
// 全表共用一个 scale（由 `{REF_POSE}` 站姿定尺）：趴着就是又矮又宽，不会被撑成站姿那么高。
export const GIRL_PET_POSES2 = {{
  src: "./pet/girl-poses2.webp",
  cellW: {CELL_W},
  cellH: {CELL_H},
  cols: {COLS},
  rows: {ROWS},
  count: {len(cells)},
  /** 躯干轴在格子里的位置（0..1）。 */
  anchorX: {ANCHOR_X / CELL_W:.6f},
  anchorY: {ANCHOR_Y / CELL_H:.6f},
  /** `{REF_POSE}` 的墨高（图集像素）→ 与图集 I / 静态立绘同一条 91vb 的尺。 */
  inkRefPx: {INK_REF_PX},
  inkVb: {INK_VB},
}} as const;

/** 姿态名 → 格号。 */
export const GIRL_PET_POSE2_CELLS = {{
{cells_lines}
}} as const;

export type GirlPose2Id = keyof typeof GIRL_PET_POSE2_CELLS;

/** 每格的墨框（格子像素 [x0, y0, x1, y1] 边缘坐标），alpha 实测。 */
export const GIRL_PET_POSE2_INK: Record<GirlPose2Id, readonly [number, number, number, number]> = {{
{ink_lines}
}};

/** 每格的脸框（格子像素 [cx, cy, w, h]），20px 网格逐格手工量；只含白脸，不含耳朵。 */
export const GIRL_PET_POSE2_FACE: Record<GirlPose2Id, readonly [number, number, number, number]> = {{
{face_lines}
}};
"""
    with open(OUT_META, "w", encoding="utf8", newline="\n") as f:
        f.write(meta)

    atlas.save(OUT_WEBP, "WEBP", lossless=True, quality=100, method=6)
    print("atlas", OUT_ATLAS, os.path.getsize(OUT_ATLAS) // 1024, "KB")
    print("webp ", OUT_WEBP, os.path.getsize(OUT_WEBP) // 1024, "KB")
    print("meta ", OUT_META)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
