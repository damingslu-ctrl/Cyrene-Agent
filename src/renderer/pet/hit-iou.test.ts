import { describe, expect, it } from "vitest";
import { buildPetOps } from "./form";
import { renderOps } from "../../shared/sprite-raster";
import { computeCatRect } from "../../shared/pet-geometry";
import { formGeometry, profileFor, type PetForm, type SizeTier } from "../../shared/pet-profile";
import { girlSpriteRect } from "./girl-sprite";

/**
 * 尺 #71 的可离线层：真渲染路径（buildPetOps → renderOps / 位图立绘的墨框）
 * 与 computeCatRect 的命中框做 IoU。
 *
 * 猫走 ops → RGBA；猫娘现在是位图（girl.webp），Node 里没有解码器，
 * 所以她的墨框直接取生成元数据算出的 `girlSpriteRect`——发布前
 * `build-girl-sprite.cjs --verify` 已经拿真像素看过同一组 aspect/anchorX。
 * 与真窗 CDP 版（scripts/verify/pet-hit-cdp.mjs）的关系：那条量真窗口与 dpr。
 */
const SIZE = 400;
const IOU_MIN = 0.55;

function girlInkBox(center: { x: number; y: number }, s: number) {
  const r = girlSpriteRect(center, s);
  return { x: Math.floor(r.x), y: Math.floor(r.y), w: Math.ceil(r.w), h: Math.ceil(r.h), count: 1 };
}

function inside(outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }, slack = 1) {
  return inner.x >= outer.x - slack
    && inner.y >= outer.y - slack
    && inner.x + inner.w <= outer.x + outer.w + slack
    && inner.y + inner.h <= outer.y + outer.h + slack;
}

function inkBBox(rgba: Uint8Array, width: number, height: number) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 10) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return count > 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, count } : null;
}

function iou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

describe("尺 #71：命中框与墨迹的 IoU（离线层）", () => {
  const combos: Array<[PetForm, SizeTier]> = [
    ["cat", "small"], ["cat", "standard"], ["cat", "large"],
    ["girl", "small"], ["girl", "standard"], ["girl", "large"],
  ];

  it("六组 form×tier 的 IoU 全部 ≥ 0.55，且头部落在命中框内", () => {
    const fails: string[] = [];
    for (const [form, tier] of combos) {
      const prof = profileFor(form, tier);
      const g = formGeometry(form);
      const u = prof.catScale(0).u;
      const s = prof.catScale(0).s;
      const center = { x: SIZE / 2 + g.centerOffset.dx * s, y: SIZE / 2 + g.centerOffset.dy * s };
      let raster: { rgba: Uint8Array } | null = null;
      let bbox: ReturnType<typeof inkBBox> = null;
      if (form === "girl") {
        bbox = girlInkBox(center, s);
      } else {
        raster = renderOps(buildPetOps({
          center, u, form,
          mood: "idle", t: 0, energy: 1, mouse: null, blink: 0, jumpY: 0, pet: 0, quiet: false,
          pose: { paw: 0, yawn: 0, stretch: 0, tilt: 0, engagement: 0 },
        }), SIZE, SIZE);
        bbox = inkBBox(raster.rgba, SIZE, SIZE);
      }
      if (!bbox) { fails.push(`${form}/${tier}: 画布上没有墨`); continue; }

      // 命中框：与 renderer.getHitRect 同一算式（pinInWin = center − centerOffset·s 的反推）
      const pinInWin = { x: center.x - g.centerOffset.dx * s, y: center.y - g.centerOffset.dy * s };
      const rect = computeCatRect({ pinInWin, e: 0, profile: prof });
      const score = iou({ x: rect.x, y: rect.y, w: rect.width, h: rect.height }, bbox);
      if (!(score >= IOU_MIN)) fails.push(`${form}/${tier}: IoU ${score.toFixed(3)} < ${IOU_MIN}（框 ${rect.width.toFixed(0)}×${rect.height.toFixed(0)}，墨 ${bbox.w}×${bbox.h}）`);

      if (form === "girl") {
        // 立绘墨框整个落在命中框里；头部那 35% 再单独包一次——点头顶必须算点到她。
        const hit = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        if (!inside(hit, bbox)) fails.push(`${form}/${tier}: 立绘墨框超到命中框外（墨 ${bbox.x},${bbox.y} ${bbox.w}×${bbox.h} / 框 ${rect.x},${rect.y} ${rect.width}×${rect.height}）`);
        const top = { x: bbox.x, y: bbox.y, w: bbox.w, h: Math.round(bbox.h * 0.35) };
        if (!inside(hit, top)) fails.push(`${form}/${tier}: 头部 35% 不在命中框里`);
      } else {
        // 头部中线：画布中线那一列，在墨迹上 35% 内必须有墨
        const midX = Math.round(center.x);
        const headBottom = bbox.y + bbox.h * 0.35;
        let head = false;
        for (let y = bbox.y; y <= headBottom && !head; y++) {
          for (const x of [midX - 1, midX, midX + 1]) {
            if (raster!.rgba[(y * SIZE + x) * 4 + 3] >= 10) { head = true; break; }
          }
        }
        if (!head) fails.push(`${form}/${tier}: 头部中线一列没有可点像素`);
      }
    }
    expect(fails, fails.join("\n")).toEqual([]);
  });

  it("正对照：把 girl 的 hitAspect.height 写成猫的 1.85 时 IoU 必须掉下去", () => {
    const prof = profileFor("girl", "large");
    const g = formGeometry("girl");
    const s = prof.catScale(0).s;
    const center = { x: SIZE / 2, y: SIZE / 2 + g.centerOffset.dy * s };
    const bbox = girlInkBox(center, s)!;
    const pinInWin = { x: center.x, y: center.y - g.centerOffset.dy * s };
    const good = computeCatRect({ pinInWin, e: 0, profile: prof });
    const mutated = { ...good, y: good.y + (good.height - prof.catScale(0).u * 2.0 * 1.55) / 2, height: prof.catScale(0).u * 2.0 * 1.85 };
    const goodIou = iou({ x: good.x, y: good.y, w: good.width, h: good.height }, bbox);
    const badIou = iou({ x: mutated.x, y: mutated.y, w: mutated.width, h: mutated.height }, bbox);
    expect(goodIou).toBeGreaterThan(badIou);
    expect(badIou).toBeLessThan(goodIou - 0.05);
  });
});
