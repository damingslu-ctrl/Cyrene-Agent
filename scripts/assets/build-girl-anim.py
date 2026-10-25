#!/usr/bin/env python
"""桌宠多帧动作图集 + 客户端多角度静帧：从启动动画的 146 帧（24fps）里切动作、归一化躯干、出两张图。

用法（需要 Pillow + opencv-python + numpy）：
    python scripts/assets/build-girl-anim.py
    python scripts/assets/build-girl-anim.py --sheet   # 额外出动作对位表到 .cache/pet-anim/

产物（提交进 git）：
    src/renderer/public/pet/girl-anim.webp     10 列图集，146 帧，每帧 170×124（半尺寸，桌宠用）
    src/renderer/pet/girl-anim-meta.ts         栅格 / 脚心 / 每段动作的帧区间
    scripts/assets/generated/girl-stills.png   30 帧全尺寸静帧（6×5，每格 340×248，客户端立绘用）
    scripts/assets/generated/girl-master.png   参考图母版抠像（1024×1536，欢迎页横幅用）
    src/renderer/pet/girl-stills-meta.ts       静帧格号 / 母版墨框（脚本生成，勿手改）

为什么桌宠图集是半尺寸：
  1. 304×248 的 146 帧解码后要 43MB，桌宠常驻，太重；
  2. 启动动画里镜头/站位是连续的，切到某个动作时角色会从画面一侧开始；
     桌宠要的是「每段动作都在自己的躯干轴上」，所以按段对齐躯干。
对齐只动 x 不动 y：镜头是固定的，纵向变化（下蹲/踮脚/鞠躬）都是动作本身，
把每帧底边钉到同一条线会把它们抹平。

对齐口径（2026-10-25 修）：躯干 = 最大连通域在 y∈[90,170] 的 alpha 加权横坐标。
  旧版用「底边 6px 的脚心」，坐下/伸懒腰时脚掌偏到一侧，每段动作被推歪 20px 以上；
  躯干轴与角色中心一致，且不受星星/脚掌朝向影响。**每段取中位数**挪到格心 x=170。
  注意旧版还有一处 off-by-18：`dx = 170-med` 又叠加了 `ox = 18+dx`，全表右移 18px，
  桌宠靠 anchorX=0.5 画时整只偏出命中框——这次一并修掉（ox 直接 = 170-med）。
"""
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "src", "renderer", "public", "pet-intro", "atlas.webp")
MASTER_SRC = os.path.join(ROOT, "scripts", "assets", "source", "girl-master.png")
OUT_IMG = os.path.join(ROOT, "src", "renderer", "public", "pet", "girl-anim.webp")
OUT_META = os.path.join(ROOT, "src", "renderer", "pet", "girl-anim-meta.ts")
GEN = os.path.join(ROOT, "scripts", "assets", "generated")
STILLS_OUT = os.path.join(GEN, "girl-stills.png")
MASTER_OUT = os.path.join(GEN, "girl-master.png")
STILLS_META_OUT = os.path.join(ROOT, "src", "renderer", "pet", "girl-stills-meta.ts")
CACHE = os.path.join(ROOT, ".cache", "pet-anim")

SRC_W, SRC_H = 304, 248
COLS = 10
COUNT = 146
HALF = 2
CELL_W, CELL_H = 340 // HALF, 248 // HALF          # 170×124（比原帧宽 36px，留给分镜横移）
ANCHOR_X = CELL_W // 2                              # 85
ANCHOR_Y = 238 // HALF                              # 119：脚线 = 原帧 y=238
INK_REF_PX = 229 / HALF                             # 站立帧墨高（半尺寸像素）
INK_VB = 91                                         # 与旧的静态立绘同一条尺

STILL_CELL_W, STILL_CELL_H = 340, 248               # 全尺寸静帧格（客户端 256px 图约 1:1）
STILL_COLS, STILL_ROWS = 6, 5
STILL_ANCHOR_X = STILL_CELL_W / 2                   # 170：躯干轴
STILL_ANCHOR_Y = 238                                # 与图集同一条脚线

# 帧区间即数据：每帧恰属一段，合计 0..145。段名只描述画面，播放参数在 girl-anim.ts。
# 2026-10-25 提帧：源片 146 帧 @24fps（6.08s），旧表是按 15fps 的 91 帧坐标写的；
# 下表换算到 24fps 全帧（逐段 = 旧段的时间区间 × 24），并按「唯一的画」重新对齐边界。
RANGES = {
    "idle": (0, 22),
    "shy": (23, 31),
    "peek": (32, 39),
    "sit": (40, 50),
    "sitShy": (51, 63),
    "walk": (64, 71),
    "wink": (72, 80),
    "drowse": (81, 87),
    "yawn": (88, 92),
    "stretch": (93, 98),
    "happy": (99, 106),
    "sleep": (107, 111),
    "wave": (112, 128),
    "peace": (129, 135),
    "bow": (136, 141),
    "stand": (142, 145),
}

