import { BUB_W, OPEN_H, OPEN_W, PET_H, PET_W, PIN, scaleFor } from "./pet-geometry";

/**
 * 形态（猫 / 猫娘）与身形档位（小 / 标准 / 大）的**纯几何参数**。
 * spec §8。这里不做美术、不读时钟、不碰 IPC——只有能被单元测试逐字节钉住的数。
 *
 * 为什么 `standard` 必须等于今天的常量：R-D2「四足猫逐像素不变」不是一句口头承诺，
 * 而是「默认档的所有系数都取 1，于是新代码算出的框与老代码写死的框是同一个数」。
 * 所以本文件里凡与 pet-geometry.ts:9-16 重叠的量，一律**导入常量再乘 k**，不重新字面化。
 *
 * 三条约定：
 * 1. `k` 只乘长度（窗口、`u`、由 s 折算的位移），**不乘字号**——气泡字号仍走现有
 *    `bubbleBoxRect`，档位不改变句子的换行。
 * 2. `centerOffset`：窗口内钉位点 → 绘制原点，单位是 `s`（renderer.ts 现在写死 -17s/+4.5s）。
 * 3. 命中矩形 = 以绘制原点为心、`hitAspect`×u 的框，再整体沿 y 移 `hitBiasY`×u。
 *    猫的 `bias 0` 必须逐字还原 computeCatRect（pet-geometry.ts:171-177）。
 */
export type SizeTier = "small" | "standard" | "large";
export type PetForm = "cat" | "girl";

/** 菜单与设置页的顺序即此顺序；档位从小到大。 */
export const PET_FORMS: readonly PetForm[] = ["cat", "girl"];
export const SIZE_TIERS: readonly SizeTier[] = ["small", "standard", "large"];

export const TIER_SCALE: Record<SizeTier, number> = { small: 0.85, standard: 1.0, large: 1.22 };

/** 钉位在窗口的纵向比例——`round(h × 0.3611)` 在 standard 档正好给出今天的 PIN.y = 39。 */
export const PIN_Y_RATIO = 0.3611;

export interface FormGeometry {
  /** 钉位 → 绘制原点，单位 s（renderer.ts 现在写死 -17s/+4.5s）。 */
  centerOffset: { dx: number; dy: number };
  /** 命中矩形尺寸，单位 u（猫 = 横摊的 2.0×1.85，尾巴把宽撑出来了）。 */
  hitAspect: { width: number; height: number };
  /**
   * 命中矩形中心相对**钉位点**的偏移，单位 s。
   * 猫 {0, -1.5} 逐字节还原 computeCatRect 今天的两个数（rect 中心 = (pin.x, pin.y − 1.5s)）；
   * 猫娘 {0, −45.75} 把矩形中心放到 viewBox y≈54（耳尖 8.5 与脚线 100 的中点）。
   * 为什么不从「绘制原点」算：猫的绘制原点在 pin − 17s 上（给尾巴让位），从原点算还要再补 17s，
   * 两个数谁都说不清是谁让的；从钉位点算，两个形态共用同一条基准。
   */
  hitCenter: { dx: number; dy: number };
}

export const FORM_GEOMETRY: Record<PetForm, FormGeometry> = {
  cat: {
    centerOffset: { dx: -17.0, dy: 4.5 },
    hitAspect: { width: 2.0, height: 1.85 },
    hitCenter: { dx: 0.0, dy: -1.5 },
  },
  girl: {
    centerOffset: { dx: 0.0, dy: 4.5 },
    hitAspect: { width: 0.86, height: 1.55 },
    hitCenter: { dx: 0.0, dy: -45.75 },
  },
};

export interface PetProfile {
  form: PetForm;
  tier: SizeTier;
  /** 档位线性系数。 */
  k: number;
  /** 收起态窗口基址（物理 px，zoom=1 时）。 */
  base: { width: number; height: number };
  /** 窗口内的钉位点（猫身体锚）。 */
  pin: { x: number; y: number };
  panel: { width: number; height: number };
  bubbleWidth: number;
  /** `scaleFor(e)` 再乘档位的 u/s，绘制与几何共用同一个换算口。 */
  catScale(e: number): { u: number; s: number };
}

const r = (v: number) => Math.round(v);

export function profileFor(form: PetForm, tier: SizeTier): PetProfile {
  const f: PetForm = PET_FORMS.includes(form) ? form : "cat";
  const t: SizeTier = SIZE_TIERS.includes(tier) ? tier : "standard";
  const k = TIER_SCALE[t];
  const base = { width: r(PET_W * k), height: r(PET_H * k) };
  return {
    form: f,
    tier: t,
    k,
    base,
    pin: { x: r(base.width / 2), y: r(base.height * PIN_Y_RATIO) },
    panel: { width: r(OPEN_W * k), height: r(OPEN_H * k) },
    bubbleWidth: r(BUB_W * k),
    catScale: (e: number) => {
      const { u } = scaleFor(e);
      return { u: u * k, s: (u * k) / 60.0 };
    },
  };
}

export function formGeometry(form: PetForm): FormGeometry {
  return FORM_GEOMETRY[PET_FORMS.includes(form) ? form : "cat"];
}
