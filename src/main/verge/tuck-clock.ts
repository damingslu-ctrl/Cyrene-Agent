/**
 * 贴边藏身（tuck / peek）的纯函数面。
 *
 * 逐字对位 native `main.rs`（只搬不改）：
 * - 常量：`TUCK_IDLE_SECS`（:1941）、`TUCK_PEEK_PX`（:1945）、`EDGE_NEAR_PX`（:1950）、
 *   `TUCK_PROBE_IDLE_SECS`（:5648 的 `--tuck-probe` 档 `app.tuck_lim = 2.5`）。
 * - `shouldTuck`：:4926-4931 的六条闸门（顺序即语义：开关 → 活跃 → 闲置 → e → be → 气泡）。
 *   贴边判定（rightGap/leftGap 对 `EDGE_NEAR_PX`，:4933-4945）是闸门之后的**方向决策**，
 *   不在这条判据里——brief 的输入面也没给它留位置；落点在渲染器 tick。
 * - `tuckHintShout`：:3583-3589（audit-19：第一次真藏之前先解释， hinted 凭据跨重启）。
 * - `tuckStep`：:4966-4971 的指数缓动。dt 封顶 50ms 只喂**缓动状态量**（:3953 的双 dt 分工；
 *   猫相位钟走绝对时间，不归这里）。`peekDx` 参数是调用场面合同位：native 步进的就是
 *   `self.peek_dx` 这一个量（current 与它在调用点同值），native 没有第二个偏移，
 *   所以步进式不消费它——保留参数是为把调用方已应用的偏移留在签名上对齐 :4952 的
 *   engaging 判据（`peek_dx.abs() < 0.5`），删掉它调用点就要自证传参正确性。
 * - `unTuckForDrag`：:4796-4801 / :4102-4108 的「吸收 peek 进基准位再清偏移」。
 *   不夹屏（native 此处也不夹；夹取归 :4171-4184 的每帧基准位夹取，
 *   我们的对应物是 clampRestoreOrigin + computePetLayout 的夹紧分支）。
 *
 * 消费面：渲染器 tick（src/renderer/pet/renderer.ts）与单测。main 进程侧不 import
 * 本模块的运行函数（写盘走 VergeService、菜单走 pet-menu），但它随
 * tsconfig.main 的 `src/main/**` 一起编译——文件位置由计划钉死在 main/verge。
 */

/** 闲置多少秒后允许自己滑向屏边。native `main.rs:1941`（6.0）。 */
export const TUCK_IDLE_SECS = 6;

/** 滑出去的位移（DIP）。native `main.rs:1945`（40.0）：≈54% 窗宽，藏半身、双眼仍在屏内。 */
export const TUCK_PEEK_PX = 40;

/** 「贴边」判定容差。native `main.rs:1950`（60.0）：落位被 DPI 夹过一轮，0 容差会逐台机器失效。 */
export const EDGE_NEAR_PX = 60;

/** `--tuck-probe` 的验收档。native `main.rs:5648`（2.5）：给 harness 留出在滑走前锁底的时间。 */
export const TUCK_PROBE_IDLE_SECS = 2.5;

/** 头一次真要藏时先解释的那句话。native `main.rs:2410`，逐字。 */
export const TUCK_HINT = "放着不动\n我会贴边藏起来\n点我就回来";

export interface ShouldTuckInput {
  /** 用户开关（Persist.tuck，右键菜单「贴边藏身」）；关了就没有「猫自己不见了」。 */
  tuckEnabled: boolean;
  /** 光标在窗内 / 拖拽中 / 面板交互中（native :4609 的 user_active）。 */
  userActive: boolean;
  idleSecs: number;
  /** 闲置门槛：TUCK_IDLE_SECS 或探针档 TUCK_PROBE_IDLE_SECS。判据是**严格大于**（:4928 `>`）。 */
  limit: number;
  /** 面板展开度。:4929 `e < 0.05`。 */
  e: number;
  /** 气泡展开度。:4930 `be < 0.05`——be 是缓动量，气泡刚立起来的几帧仍压在 0.05 下（:4921）。 */
  be: number;
  /** native `bubble.is_none()`（:4931）：有**话**要说不看 be——先解释、说完再滑的承重墙。 */
  bubbleOpen: boolean;
}

/** shouldTuck：五道闸门全开才藏（native main.rs:4926-4931 的 if 链，顺序照搬）。 */
export function shouldTuck(input: ShouldTuckInput): boolean {
  return (
    input.tuckEnabled
    && !input.userActive
    && input.idleSecs > input.limit
    && input.e < 0.05
    && input.be < 0.05
    && !input.bubbleOpen
  );
}

export interface TuckHintShoutInput {
  /** 藏身开关当下开着（对着关掉藏身的人喊「我会贴边藏起来」是谎话）。 */
  tuckOn: boolean;
  /** 已经说过的凭据（Persist.tuck_hinted，跨重启）。 */
  hinted: boolean;
  /** 这一帧所有藏身闸门刚全开、且还没起步（native :4952 用 |peek_dx| < 0.5 认「刚起步」）。 */
  engaging: boolean;
}

/** 第一次真藏之前先解释；只说一次。native `tuck_hint_shout`（main.rs:3583-3589）。 */
export function tuckHintShout(input: TuckHintShoutInput): string | null {
  if (input.tuckOn && input.engaging && !input.hinted) return TUCK_HINT;
  return null;
}

/**
 * 指数缓动一步。native main.rs:4968-4971：
 * `k = (dt.min(0.05) * 3.5).min(1.0)`；`peek_dx += (target - peek_dx) * k`；
 * 残余 `|peek_dx - target| < 0.5` 时吸附到位（0.3/0.5 的死区差是 :4970 的字面值）。
 * `.min(1.0)` 在 0.05 封顶后恒不触发，native 写了就照搬。
 */
export function tuckStep(current: number, target: number, dt: number, peekDx: number): number {
  const k = Math.min(Math.min(dt, 0.05) * 3.5, 1.0);
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 0.5 ? target : next;
}

/**
 * 拖走/展开前把 peek 吸收进基准位（native main.rs:4796-4801、:4102-4108 的
 * `pet_pos = pos + peek_dx; peek_dx = 0`）。不做这一步，随后的窗口位置会被
 * `pin_in_win = pet + PIN - win_pos` 反向补偿回原屏幕位，猫被窗口裁掉——
 * 就是 :4290 「peek_dx 只能进绘制偏移，不能进 win_pos」警告过的镜像事故。
 * 返回补回后的位置；调用方同时把偏移归零。native 只动 x（peek 是横向位移），
 * y 由调用方自持（brief 钉死的签名面也只有 x）。
 */
export function unTuckForDrag(position: { x: number }, peekDx: number): { x: number } {
  return { x: position.x + peekDx };
}