# 25 档散点情绪 → 源图集帧号（键必须与 cat-sprite-manifest.ts 的 MOOD_TO_VARIANT 完全一致）。
# 2026-10-25 提帧：坐标换算到 146 帧 / 24fps 图集（逐帧按画面找最像的一帧，非按 15→24 时间缩放）。
MOOD_ATLAS = {
    "元气": 119, "原生": 0, "学习": 42, "害羞": 23, "工作中": 61,
    "已中断": 135, "已处理": 72, "平静": 138, "开心": 102, "思考中": 36,
    "思考强度": 45, "感动": 132, "担心": 53, "提醒": 68, "撒娇": 26,
    "治愈": 100, "温柔": 56, "激动": 122, "知性": 41, "离线": 109,
    "聆听中": 74, "自定义": 93, "连接中": 116, "陪伴中": 144, "难过": 83,
}
# 12 姿态 → 源图集帧号（与 Mood 档重复的帧直接复用，不为「独一无二」多塞帧）。
POSE_ATLAS = {
    "sit": 42, "lie": 83, "prone": 32, "peek": 33, "stretch": 93, "wash": 26,
    "yawn": 87, "tilt": 56, "sleep": 107, "puff": 86, "pout": 138, "happy": 102,
}
# 静帧表 = 25 个情绪帧 + 5 个姿态专属帧（其余姿态复用情绪帧），恰好 30 格。
STILL_ATLAS = list(dict.fromkeys(list(MOOD_ATLAS.values()) + list(POSE_ATLAS.values())))
assert len(STILL_ATLAS) == STILL_COLS * STILL_ROWS, f"静帧表应为 30 帧，实际 {len(STILL_ATLAS)}"


def load_frames() -> list[Image.Image]:
    atlas = Image.open(SRC).convert("RGBA")
    frames = []
    for i in range(COUNT):
        x = (i % COLS) * SRC_W
        y = (i // COLS) * SRC_H
        frames.append(atlas.crop((x, y, x + SRC_W, y + SRC_H)))
    return frames


def main_component(alpha: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int, int]]:
    """最大连通域（含头/尾/四肢）。闪烁星星、扬起的灰尘都是独立小域，会被排除。"""
    mask = (alpha > 24).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        raise RuntimeError("空帧")
    best = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])
    x, y, w, h, area = (int(v) for v in stats[best])
    return labels == best, (x, y, w, h, area)


def torso_x(frame: np.ndarray, main: np.ndarray) -> float:
    """躯干轴：主连通域在 y∈[90,170] 的 alpha 加权横坐标。"""
    band = np.where(main, frame[:, :, 3].astype(np.float64), 0.0)[90:171, :]
    total = band.sum()
    if total <= 0:
        raise RuntimeError("躯干权重为 0")
    xs = np.arange(band.shape[1], dtype=np.float64)
    return float((band.sum(axis=0) * xs).sum() / total)


def smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def key_master() -> tuple[Image.Image, dict]:
    """与 build-girl-sprite.cjs 同一套绿幕抠像口径：绿通道超出 max(r,b) 多少。"""
    rgba = np.asarray(Image.open(MASTER_SRC).convert("RGBA")).astype(np.float32)
    r, g, b = rgba[:, :, 0], rgba[:, :, 1], rgba[:, :, 2]
    key = g - np.maximum(r, b)
    a = 1.0 - smoothstep(10, 80, key)
    a[a <= 0.004] = 0.0
    g2 = np.where(a < 1, np.minimum(g, np.maximum(r, b) + 8), g)
    out = np.zeros_like(rgba, dtype=np.uint8)
    out[:, :, 0] = np.clip(r, 0, 255).astype(np.uint8)
    out[:, :, 1] = np.clip(g2, 0, 255).astype(np.uint8)
    out[:, :, 2] = np.clip(b, 0, 255).astype(np.uint8)
    out[:, :, 3] = np.round(a * 255).astype(np.uint8)
    image = Image.fromarray(out, "RGBA")

    alpha = out[:, :, 3]
    ys, xs = np.nonzero(alpha > 16)
    if len(xs) == 0:
        raise RuntimeError("母版抠像后空了")
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    rows = max(2, round((y1 - y0 + 1) * 0.06))
    band = alpha[y1 - rows + 1:y1 + 1, :]
    bxs = np.nonzero((band > 128).any(axis=0))[0]
    feet_x = float((bxs.min() + bxs.max() + 1) / 2) if len(bxs) else float((x0 + x1 + 1) / 2)
    meta = {
        "width": int(out.shape[1]),
        "height": int(out.shape[0]),
        "inkX": x0,
        "inkY": y0,
        "inkW": x1 - x0 + 1,
        "inkH": y1 - y0 + 1,
        "feetX": feet_x,
    }
    return image, meta


