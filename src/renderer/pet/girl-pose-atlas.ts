import {
  GIRL_PET_POSES,
  GIRL_PET_POSE_CELLS,
  GIRL_PET_POSE_FACE,
  GIRL_PET_POSE_INK,
  type GirlPoseId,
} from "./girl-pet-poses-meta";
import {
  GIRL_PET_POSES2,
  GIRL_PET_POSE2_CELLS,
  GIRL_PET_POSE2_FACE,
  GIRL_PET_POSE2_INK,
  type GirlPose2Id,
} from "./girl-pet-poses2-meta";

/**
 * v1.15.0：姿态不止一张图集。图集 I 是站/坐/蜷这一族（每格各自归一到 229px 墨高），
 * 图集 II 是趴/欠身/洗漱这一族（**全表共用一个 scale**，由站姿 `wave` 定尺）。
 * 两套数字散在调用点迟早会把趴着当站着画，这里统一寻址一次。
 */
export type GirlAtlasId = "poses" | "poses2";
export type GirlPoseName = GirlPoseId | GirlPose2Id;

/** 图集级几何；两套图集的这套字段必须一致，`girlPoseBodyFor` 的 `k` 才能与姿态无关。 */
export interface GirlAtlasMeta {
  readonly src: string;
  readonly cellW: number;
  readonly cellH: number;
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly inkRefPx: number;
  readonly inkVb: number;
}

/** 单张姿态：图集几何 + 该格号 + 该格的墨框/脸框（都是图集像素，不是屏幕坐标）。 */
export interface GirlPoseGeom extends GirlAtlasMeta {
  readonly atlas: GirlAtlasId;
  readonly pose: GirlPoseName;
  readonly cell: number;
  readonly ink: readonly [number, number, number, number];
  readonly face: readonly [number, number, number, number];
}

export const GIRL_POSE_ATLASES: Record<GirlAtlasId, GirlAtlasMeta> = {
  poses: GIRL_PET_POSES,
  poses2: GIRL_PET_POSES2,
};

/**
 * 两套图集共用的那把尺：`girlPoseBodyFor` 的 `k`（图集像素 → 绘制空间）只算一次、
 * 与姿态无关——这正是图集 II 能把「趴着」画成又矮又宽的前提。
 * 任何一套图偷偷改了尺，都等于偷偷改了猫的大小，所以在这里当场炸出来。
 */
function checkSharedRuler(): { inkRefPx: number; inkVb: number } {
  const a = GIRL_POSE_ATLASES.poses;
  const b = GIRL_POSE_ATLASES.poses2;
  if (a.inkRefPx !== b.inkRefPx || a.inkVb !== b.inkVb) {
    throw new Error(
      `姿态图集的尺不一致：poses ${a.inkVb}vb/${a.inkRefPx}px vs poses2 ${b.inkVb}vb/${b.inkRefPx}px`,
    );
  }
  return { inkRefPx: a.inkRefPx, inkVb: a.inkVb };
}

export const GIRL_POSE_RULER = checkSharedRuler();

const SOURCES: readonly {
  atlas: GirlAtlasId;
  cells: Record<string, number>;
  ink: Record<string, readonly [number, number, number, number]>;
  face: Record<string, readonly [number, number, number, number]>;
}[] = [
  { atlas: "poses", cells: GIRL_PET_POSE_CELLS, ink: GIRL_PET_POSE_INK, face: GIRL_PET_POSE_FACE },
  { atlas: "poses2", cells: GIRL_PET_POSE2_CELLS, ink: GIRL_PET_POSE2_INK, face: GIRL_PET_POSE2_FACE },
];

const GEOM = {} as Record<GirlPoseName, GirlPoseGeom>;
const ORDERED: GirlPoseName[] = [];
const SEEN_CELLS = new Set<string>();

for (const source of SOURCES) {
  const names = (Object.keys(source.cells) as GirlPoseName[]).sort(
    (a, b) => source.cells[a] - source.cells[b],
  );
  for (const name of names) {
    const key = `${source.atlas}:${source.cells[name]}`;
    if (SEEN_CELLS.has(key)) {
      throw new Error(`姿态图集格号撞车：${key}（${name}）`);
    }
    SEEN_CELLS.add(key);
    const rect = source.ink[name];
    if (!rect) throw new Error(`姿态 ${name} 在册但没有墨框`);
    GEOM[name] = { ...GIRL_POSE_ATLASES[source.atlas], atlas: source.atlas, pose: name, cell: source.cells[name], ink: rect, face: source.face[name] };
    ORDERED.push(name);
  }
}

/** 16 张姿态，按图集顺序 + 格号排。 */
export const GIRL_POSE_NAMES: readonly GirlPoseName[] = ORDERED;

export function girlPoseGeom(pose: GirlPoseName): GirlPoseGeom {
  return GEOM[pose];
}

export function girlPoseAtlasId(pose: GirlPoseName): GirlAtlasId {
  return GEOM[pose].atlas;
}

export function girlPoseCell(pose: GirlPoseName): number {
  return GEOM[pose].cell;
}

/** 该格墨框（图集像素 [x0, y0, x1, y1]）。屏幕空间的同名量在 `girl-sprite`。 */
export function girlPoseInkRect(pose: GirlPoseName): readonly [number, number, number, number] {
  return GEOM[pose].ink;
}

/** 该格脸框（图集像素 [cx, cy, w, h]，不含耳朵）。 */
export function girlPoseFaceRect(pose: GirlPoseName): readonly [number, number, number, number] {
  return GEOM[pose].face;
}
