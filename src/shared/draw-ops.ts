export type Point2 = [number, number];

/**
 * 层序标签。层序本身由 `art.ts` 的 ORDER 持有，这里的值只作判据标签
 * （单测按它查「谁在谁之前」），paintOps 不消费。
 */
export type PetLayer =
  | "ground_shadow" | "tail" | "tail_tip" | "ears"
  | "body" | "body_light" | "body_stroke"
  | "bib" | "bib_ao" | "paws" | "paws_up"
  | "eyes" | "nose" | "mouth" | "blush"
  | "zzz" | "quiet_mark" | "heart" | "stars" | "badge"
  | "capsule" | "unread" | "bubble"
  // v1.5.0：猫娘专用层（只在 form === "girl" 出现；四足永不产出它们，art-golden 的
  // 逐字节相等是这条的间接证明）。顺序与 GIRL_LAYERS 一致。
  | "legs" | "dress" | "arms" | "hands" | "collar"
  | "hair_back" | "hair_front" | "ahoge" | "brows" | "tear";

export type DrawOp =
  | { kind: "fillPath"; fill: string; points: Point2[]; layer?: PetLayer }
  | { kind: "gradPath"; from: Point2; to: Point2; stops: Array<{ at: number; color: string }>; points: Point2[]; layer?: PetLayer }
  | {
      kind: "strokePath";
      stroke: string;
      width: number;
      points: Point2[];
      /** native `stroke_poly` 是**不闭合**的折线；闭合会让胡须/闭眼/嘴角连出一条首尾直线（native 任务 #56）。 */
      close?: boolean;
      layer?: PetLayer;
    }
  | { kind: "fillEllipse"; fill: string; cx: number; cy: number; rx: number; ry: number; rot?: number; layer?: PetLayer }
  | { kind: "strokeEllipse"; stroke: string; width: number; cx: number; cy: number; rx: number; ry: number; layer?: PetLayer }
  | { kind: "fillRoundRect"; fill: string; x: number; y: number; w: number; h: number; r: number; layer?: PetLayer }
  | { kind: "strokeRoundRect"; stroke: string; width: number; x: number; y: number; w: number; h: number; r: number; layer?: PetLayer }
  | { kind: "crescent"; fill: string; cx: number; cy: number; r: number; dx: number; dy: number; cut: number; layer?: PetLayer }
  | {
      kind: "image";
      /** 构建期图像注册表的键（`girl-stills-meta.ts` 的 `src`）。运行时画布不认它。 */
      src: string;
      sx: number; sy: number; sw: number; sh: number;
      x: number; y: number; w: number; h: number;
      layer?: PetLayer;
    }
  | { kind: "text"; text: string; x: number; y: number; size: number; color: string; align?: "left" | "right" | "center"; maxWidth?: number; layer?: PetLayer };