def main() -> int:
    frames = [np.asarray(f).copy() for f in load_frames()]
    mains = [main_component(f[:, :, 3])[0] for f in frames]
    torso = [torso_x(frames[i], mains[i]) for i in range(COUNT)]

    # 每段一个位移：躯干中位数落在格心（全尺寸 170）。
    shift: list[int] = []
    dx_by_clip: dict[str, int] = {}
    per_frame_dx: list[int] = [0] * COUNT
    for name, (lo, hi) in RANGES.items():
        med = float(np.median([torso[i] for i in range(lo, hi + 1)]))
        dx = int(round(STILL_ANCHOR_X - med))
        dx_by_clip[name] = dx
        for i in range(lo, hi + 1):
            per_frame_dx[i] = dx

    # —— 桌宠图集：全尺寸宽格 → 半尺寸 ——
    shifted: list[Image.Image] = []
    for i in range(COUNT):
        src = Image.fromarray(frames[i], "RGBA")
        canvas = Image.new("RGBA", (STILL_CELL_W, STILL_CELL_H), (0, 0, 0, 0))
        canvas.alpha_composite(src, (per_frame_dx[i], 0))
        shifted.append(canvas.resize((CELL_W, CELL_H), Image.LANCZOS))

    for i, im in enumerate(shifted):
        bbox = im.getchannel("A").getbbox()
        if bbox is None:
            raise RuntimeError(f"第 {i} 帧空了")
        if bbox[0] <= 0 or bbox[1] <= 0 or bbox[2] >= CELL_W or bbox[3] >= CELL_H:
            raise RuntimeError(f"第 {i} 帧贴到格子边：{bbox}")

    rows = math.ceil(COUNT / COLS)
    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * rows), (0, 0, 0, 0))
    for i, im in enumerate(shifted):
        atlas.alpha_composite(im, ((i % COLS) * CELL_W, (i // COLS) * CELL_H))

    os.makedirs(os.path.dirname(OUT_IMG), exist_ok=True)
    atlas.save(OUT_IMG, "WEBP", quality=90, method=6)
    size_kb = os.path.getsize(OUT_IMG) / 1024

    range_lines = "\n".join(
        f"  {name}: [{lo}, {hi}]," for name, (lo, hi) in RANGES.items()
    )
    meta = f"""// 由 scripts/assets/build-girl-anim.py 生成；改动作区间请改那边再重跑，不要手改本文件。
// 源帧来自 src/renderer/public/pet-intro/atlas.webp（同一段开场视频的 146 帧 / 24fps）。
export const GIRL_ANIM = {{
  src: "./pet/girl-anim.webp",
  cellW: {CELL_W},
  cellH: {CELL_H},
  cols: {COLS},
  rows: {rows},
  count: {COUNT},
  /** 躯干轴在格子里的位置（0..1）：每段动作都按它对齐过。 */
  anchorX: 0.5,
  anchorY: {ANCHOR_Y / CELL_H:.6f},
  /** 站立帧的墨高（图集像素）→ 与静态立绘同一条 91vb 的尺。 */
  inkRefPx: {INK_REF_PX},
  inkVb: {INK_VB},
}} as const;

/** 帧区间闭区间 [首, 末]；16 段恰好铺满 0..145。播放参数（fps/循环）在 girl-anim.ts。 */
export const GIRL_ANIM_RANGES = {{
{range_lines}
}} as const;

export type GirlAnimRawId = keyof typeof GIRL_ANIM_RANGES;
"""
    with open(OUT_META, "w", encoding="utf-8", newline="\n") as f:
        f.write(meta)

    # —— 客户端静帧：30 帧全尺寸，只留身体主连通域（去掉闪烁星星），同一套位移 ——
    os.makedirs(GEN, exist_ok=True)
    sheet = Image.new("RGBA", (STILL_CELL_W * STILL_COLS, STILL_CELL_H * STILL_ROWS), (0, 0, 0, 0))
    for cell, i in enumerate(STILL_ATLAS):
        frame = frames[i].copy()
        frame[:, :, 3] = np.where(mains[i], frame[:, :, 3], 0).astype(np.uint8)
        im = Image.fromarray(frame, "RGBA")
        canvas = Image.new("RGBA", (STILL_CELL_W, STILL_CELL_H), (0, 0, 0, 0))
        canvas.alpha_composite(im, (per_frame_dx[i], 0))
        sheet.alpha_composite(canvas, ((cell % STILL_COLS) * STILL_CELL_W, (cell // STILL_COLS) * STILL_CELL_H))
    sheet.save(STILLS_OUT, "PNG", optimize=True)

    master, master_meta = key_master()
    master.save(MASTER_OUT, "PNG", optimize=True)

    mood_lines = "\n".join(
        f'    "{name}": {STILL_ATLAS.index(atlas_no)},' for name, atlas_no in MOOD_ATLAS.items()
    )
    pose_lines = "\n".join(
        f'    "{name}": {STILL_ATLAS.index(atlas_no)},' for name, atlas_no in POSE_ATLAS.items()
    )
    stills_meta = f"""// 由 scripts/assets/build-girl-anim.py 生成；改帧号请改那边再重跑，不要手改本文件。
// 30 帧全尺寸静帧（6×5），每格 {STILL_CELL_W}×{STILL_CELL_H}；躯干轴 x={STILL_ANCHOR_X}、脚线 y={STILL_ANCHOR_Y}。
export const GIRL_STILLS = {{
  src: "girl-stills",
  cellW: {STILL_CELL_W},
  cellH: {STILL_CELL_H},
  cols: {STILL_COLS},
  rows: {STILL_ROWS},
  anchorX: 0.5,
  anchorY: {STILL_ANCHOR_Y / STILL_CELL_H:.6f},
  /** 站立帧墨高（全尺寸像素）：与桌宠图集同一条 91vb 的尺。 */
  inkRefPx: {INK_REF_PX * HALF},
  inkVb: {INK_VB},
}} as const;

/** 25 档散点情绪 → 静帧格号（键与 cat-sprite-manifest.ts 的 MOOD_TO_VARIANT 锁死）。 */
export const GIRL_STILL_FRAMES = {{
  mood: {{
{mood_lines}
  }},
  /** 12 姿态 → 静帧格号。 */
  pose: {{
{pose_lines}
  }},
}} as const;

export type GirlMoodName = keyof typeof GIRL_STILL_FRAMES.mood;
export type GirlPoseFrameName = keyof typeof GIRL_STILL_FRAMES.pose;
/** 客户端立绘的帧选择：按情绪 / 按姿态 / 参考图母版（仅欢迎页横幅）。 */
export type GirlFrame = {{ mood: GirlMoodName }} | {{ pose: GirlPoseFrameName }} | "master";

/** 参考图母版（唯一 1024×1536 高通量档）：墨框与脚心都在源图像素坐标里。 */
export const GIRL_MASTER = {{
  src: "girl-master",
  width: {master_meta["width"]},
  height: {master_meta["height"]},
  inkX: {master_meta["inkX"]},
  inkY: {master_meta["inkY"]},
  inkW: {master_meta["inkW"]},
  inkH: {master_meta["inkH"]},
  feetX: {master_meta["feetX"]:.2f},
  /** 画到 viewBox 里时，全身墨高按照 91vb 摆。 */
  inkVb: {INK_VB},
}} as const;
"""
    with open(STILLS_META_OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(stills_meta)

    if "--sheet" in sys.argv:
        os.makedirs(CACHE, exist_ok=True)
        cols = 6
        rows_sheet = math.ceil(len(RANGES) / cols)
        preview = Image.new("RGBA", (cols * CELL_W, rows_sheet * (CELL_H + 22)), (24, 24, 28, 255))
        draw = ImageDraw.Draw(preview)
        for k, (name, (lo, hi)) in enumerate(RANGES.items()):
            cx = (k % cols) * CELL_W
            cy = (k // cols) * (CELL_H + 22)
            mid = (lo + hi) // 2
            preview.alpha_composite(shifted[mid], (cx, cy + 22))
            draw.text((cx + 4, cy + 4), f"{name} [{lo}-{hi}] dx={dx_by_clip[name]:+.0f}", fill=(255, 255, 255, 255))
        preview.save(os.path.join(CACHE, "clips.png"))
        sheet.save(os.path.join(CACHE, "stills.png"))
        with open(os.path.join(CACHE, "clips.json"), "w", encoding="utf-8") as f:
            json.dump({"dx": dx_by_clip, "torso": torso, "ranges": RANGES, "stillAtlas": STILL_ATLAS}, f, ensure_ascii=False, indent=1)

    print(f"wrote {OUT_IMG} ({size_kb:.1f} KB, {atlas.width}x{atlas.height}) + {OUT_META}")
    print(f"wrote {STILLS_OUT} ({os.path.getsize(STILLS_OUT) / 1024:.1f} KB, {sheet.width}x{sheet.height}) + {STILLS_META_OUT}")
    print(f"wrote {MASTER_OUT} ({os.path.getsize(MASTER_OUT) / 1024:.1f} KB) ink={master_meta}")
    for name, (lo, hi) in RANGES.items():
        print(f"  {name:8s} {lo:2d}..{hi:2d}  dx={dx_by_clip[name]:+6.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
