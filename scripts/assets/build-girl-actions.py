#!/usr/bin/env python
"""野性动作帧图集：每个动作一套自己的 6 帧动画（不再是「借一张姿态 + 叠特效」）。

用法（需要 Pillow + numpy + opencv）：
    python scripts/assets/build-girl-actions.py

输入：scripts/assets/source/actions/<action>-sheet.png
      一张横向 6 格的 AI 出帧表，浅粉纯底，角色与 scripts/assets/source/poses* 同一只猫娘。
产物（提交进 git）：
    scripts/assets/generated/girl-actions.png   行=动作、列=帧的整表（供肉眼复查）
    src/renderer/public/pet/girl-actions.webp   桌宠运行时图集（带透明通道）
    src/renderer/pet/girl-actions-meta.ts       行号/帧数/fps/循环/每帧墨框与脸框

两条尺先定死：
  1) **地线共用**：一行的 6 帧按「墨底中位数」对齐到同一条基线，腾空帧（扑击第 3–5 帧）
     自然高过基线——逐帧归一化会把扑击压回地面，那正是「硬套」的味道。
  2) **眼圈距定尺**：眼睛不随姿态变形。每帧在墨框上半身找「粉红虹膜色块对」，取间距中位数，
     与姿态图集 `stand` 格同一检测器量出的 41.24px 相比，按 `229 × E/E₀` 换算 inkRefPx，
     再乘本行的打包缩放 s（图集坐标才和 renderer 的 inkRefPx 同一坐标系）。
     脸高/头宽这类量法会被蹲伏收头、举手挡脸带偏，虹膜对不会。
"""
import math
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_DIR = os.path.join(ROOT, "scripts", "assets", "source", "actions")
GEN = os.path.join(ROOT, "scripts", "assets", "generated")
OUT_ATLAS = os.path.join(GEN, "girl-actions.png")
OUT_WEBP = os.path.join(ROOT, "src", "renderer", "public", "pet", "girl-actions.webp")
OUT_META = os.path.join(ROOT, "src", "renderer", "pet", "girl-actions-meta.ts")

CELL_W, CELL_H = 300, 400
COLS = 6
INK_VB = 91
# 姿态图集 stand 格的尺：站立墨高 229px ↔ 91vb；同一套虹膜检测器量出的眼圈距 41.24px。
POSE_INK_PX = 229.0
EYE_SPACING_POSE = 41.24
# stand 格实测：脸框 100×78、脸心比眼圈中点高 4.3px —— 按 E 归一后给动作帧复用。
FACE_W_PER_EYE = 100.0 / EYE_SPACING_POSE
FACE_H_PER_EYE = 78.0 / EYE_SPACING_POSE
FACE_CY_DROP = 4.3 / EYE_SPACING_POSE

ACTIONS = [
    ("zoom", "zoom-sheet.png", 12, True),
    ("stalk", "stalk-sheet.png", 6, True),
    ("hunt", "hunt-sheet.png", 7, False),
]

# 每套动作的眼圈距（原始格像素）。自动检测只用来定「帧内脸心」：肉垫/耳朵/蝴蝶结
# 也是粉的，全自动会对错对子；这里取人工复核过的可信帧中位数（.tmp/art-view/eye-contact.png
# 那轮逐帧看图确认），并把每帧的检测值按 ±25% 去伪。
EYE_SPACING_ACTION = {
    "zoom": 56.2,   # 56.3 / 56.0 / 57.8 / 52.1（f4 20.4 误检、f3 64.7 偏远，弃）
    "stalk": 61.8,  # 61.8 / 63.3（f1 81.6、f5 79.1 是眼+肉垫，f2 26.3 是碎块，弃）
    "hunt": 59.0,   # 59.0 / 60.0 / 58.8（f0 21.3、f1 20.7 眉间碎块，f5 120.6 眼+耳，弃）
}


def key_cell(rgb: np.ndarray) -> np.ndarray:
    """与 build-girl-poses.py 同一套：色差种子 → 最大连通域填洞 → 外缘软 alpha。"""
    h, w, _ = rgb.shape
    edge = np.concatenate([
        rgb[:6, :, :].reshape(-1, 3), rgb[-6:, :, :].reshape(-1, 3),
        rgb[:, :6, :].reshape(-1, 3), rgb[:, -6:, :].reshape(-1, 3),
    ])
    bg = np.median(edge, axis=0)
    dist = np.linalg.norm(rgb - bg, axis=2)
    seed = (dist > 34.0).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(seed, connectivity=8)
    if n <= 1:
        raise RuntimeError("没找到角色主体")
    main = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])
    mask = (lab == main).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n2, lab2, stats2, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    main2 = max(range(1, n2), key=lambda i: stats2[i, cv2.CC_STAT_AREA])
    solid = (lab2 == main2).astype(np.uint8)
    ff = solid.copy()
    m2 = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff, m2, (0, 0), 1)
    solid = solid | (1 - ff)
    ring = cv2.dilate(solid, np.ones((5, 5), np.uint8)) - solid
    soft = np.clip((dist - 10.0) / 26.0, 0.0, 1.0)
    soft = soft * soft * (3.0 - 2.0 * soft)
    alpha = np.where(solid > 0, 1.0, np.where(ring > 0, soft, 0.0)).astype(np.float32)
    # 去污色：C = a*F + (1-a)*B
    fg = np.zeros_like(rgb)
    a = np.maximum(alpha, 1e-3)[:, :, None]
    fg = np.clip((rgb - (1.0 - a) * bg) / a, 0, 255)
    return np.dstack([fg, alpha * 255.0]).astype(np.uint8)


def row_background(sheet: np.ndarray) -> np.ndarray:
    """底色是竖向渐变：每行的底色取该行左右两端的中间值，别拿全图一个色去比。"""
    edge = np.concatenate([sheet[:, :40, :], sheet[:, -40:, :]], axis=1).astype(np.float32)
    return np.median(edge, axis=1)


def kill_ground_lines(sheet: np.ndarray) -> np.ndarray:
    """AI 出帧图偶尔带一条横贯全图的「地平线」。判据必须窄：整行几乎全是前景，
    而上下一行几乎没有——否则背景渐变会被误判，把小人的头顶也整行削掉。"""
    out = sheet.copy()
    bg = row_background(out)[:, None, :]
    dist = np.linalg.norm(out.astype(np.float32) - bg, axis=2)
    frac = (dist > 24.0).mean(axis=1)
    rows = []
    for y in range(1, len(frac) - 1):
        if frac[y] > 0.5 and frac[y - 1] < 0.15 and frac[y + 1] < 0.15:
            rows.append(y)
    for y in rows:
        out[y, :, :] = bg[y].astype(np.uint8)
    if rows:
        print(f"  抹掉横贯伪影 {len(rows)} 行: {rows[0]}..{rows[-1]}")
    return out


def frame_boxes(sheet: np.ndarray, want: int, pad: int = 6) -> list[tuple[int, int, int, int]]:
    """等分槽 + 列覆盖谷切帧。AI 出帧表偶尔有一条细线/影子把相邻两帧连成同一个连通域；
    按连通域取框会把「一行里最宽的那块」撑成两帧宽，整行被缩掉一半。
    槽宽已知（6 等分），每道槽界附近找覆盖最低的一列当切线，再取每段的墨外框。"""
    bg = row_background(sheet)[:, None, :]
    dist = np.linalg.norm(sheet.astype(np.float32) - bg, axis=2)
    fg = dist > 34.0
    cover = fg.sum(axis=0)
    h, w = fg.shape
    slot = w / want
    bounds = [0]
    for k in range(1, want):
        lo = max(1, int(slot * k - slot * 0.3))
        hi = min(w - 2, int(slot * k + slot * 0.3))
        cuts = lo + int(np.argmin(cover[lo:hi]))
        if cuts <= bounds[-1] + 8:
            raise RuntimeError(f"第 {k} 帧的切线退化（{cuts}）")
        bounds.append(cuts)
    bounds.append(w)
    out = []
    for k in range(want):
        ys, xs = np.nonzero(fg[:, bounds[k]:bounds[k + 1]])
        if len(xs) < 200:
            raise RuntimeError(f"第 {k} 帧是空的")
        x0 = int(xs.min()) + bounds[k]
        x1 = int(xs.max()) + 1 + bounds[k]
        out.append((max(0, x0 - pad), max(0, int(ys.min()) - pad),
                    min(w, x1 + pad), min(h, int(ys.max()) + 1 + pad)))
    return out


def kill_alpha_lines(rgba: np.ndarray) -> np.ndarray:
    """抠像后的地平线会留下一行半透明墨（软 alpha 光晕）。整行抹成透明，
    否则它会成为墨框的底边，地线对齐就全歪。"""
    out = rgba.copy()
    a = out[:, :, 3]
    cover = (a > 8).mean(axis=1)
    rows = [y for y in range(1, len(cover) - 1)
            if cover[y] > 0.6 and cover[y - 1] < 0.25 and cover[y + 1] < 0.25]
    for y in rows:
        out[y, :, :] = 0
    return out


def face_region(rgba: np.ndarray):
    """「白脸团」外框 (x, y, w, h)：上半身里最大的一块浅色连通域。
    眼睛、白脸、胸脯同色，但上半身只留头和脸；趴姿的前爪白袜在更低处，被 0.6 行高切掉。"""
    alpha = rgba[:, :, 3]
    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        return None
    top = int(ys.min())
    ink_h = int(ys.max()) - top + 1
    hsv = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2HSV)
    skin = ((hsv[:, :, 2] > 185) & (hsv[:, :, 1] < 55) & (alpha > 8)).astype(np.uint8)
    skin[top + int(0.6 * ink_h):, :] = 0
    skin = cv2.morphologyEx(skin, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    ns, _, sst, _ = cv2.connectedComponentsWithStats(skin, connectivity=8)
    if ns <= 1:
        return None
    i = 1 + int(np.argmax(sst[1:, cv2.CC_STAT_AREA]))
    x, y, w, h = [int(v) for v in sst[i, :4]]
    if w < 8 or h < 8:
        return None
    return x, y, w, h


def eye_pair(rgba: np.ndarray, region=None):
    """在「白脸团」里找「粉红虹膜色块对」：面积相近、接近同一水平线。
    不能全图找粉：猫耳内侧也是粉的，比虹膜大一圈，会把尺量成两倍。
    返回 (间距, 左心, 右心)，坐标是传入图自己的像素。找不到返回 None。"""
    alpha = rgba[:, :, 3]
    if region is None:
        region = face_region(rgba)
    if region is None:
        return None
    sx, sy, sw, shh = region
    fx0 = max(0, int(sx - 0.15 * sw))
    fy0 = max(0, int(sy - 0.15 * shh))
    fx1 = min(rgba.shape[1], int(sx + 1.15 * sw))
    fy1 = min(rgba.shape[0], int(sy + 1.15 * shh))
    r = rgba[:, :, 0].astype(np.int16)
    g = rgba[:, :, 1].astype(np.int16)
    b = rgba[:, :, 2].astype(np.int16)
    m = ((r - g > 26) & (r > 95) & (b > 55) & (r - b > 20) & (alpha > 8)).astype(np.uint8)
    m[:fy0, :] = 0
    m[fy1:, :] = 0
    m[:, :fx0] = 0
    m[:, fx1:] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, _, st, cen = cv2.connectedComponentsWithStats(m, connectivity=8)
    cand = []
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < 25 or max(st[i, 2], st[i, 3]) > 45:
            continue
        cand.append((int(st[i, cv2.CC_STAT_AREA]), float(cen[i][0]), float(cen[i][1])))
    best = None
    for i in range(len(cand)):
        for j in range(i + 1, len(cand)):
            a1, x1, y1 = cand[i]
            a2, x2, y2 = cand[j]
            if not (0.5 <= a1 / a2 <= 2.2):
                continue
            d = math.hypot(x2 - x1, y2 - y1)
            if d < 12 or abs(y2 - y1) > 0.45 * d:
                continue
            score = (a1 + a2) - 6 * abs(y2 - y1)
            if best is None or score > best[0]:
                left, right = ((x1, y1), (x2, y2)) if x1 < x2 else ((x2, y2), (x1, y1))
                best = (score, d, left, right)
    if best is None:
        return None
    d, left, right = best[1], best[2], best[3]
    return d, left, right


def face_from_eyes(d: float, left, right):
    """脸框（中心式 [cx, cy, w, h]）：眼圈中点为心，脸心再抬高 0.10E，尺寸按 E 缩放。"""
    cx = (left[0] + right[0]) / 2.0
    cy = (left[1] + right[1]) / 2.0 - FACE_CY_DROP * d
    return cx, cy, FACE_W_PER_EYE * d, FACE_H_PER_EYE * d


def ink_of(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(alpha > 8)
    if len(xs) == 0:
        raise RuntimeError("空格子")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def main() -> int:
    rows = []
    for action, name, fps, loop in ACTIONS:
        path = os.path.join(SRC_DIR, name)
        if not os.path.exists(path):
            raise RuntimeError(f"缺动作帧表：{path}")
        rgb = np.asarray(Image.open(path).convert("RGB"))
        rgb = kill_ground_lines(rgb)
        frames = []
        for x0, y0, x1, y1 in frame_boxes(rgb, COLS):
            crop = rgb[y0:y1, x0:x1, :]
            rgba = kill_alpha_lines(key_cell(crop))
            ink = ink_of(rgba[:, :, 3])
            region = face_region(rgba)
            frames.append((rgba, ink, region, eye_pair(rgba, region)))
        print(f"  {action} 眼圈距: " + ", ".join(
            "-" if f[3] is None else f"{f[3][0]:.1f}" for f in frames))
        rows.append((action, fps, loop, frames))

    # 每行一套尺：眼圈距 → inkRefPx（原始像素，打包后再乘 s）。
    eye_med = {}
    for action, _, _, frames in rows:
        e_med = EYE_SPACING_ACTION[action]
        vals = [f[3][0] for f in frames if f[3] is not None]
        ok = [v for v in vals if abs(v - e_med) <= 0.25 * e_med]
        if len(ok) < 2:
            raise RuntimeError(f"{action} 只有 {len(ok)} 帧的眼睛和定尺吻合，尺子不可信")
        eye_med[action] = e_med
        print(f"{action:5s} 眼圈距 {e_med:.1f}px（{len(ok)}/{len(vals)} 帧检测吻合）"
              f" → inkRefPx {POSE_INK_PX * e_med / EYE_SPACING_POSE:.1f}（打包前）")

    atlas = Image.new("RGBA", (CELL_W * COLS, CELL_H * len(rows)), (0, 0, 0, 0))
    meta_rows = []
    ink_refs = {}
    for r, (action, fps, loop, frames) in enumerate(rows):
        e_med = eye_med[action]
        # 统一缩放：整行按「共用地线后的总跨度」装进格子——只用单帧最高墨会漏算地线偏移，
        # 脚比中位线低的那帧就会被推到格子外面去。
        min_top = min(f[1][1] for f in frames)
        max_bottom = max(f[1][3] for f in frames)
        min_x = min(f[1][0] for f in frames)
        max_x = max(f[1][2] for f in frames)
        s = min((CELL_H * 0.90) / (max_bottom - min_top), (CELL_W * 0.94) / (max_x - min_x))
        ink_ref_cell = POSE_INK_PX * e_med / EYE_SPACING_POSE * s
        ink_refs[action] = ink_ref_cell
        print(f"{action:5s} 打包 s={s:.3f} → inkRefPx {ink_ref_cell:.1f}（图集格像素）")
        base_y = int(CELL_H * 0.93)
        bottoms = [f[1][3] for f in frames]
        ground = float(np.median(bottoms))
        # 帧内脸心：**白脸团外框的心**。眼圈对只在定尺时用——它是对的尺子，却不是可靠的位置
        # 锚（眯眼/被爪子挡住/抬手越过脸时检测会落在肉垫或碎块上）。白团是同一块皮肤色连通域，
        # 眼睛、鼻子、腮都在里面，它的外框心在 6 帧之间只跟着头走，不会飞到身子外。
        # 认不出白团（极少数遮挡帧）才退到墨顶往下 25% 的横心。
        centers = []
        for rgba, ink, region, _e in frames:
            if region is not None:
                rx, ry, rw, rh = region
                centers.append((rx + rw / 2.0, ry + rh / 2.0))
            else:
                centers.append(((ink[0] + ink[2]) / 2.0, ink[1] + 0.25 * (ink[3] - ink[1])))
        # 整行共用一条躯干轴（用脸心当轴，别用墨心——尾巴一摆墨心就甩）。
        row_cx = float(np.median([(f[1][0] + f[1][2]) / 2.0 for f in frames]))
        row_dx = float(np.median([c[0] - (ink[0] + ink[2]) / 2.0 for c, (_, ink, _, _) in zip(centers, frames)]))
        # 每行各自打包：这一行的墨横跨整格居中，躯干轴（脸心列）因此落在格子里某个比例上。
        # 这个比例就是本行的 anchorX——三行动作各宽各的，硬用一个 0.5 会让猫在换动作时横跳。
        left = int(round((CELL_W - (max_x - min_x) * s) / 2))
        anchor_x = (left + (row_cx + row_dx) * s) / CELL_W
        inks = []
        faces = []
        for c, (rgba, ink, _region, _e) in enumerate(frames):
            im = Image.fromarray(rgba, "RGBA").resize(
                (max(1, int(round(rgba.shape[1] * s))), max(1, int(round(rgba.shape[0] * s)))),
                Image.LANCZOS,
            )
            ix0, iy0, ix1, iy1 = [v * s for v in ink]
            # 脚可以比中位地线高（腾空），但不许更低：踩得更低只会把帧顶出格子。
            dy = base_y + min(0.0, ink[3] - ground) * s
            top = int(round(dy - iy1))
            atlas.alpha_composite(im, (c * CELL_W + left, r * CELL_H + top))
            n_ink = [int(round(ix0 + left)), int(round(iy0 + top)), int(round(ix1 + left)), int(round(iy1 + top))]
            if n_ink[0] < 0 or n_ink[1] < 0 or n_ink[2] > CELL_W or n_ink[3] > CELL_H:
                raise RuntimeError(f"{action} f{c} 墨框出格：{n_ink}（格子 {CELL_W}×{CELL_H}）")
            inks.append(n_ink)
            mid = centers[c]
            mx, my = mid
            # 尺寸用整行的 E 中位数：逐帧 E 抖 10% 会让叠在脸上的表情层跟着忽大忽小。
            fx, fy, fw, fh = face_from_eyes(e_med, (mx - e_med / 2.0, my), (mx + e_med / 2.0, my))
            faces.append([
                int(round(fx * s + left)), int(round(fy * s + top)),
                int(round(fw * s)), int(round(fh * s)),
            ])
        meta_rows.append((action, fps, loop, inks, faces, anchor_x))
        for c, (ink, face) in enumerate(zip(inks, faces)):
            print(f"{action} f{c}: cell ink={ink} face={face}")

    os.makedirs(GEN, exist_ok=True)
    atlas.save(OUT_ATLAS, "PNG", optimize=True)
    os.makedirs(os.path.dirname(OUT_WEBP), exist_ok=True)
    atlas.save(OUT_WEBP, "WEBP", lossless=True, quality=100, method=6)

    def f4(v: float) -> str:
        return f"{v:.6f}"

    row_lines = []
    for i, (action, fps, loop, inks, faces, anchor_x) in enumerate(meta_rows):
        row_lines.append(
            f'  {action}: {{ row: {i}, frames: {len(inks)}, fps: {fps}, loop: {str(loop).lower()}, '
            f'inkRefPx: {ink_refs[action]:.1f}, anchorX: {anchor_x:.6f} }},'
        )
    ink_lines = []
    face_lines = []
    for action, _, _, inks, faces, _ax in meta_rows:
        ink_lines.append(f"  {action}: [\n" + "\n".join(f"    [{a}, {b}, {c}, {d}]," for a, b, c, d in inks) + "\n  ],")
        face_lines.append(f"  {action}: [\n" + "\n".join(f"    [{a}, {b}, {c}, {d}]," for a, b, c, d in faces) + "\n  ],")

    meta = f"""// 由 scripts/assets/build-girl-actions.py 生成；改动作帧请改那边再重跑，不要手改本文件。
// 源图：scripts/assets/source/actions/*-sheet.png（每个动作一张横向 6 帧 AI 出帧表）。
// 每个动作一条专属动画：行=动作、列=帧；同一行共用一条地线，腾空帧自然高于基线。
export const GIRL_ACTIONS = {{
  src: "./pet/girl-actions.webp",
  cellW: {CELL_W},
  cellH: {CELL_H},
  cols: {COLS},
  rows: {len(meta_rows)},
  count: {COLS * len(meta_rows)},
  /** 每行的横向打包各宽各的，躯干轴（anchorX）因此逐行不同，放在 GIRL_ACTION_ROWS 里。 */
  anchorY: {CELL_H * 0.93 / CELL_H:.6f},
  inkVb: {INK_VB},
}} as const;

/** 动作 → 行号 / 帧数 / 播放参数 / 本行的尺与躯干轴（脸高对齐姿态图集）。 */
export const GIRL_ACTION_ROWS = {{
{chr(10).join(row_lines)}
}} as const;

export type GirlActionId = keyof typeof GIRL_ACTION_ROWS;

/** 每帧墨框（格子像素 [x0, y0, x1, y1]）。 */
export const GIRL_ACTION_INK: Record<GirlActionId, readonly (readonly [number, number, number, number])[]> = {{
{chr(10).join(ink_lines)}
}};

/** 每帧脸框（格子像素 [cx, cy, w, h]，只含白脸与眼、不含耳朵）。 */
export const GIRL_ACTION_FACE: Record<GirlActionId, readonly (readonly [number, number, number, number])[]> = {{
{chr(10).join(face_lines)}
}};
"""
    with open(OUT_META, "w", encoding="utf-8", newline="\n") as f:
        f.write(meta)

    print("atlas", OUT_ATLAS, os.path.getsize(OUT_ATLAS) // 1024, "KB")
    print("webp ", OUT_WEBP, os.path.getsize(OUT_WEBP) // 1024, "KB")
    print("meta ", OUT_META)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
