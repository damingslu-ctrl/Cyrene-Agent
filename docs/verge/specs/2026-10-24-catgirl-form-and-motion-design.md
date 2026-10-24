# v1.5.0：拟人态猫娘形象与分层演出

参考：`Pal-AI-Lab/Coopanion`（人形女仆 chibi 的比例律 / 分层演出模型 / 37 词表情-动作表 /
pendulum `gain` / skin＝scheme×outfit 两轴）与 `PC2005-cloud/dsh-pet`（动作池加权轮 /
点击反馈 5 变体 / workStatus 六档 / 抓取小游戏 / 物理参数表）。

本地基线：桌宠是四足像素猫，`buildCatOps` 用**平面绝对坐标**画（无父子关节），
12 个 activity 挤在**同一个槽**里整体替换，7 个计时动作共用一条正弦包络
（`renderer.ts:685-700`），`blink`/`jumpY`/`mouse` 三个通道在运行时是死的
（`renderer.ts:129-130`，`art.ts:330` 的瞳孔漂移兜底）。

合规红线：Coopanion 是 **AGPL-3.0+**——本设计只借它的架构与词汇表，
**不复制它的代码、不复制它的 483 张贴图**；dsh-pet 是 MIT，可参考逻辑，
但它的 106 个动作是 AI 生成的透明视频（`assets/webm`），**渲染路线不采纳**（见 R-D2）。

## 1. 目标与非目标

**目标**

1. 新增**拟人态猫娘**形态：二头身 chibi，站/走/坐/跪/睡/被拎/被抛，头发与裙摆带弹簧。
2. **分层演出**：身体档位、单发手势、表情、粒子四层并发，取代「一个 activity 槽整体替换」。
3. **16 档表情**＋**18 个手势**＋**5 种点击反馈**，全部由现有 DrawOp 原语程序化产出。
4. `workStatus` 六档接主进程 agent 回合，让桌宠演出「它在干什么」而不是只会报流量。
5. 身形档位做成设置项（小／标准／大），猫娘默认「大」。
6. 沿用现有色板：不新增色相，12 位 roster 的 5 花色继续派生发色／耳尾／肤／裙。

**非目标（本期明确不做，见 §13）**

- 52 张聊天 sticker 的猫娘版（本期仍是四足像素猫，与 146 张派生资产短期不一致，记 §13 风险 4）；
  道具类动作（魔方／气球／茶／镜子）；声音；多宠物互撞；
  Coopanion 的 outfit 三套（只做女仆裙一套，但保留 `outfit` 轴的形状）。

## 2. 决策

| 号 | 决策 | 理由与被否掉的选项 |
|---|---|---|
| **R-D1** | **双形态，猫娘为默认**；四足几何冻结保留，右键与设置都能切 | 用户裁决。四足是这只桌宠的既有身份，一刀取代不可逆 |
| **R-D2** | 渲染走**程序化骨架**，不走位图帧表 | 位图帧表会废掉 `wash()` 只许派生的颜色锁（`src/shared/palette-from-cat.test.ts:61-87`）、12 角色×5 花色无法派生、290 MB 安装包再撑一截、`--check` 的逐字节比对与覆盖带全部重做 |
| **R-D3** | **派生资产只出猫娘单形态**（146 张），四足不再出图 | 146×2 让 `--check` 时长翻倍、仓库多一截二进制；「一秒回得去」由窗口里的 form 开关满足即可，旧 PNG 留在 git 历史。52 张贴纸本期不动，代价是贴纸与 146 张短期形态不一致（记 §13） |
| **R-D4** | `Mood` 联合类型**不动**（仍 5 档：`cat-types.ts:10`），新增 `Expression`（16 档）由 `Mood` 一对多派生，手势可临时覆写 | 25 档散点与 6 档状态图都吃 `Mood`＋冻结文件名（R-D2 of v1.4 spec），动它会连锁改名与重出图 |
| **R-D5** | `workStatus` 六档**沿用界面上已有的中文词**：`连接中／思考中／工作中／提醒／已处理／已中断`（`cat-sprite-manifest.ts:85`） | 界面上写出来的状态词就是承诺；新造词会出现「两个名字指同一件事」 |
| **R-D6** | 状态唯一来源＝新建 `src/main/pet/work-status.ts`，它订阅既有钩子；桌宠不自己猜 | 分散判定必然出现「工具跑完了还在转圈」；单点可测 |
| **R-D7** | 身形档位用**线性缩放**导出几何，`标准` 与今天的数字**逐字相同**（82×108／PIN 41,39） | 一次性作废全部屏幕尺的代价不可接受；标准档不变意味着既有 70 把尺继续有效 |
| **R-D8** | **`tier` 只负责线性缩放，`aspect`（交互框长宽比）是 form 的属性** | 四足是 `u×1.85` 的近似方块（`pet-geometry.ts:176`），猫娘是窄高；把两者混进一个数里会互相遮蔽 |
| **R-D9** | 面板档 `OPEN_W/OPEN_H` 与气泡 `BUB_W` **不参与缩放** | 文字面参与缩放＝每档一套字号与折行尺；本期不做 |
| **R-D10** | 静帧纪律保留：`t = 0` 且 clip 必须能归零 | `cat-variants.test.ts:27-32` 钉住「姿态纯函数＋t=0」，位图与运行时才可能同源 |
| **R-D11** | 新 IPC 通道**天生带发送方声明** | 落地安全方案 §3 第 1 条；`src/main/application/ipc-scope.ts:38-46` 今天的 `handle()` 对 sender 零校验 |
| **R-D12** | 新增**运行时画布尺**（真窗 82/100 宽档实测可点像素），不绿不发 | 今天没有任何尺量过运行时画布，而点击穿透按 `alpha ≥ 10` 逐像素判（`click-through.ts:42`）——窄高剪影正是最容易「画对了却点不中」的形状 |

## 3. 模块与契约

新增六个文件（`form.ts` 是薄派发，不算独立单元），改动七处既有文件：

```
src/renderer/pet/rig.ts     仿射复合与关节          （纯函数，无 DOM）
src/renderer/pet/face.ts    表情差分表 + buildFaceOps（纯函数，无 DOM）
src/renderer/pet/motion.ts  Clip 表 + 采样           （纯函数，无 DOM）
src/renderer/pet/girl.ts    猫娘几何 buildGirlOps    （纯函数，无 DOM）
src/renderer/pet/form.ts    buildPetOps 按 form 派发 （纯函数，无 DOM）
src/shared/pet-profile.ts   身形档位 → 几何 profile   （纯函数，main/renderer 共用）
src/main/pet/work-status.ts workStatus 唯一状态源    （§7）
```

改动：`art.ts`（`buildCatOps` 保留不动，helper 参数放宽）、`renderer.ts`（四层合成取代
`applyCompanionPose`）、`companion.ts`（调度器与仲裁）、`src/shared/pet-geometry.ts`（可选
`profile` 参数，§8）、`src/shared/draw-ops.ts`（新 `PetLayer` 标签，§4）、
`src/main/application/ipc-scope.ts`＋`src/shared/ipc-channels.ts`（新通道与发送方声明，§7）。

### 3.1 rig：先解决「没有父子变换」

`Xf.map()` 的八步（绕支点旋转→绕支点横缩→y 绕 100 缩＋差分→整体缩＋偏移，
`xf.ts:19-27`）**整体是仿射的**，但它的 8 个字段表达不了「任意两个仿射的复合」
（缺一般化的旋转＋非均匀缩放组合）。所以不改 `Xf`，另立一个矩阵类型：

```ts
/** 任何能给 Point2 的东西都能当变换用。 */
export type Map2 = { map(p: Point2): Point2 };

export interface Joint { rot?: number; sx?: number; sy?: number; dx?: number; dy?: number }

/** 2×3 仿射；`IDENTITY` 为单位阵；`map` 语义与 Xf 一致（viewBox → 屏幕 DIP）。 */
export type Mat = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;

export function matFromJoint(pivot: Point2, j: Joint): Mat;
export function matMul(parent: Mat, child: Mat): Mat;      // 父在左
export function matMap(m: Mat, p: Point2): Point2;
export function toMap2(m: Mat): Map2;
```

`art.ts` 的绘制助手（`fillSolid`／`strokeSolid`／`fillGrad` 等，见 `art.ts:85` 起的「native 助手对位」段）
参数从 `Xf` 放宽到 `Map2`——**结构等价、四足路径零行为改动**，这是本期唯一碰四足几何的地方。

关节表在 `girl.ts` 内声明，形如：

```
root(脚支点 60,100)
 ├ hip ── thighL/shinL/footL      ┆ thighR/shinR/footR
 └ chest ─ torso(裙 hem 带 gain)
          └ neck ─ head ─┬ earL/earR ── 复用四足的耳廓
                         ├ hairBack / hairFront / ahoge（刘海位移最大，后发反向）
                         └ face（face.ts 的坐标系锚在 head 局部）
          └ shoulderL ─ armL ─ handL ┆ shoulderR ─ armR ─ handR
 └ tail ── 复用四足的 ribbon 尾脊（`xf.ts:34-62`），支点挂在 hip
```

摆律用单摆近似：`angle += (target - angle) * (1 - exp(-rate*dt))`，每部件带 `gain`
（Coopanion 的 ponytail 0.35／pom 1.0 是它的实测档，我们的档由 §10 的尺重标给出）。
**缓动 dt 允许 50 ms 封顶**——`renderer.ts:636-639` 废掉的是「相位 += dt」，
连续弹簧状态量本来就走 50 ms 封顶那一条（同注释里点名的 native `:4964/4362`）。

### 3.2 face：16 档差分表

```ts
export type Expression =
  | "neutral" | "happy" | "wink" | "love" | "shy" | "surprised" | "angry" | "sad"
  | "sleepy" | "thinking" | "smug" | "pout" | "worried" | "excited" | "cry" | "confused";

export interface FaceParams {
  lidL: number; lidR: number;      // 0 睁 .. 1 闭（wink 靠这俩不等）
  eyeOpen: number;                 // 纵向开口量（惊讶>1，生气<1）
  pupil: [number, number];         // 视线偏移，gaze 通道终于有主人
  brow: number; browTilt: number;  // 眉高／眉斜（Coopanion 的 worried 与 angry 只差这两项）
  mouth: number; mouthWide: number;// 弧线弯度与口裂宽（-1 笑 .. +1 撅）
  blush: number; tear: number; sweat: number; star: number;
}

export function faceOf(expr: Expression, ctx: FaceCtx): FaceParams;  // 表驱动，纯函数
export function buildFaceOps(fp: FaceParams, head: Map2, s: number, coat: CatCoat): DrawOp[];
```

`Mood → Expression` 的一对多映射表钉在 `face.ts`（`idle→neutral`、`happy→happy`、
`thinking→thinking`、`grumpy→angry`、`sleep→sleepy`），`MOOD_TO_VARIANT` 那 25 行不动。

眼睛本体（白珠 2＋高光 4，比例 `rx*0.30 / rx*0.15`，`art.test.ts:141-151`）**从四足原样搬过来**：
四只眼睛的画法在 chibi 上不变，`art.test.ts:126-131` 的「眼吃 sx/sy」那条锁继续有效。
新增层只有 `brows`、`tear`。

### 3.3 motion：Clip 取代「一条正弦包络管七个动作」

```ts
export type MotionLayer = "body" | "gesture" | "face";

export type Channel =
  | "armL" | "armR" | "legL" | "legR" | "headYaw" | "headPitch" | "headBob"
  | "lean" | "hop" | "squash" | "hem" | "tail" | "earL" | "earR" | "hand";

export interface Clip {
  id: string;                    // "wave"
  layer: MotionLayer;
  ms: number;                    // 时长（沿用 ACTION_MS 的量级：1800~2400）
  lasting?: boolean;             // Coopanion 的 held：占住这层直到被顶替
  priority: 0 | 1 | 2 | 3;       // 0 随机小动作 · 1 workStatus · 2 互动 · 3 物理(drag/thrown)
  rest: Partial<Record<Channel, number>>;             // 出片后回到的姿态（必须存在）
  tracks: Partial<Record<Channel, (p: number, env: Env) => number>>;  // p = 进度 0..1
  face?: Expression;             // 挂在这个 clip 上的表情
  bubbleKey?: string;            // 与气泡文案层挂钩的 i18n key
}
```

采样器 `sampleClip(clip, p)` 输出 `Partial<Record<Channel, number>>`；
`Env` 是 `motion.ts` 内自带的一小组缓算子（`ease`／`pulse`／`step`），**不读时钟**——
它只把 `p` 变成形状，这是「纯函数」那条纪律的边界（同 `cat-variants.test.ts:27-32`）。
**纪律**：`tracks` 不许直接读 `Date.now()`——相位一律从 `p` 算，否则静帧档（R-D10）拿不到可复现姿态。

### 3.4 form 派发

```ts
export type PetForm = "girl" | "cat";
export function buildPetOps(form: PetForm, input: PetInput): DrawOp[];
// girl → buildGirlOps（rig+face+motion）；cat → buildCatOps（原样，含 12 个旧姿态语义）
```

`PetInput` 是 `CatInput` 的超集：新增 `form`、`channels`（采样结果）、`expression`。
位图管线（`buildSpriteOps`，`cat-variants.ts:122-139`）同样吃 `form`，缺省 `girl`。

## 4. 形态规格

**比例（Coopanion 硬律）**：冠→下巴 ＝ 下巴→脚底，即二头身。viewBox 仍是 `VB = 120`
（`art.ts:69`），脚支点沿用 `(60, 100)`——**这条不许改**，它是影子、月牙锚点、
藏身分步（`pet-geometry.ts:112-126`）共同的基准。于是猫娘的墨占 y≈22..100、x≈45..75
（窄高，尾巴把重心拽向朝背一侧，与四足同理）。

**层序（girl 的 ORDER，锁要按它钉）**：

```
ground_shadow → legs → tail → dress → body → arms → hands → collar → ears
→ hair_back → hair_front → ahoge → brows → eyes → nose → mouth → blush → tear
→（叠加层沿用：heart / stars / zzz / quiet_mark / badge / capsule / unread / bubble）
```

`collar`＝领口与蝴蝶结（`ACCENT`/`ROSE` 掺墨），`dress`＝女仆裙（围裙语义取代四足的 `bib`，
`bib` 层在 girl 里不再出现）。**新增 PetLayer 标签**（`src/shared/draw-ops.ts:7-13` 追加，
顺序与上面那条 ORDER 一致）：
`legs | dress | arms | hands | collar | hair_back | hair_front | ahoge | brows | tear`。
旧标签一个不删——四足的 `paws`／`bib`／`tail_tip` 继续存在，两条 ORDER 各自成锁。

**色板继承（不新增色相，逐槽写明出处）**

| 部位 | 取法 | 出处 |
|---|---|---|
| 头发／耳廓／尾 | `coat.furTop / furBot / furEdge`（深→浅渐变同四足的 Body 用法） | `src/shared/cat-coats.ts:20-30`，`art.ts:72` |
| 耳内／鼻尖 | `coat.earInner`、`coat.nose` | 同上 |
| 皮肤 | `wash(PAPER, α, …)` 掺极淡 `ROSE`；**只许 wash 板内色** | `src/shared/palette-from-cat.test.ts:61-87` |
| 裙身／围裙 | `wash(ACCENT …)` 与 `PAPER`，阴影走 `coat.shade` | 板内 `ACCENT #5b8def` |
| 眼睛 | 沿用 `EYE #14171f` ＋白珠 `PAPER` ＋高光比 `0.30/0.15` | `art.test.ts:141-151` |
| 腮红 | `coat.blush`（`ROSE` 系；`rose` 花色例外，走 `WARN`） | `src/shared/cat-coats.ts:66` |
| 轮廓 | `withAlpha(coat.light, 0.22)`，与四足 `body_stroke` 同参 | `art.ts:302` |

**结构读法沿用 `COAT_READS_BY`（`src/shared/cat-coats.ts:80`）**：`light-markings` 的四种花色靠浅色裙面
与白围裙撑结构，`paper`（奶油）靠掺墨轮廓撑——这条判据直接决定「头部在 large 档实际多大墨块、
哪里必须给暗端」（头部实测尺寸由尺 #71 在 P5 给出，不预设）。

**美术戒律（来自本项目已付过学费的记录，写进规格当硬约束）**：
① 小尺寸吃不下细线——发束至少两块色阶，禁止单像素发丝；
② 粉不许直接压墨，须 `wash` 预混；
③ 画在身上的记号（月牙／Zzz／汗滴／泪）必须**双色**，一笔软墨在深色桌布上等于没画；
④ 面板与气泡底必须不透明；
⑤ 命中区统一 20px，且必须用 §10 的运行时尺实测，不许由「看起来有墨」推断。

## 5. 分层演出模型与调度

```
body    : stand | walk | run | sit | kneel | drowse | sleep | crouch | drag | thrown
          （thrown 由 air/land 两条 clip 组合：离地弹起与落地压扁各一条）
gesture : nod shake wave bow hop shiver stretch yawn groom tilt curtsy clap
          coverFace peek point sip typeCode turnAway（18 个，等权抽）
face    : 16 档 Expression，自带 TTL（沿用气泡 6000 ms 那一档常量的语义，独立计时）
particle: heart stars zzz sweat tear note(延后)
```

四层各自「谁在就画谁」，同一层内新片顶旧片按 `priority`；**不同层并发**。
这直接修掉三个既有缺陷：`activity` 单槽（`companion.ts:44-46`）导致「走路时不能洗脸」，
一条正弦包络（`renderer.ts:691`）导致七个动作看起来是同一个动作的七次复制，
`blink`/`mouse` 死通道（`renderer.ts:129-130`、`art.ts:330`）导致不会眨眼、不会看人。

**加权永不停轮**（取代 `IDLE_ACTIVITIES` 的 7 行平表，`companion.ts:100-108`）：

| 类别 | 权重 | 说明 |
|---|---|---|
| 待机微动（呼吸＋眨眼＋视线漂移） | 10 | 什么都不做也算一档 |
| 张望 `peek`（探头＋`headYaw` 扫一下） | 5 | 借 dsh-pet 的 `turn` 语义 |
| 移动（walk / run 到工作区某点） | 5 | 沿用 55 px/s 与到达减速 |
| 小动作池（18 个手势等权抽，每档 ≈4.4） | 80 | dsh-pet 的 `rest` 档语义 |

四档相加＝100。抽中小动作池时，再在 18 个 gesture 内等权抽一次（两次抽都要能测：
单测直接喂 `random`，沿用 `pickIdleActivity` 的注入式随机，`companion.ts:156`）。

不重复上一动作的规则保留（`pickIdleActivity` 的 `previous` 剔除，`companion.ts:167`），
夜间与低精力的放大／归零分支保留（`:169-177`）。

**仲裁**：`workStatus` 的 `工作中`／`提醒` 期间，随机池只许投 `face` 与 `particle` 层，
不许投 `body`/`gesture`——猫娘在干活时不该去洗脸。物理层（`drag`/`thrown`）永远最高，
被扔出去的时候什么都得停下（沿用 v1.4 的落地压扁）。

**触摸六类**（Coopanion 的 touch kinds ＋ 2.5 s 合并）：`poke`（单击一下）／`pet`（按住摩挲）／
`grab`（拎起）／`drop`（松手）／`throw`（甩出）／`crash`（撞壁）。
同一类触摸在 2.5 s 内合并成一次，避免连点把动作队列灌满。
现有的「单击＝摸摸」（v1.4 spec §4）拆成 `poke` 与 `pet` 两档。

## 6. 动作／表情／事件清单

**点击反馈 5 变体**（dsh-pet `clicks×5`，每档＝一个 gesture＋一个 face）：

| 档 | gesture | face | 台词层 |
|---|---|---|---|
| 开心跃动 | `hop` | `happy` | `PET_LINES` |
| 害羞惊讶 | `coverFace` | `shy` | 新增 2 行 |
| 傲娇生气 | `turnAway`（`lean`＋`headYaw` 反向） | `angry` | 新增 2 行 |
| 挠痒咯咯笑 | `shiver` | `excited` | 新增 2 行 |
| 元气挥手 | `wave` | `smug` | `PLAY_LINES` |

**16 档表情**（Coopanion 的 19 档砍掉在 chibi 小脸上读不出的 3 档：`flustered`／`determined`／`dizzy`）：
`neutral happy wink love shy surprised angry sad sleepy thinking smug pout worried excited cry confused`。
每档必须与**任一**其它档在 **≥3 个通道**上不同，且栅格化后像素差 ≥ `MIN_PIXEL_DIFF`（0.005，
`scripts/build/cat-sprites.mjs:20`）——这条是 §10 尺 #72 的判据，防的是「十六张其实是一张」。

**workStatus 六档**（沿用 `cat-sprite-manifest.ts:85` 的中文名，一一对到 gesture＋face）：

| 档 | 身体 | 表情 | 附加 |
|---|---|---|---|
| 连接中 | `stand` 微前倾 | `worried` | 头顶汗滴 |
| 思考中 | `tilt`＋`headPitch` | `thinking` | 手指点颊（`hands` 层） |
| 工作中 | `typeCode`（坐着敲） | `smug` | 节奏性 `headBob` |
| 提醒 | `peek`＋`wave` | `surprised` | 气泡指向该看的那页（沿用 v1.4 的深链 `tab_hint`） |
| 已处理 | `bow` | `happy` | 星星一瞬 |
| 已中断 | `shiver`＋`lean` 后缩 | `sad` | 泪；随后 8 s 内无新事件回落待机 |

**延后不做的词汇**（写明白，免得验收时被当成缺件）：道具类（`玩魔方`／`吹气球`／`照镜子`／
`写代码`的显示器道具）、时节类 21 档（要贴图）、`吃什么` 12 档（要食物贴图，本期只做 `sip`）。

## 7. workStatus 接主进程

新建 `src/main/pet/work-status.ts` 作为**唯一状态源**。它不新造事件，只订阅既有钩子：

| 档 | 触发源（已核实的行号） | 边沿 |
|---|---|---|
| 思考中 | `streamChatWithAiSdk` / `generateChatWithAiSdk`（`model-runtime.ts:37,38`）的调用起止 | 起＝进，止＝出 |
| 工作中 | `ctx.onToolStarted?.()`（`tool-dispatcher.ts:162`，调用点 `:226`、`:292`） | 起 |
| 工作中→结束 | 同一次 dispatch 的返回（`dispatchToolCall` 的 `ToolDispatchResult`） | 止 |
| 提醒 | `publishAskCard`（`ask-card.ts:53`）与 `plan-mode` 的待批准态 | 起；`resolveAskCardSubmission`（`:102`）止 |
| 已中断 | `ctx.signal?.aborted`（`tool-dispatcher.ts:233`、`:299`）与工具抛错 | 起 |
| 连接中 | 模型端点不可用（未配 key／探测失败），沿用设置里的 key 自检结果 | 起 |
| 已处理 | 一轮收口且无待批准、无错误 | 起，5 s 后自动降回待机 |

**IPC 契约**（照 `VERGE_NETWORK_UPDATE` 的写法，`src/shared/ipc-channels.ts:611`）：

```
VERGE_WORK_STATUS_GET      "verge:work-status:get"      invoke → 当前 WorkStatus
VERGE_WORK_STATUS_UPDATE   "verge:work-status:update"   main → 所有窗 broadcast
```

`WorkStatus = { tier: "连接中"|"思考中"|"工作中"|"提醒"|"已处理"|"已中断", at: number, toolName?: string }`。
**`toolName` 进渲染层前必须过 i18n 白名单映射**——未登记的工具名一律降级成通用文案，
避免把内部标识（含可能的路径/参数）直接写上界面；这是 `feedback-advertised-ui-text-is-a-contract` 的延伸。

**发送方声明（R-D11）**：`src/main/application/ipc-scope.ts` 加 `handle(channel, { allow: [...] }, fn)`
重载，`IpcScope` 与 `IpcScopeMainLike` 两个接口（`:10-22`）同步加签名；校验 `event.senderFrame.url`
的 scheme＋路径；新通道只许宠物窗与主 React 窗调用。注册不声明的通道直接抛错。
本期只把**新通道**要求声明，旧通道分批补（列 §13）。

## 8. 身形档位与几何迁移

`src/shared/pet-profile.ts`：

```ts
export type SizeTier = "small" | "standard" | "large";
export interface PetProfile { tier: SizeTier; w: number; h: number; pin: Point; k: number }
export function profileFor(tier: SizeTier): PetProfile;
```

| tier | k | w×h | pin | 默认给谁 |
|---|---|---|---|---|
| small | 0.85 | **70×92** | (35, 33) | 四足 |
| standard | 1.00 | **82×108** | (41, 39) | 四足（与今天逐字相同） |
| large | 1.22 | **100×132** | (50, 48) | 猫娘 |

`pin.x = w/2`、`pin.y = round(h · 0.3611)`（标准档回算＝39，与现值一致）。
`scaleFor`（`pet-geometry.ts:59-62`）乘 `k`：`u = k · (37 + (32−37)·e)`，`s = u/60`；
`computeCatRect` 的 `u×1.85`（`pet-geometry.ts:176`）里 **1.85 换成 `formAspect[form]`（R-D8）**，
猫娘的系数由尺 #71 实测后钉，不预设。

`pet-geometry.ts` 的 `computePetLayout`／`resolveGrowthDirection`／`clampRestoreOrigin`
加可选 `profile` 参数，**缺省值就是今天的常量**，所以不传参数的既有调用与全部旧尺继续绿。
`OPEN_W/OPEN_H/BUB_W` 不进 profile（R-D9）。

**迁移**：`petWindowX/Y` 的落盘语义不变（仍是收起档窗口原点），
换档或换 form 时按新 `size` 走一次 `clampRestoreOrigin`（`pet-geometry.ts:157-163`）；
`pet-position-settled` 那条一次性落盘通道（v1.4 的 `VERGE_PET_POSITION_SETTLED`）不动。

## 9. 资产矩阵与尺重标

**重出为猫娘（自动，由 `scripts/build/cat-sprites.mjs` 从新几何栅格化）**：
状态图 72＋聊天情绪 25＋任务卡立绘 12＋方头像 12＋状态浮层 4＋欢迎页 4 ＝ `SPRITE_TARGETS` **129 条**，
再加非角色位图 **17 条**（含唯一横幅 1280×720）＝ **146 张**；
另有 `--only=icons` 支路 5 个文件（3 张 PNG＋1 个六档 ICO＋1 张安装器源图）。
（`src/renderer/pet/cat-sprite-manifest.ts:114-153` 与 `:174-196`；条数由
`cat-sprite-manifest.test.ts:13/:52` 分别钉在 72 与 17；图标支路见 `cat-sprites.mjs:164-190`）。
文件名与语义**全部冻结**（R-D2 of v1.4 spec），换的是像素不是路径。

**必须重新量的东西**（今天的数都是按四足胖子量的，换了窄高剪影全部要重跑）：

- `CROP_CRITERIA` 五档覆盖带与质心上限（`cat-sprite-manifest.ts:222-230`，
  注释里那段 2026-10-22 的 129 条实测记录要替换成本期实测，且**保留实测出处与日期**）；
- `CAT_CROPS` 五个 `window/anchor`（`cat-variants.ts:83-89`）——`full` 的 anchor 本来是
  「尾巴把重心拽到右边」的结果，猫娘要重新反推；
- `GIRL_POSES: Record<PoseName, () => SpritePose>`：12 个 `PoseName` 语义在猫娘上重写
  （卧→侧卧、趴→伏案、炸毛→发蓬＋生气），`PoseName` 联合不动。

`--check` 的三条判据（尺寸／预算 KB／覆盖＋质心）与 `MIN_PIXEL_DIFF` 机制全部保留，不改判据只改数。

## 10. 验收口径

**会被打红、需要按新几何重钉的尺**：`art.test.ts:42-49`（14 层 ORDER → 拆成两条 ORDER，
`cat` 一条原样保留、`girl` 一条新加）、`:51-58`（`paws_up` 三件套）、`:109-115`（包围盒 ≤82）、
`:117-124`（采样点数 49/53/15）、`:126-151`（眼与高光比例——**这条两形态共用，不改**）、
`:153-164`（爱心锚点）、`cat-variants.test.ts:34-46`（12 姿态哈希互异）、`:48-59`（裁剪带序与尾巴）、
`cat-sprite-manifest.test.ts:36/:43/:74` 三条正对照（覆盖带重标后**必须仍然能红**，
否则新带宽是放宽出来的哑尺）、`src/main/sticker-catalog.test.ts:26-40`（本期不碰 sticker，应原样绿）。

**必须原样活下来、一条都不许放松的不变量**：双色月牙与 Zzz（`art.test.ts:60-107`，含
`lum(core) < lum(halo)`）、气泡底不透明（`art.test.ts:223`）、`withAlpha` 与 `wash` 两套 alpha
单位「抛而不夹」（`src/shared/pet-tokens.test.ts:53-62`）、`CAT_PALETTE`/`PET_PRIVATE` 成员名单与
值域不相交（`src/shared/pet-tokens.test.ts:68-111`）、派生色可被 `wash(板内色…)` 复算
（`src/shared/palette-from-cat.test.ts:61-87`）、禁上游粉（`:35-41`）、WCAG 4.5／3.1（`:43-59`）、
位图管线禁 `text` 层与 `SPRITE_DROPPED_LAYERS`（`cat-variants.ts:108`、`cat-variants.test.ts:69-86`）、
`crescent` 只走 clip＋evenodd（`src/renderer/pet/ops.test.ts:93`）。

**新增尺（R-D12），编号接屏幕尺台账之后**（native 侧台账止于 #70，本仓 `docs/verge/plans/
2026-10-17-p2-data-plane-and-panel.md:20` 引用的就是这条线；#71 起为本期新尺）：

- **#71 运行时命中覆盖**：真窗（CDP，沿用 `scripts/verify/p4-cdp-capture.mjs` 那套）起猫娘窗，
  逐 form × 逐 tier 读画布 alpha，产出「可点像素占窗口比」「墨 bbox」「质心」三行，
  并**由实测反钉 `formAspect[girl]`**。判据：交互框与实测 bbox 的 IoU ≥ 0.55，
  且头部中线一列必须有可点像素（防「点头顶点不中」）。
- **#72 表情可分辨矩阵**：16×15 成对像素差全部 ≥ `MIN_PIXEL_DIFF`，任一对低于即红＋点名。
- **#73 clip 归零**：每个 clip 采样 `p=0` 必须等于 `rest`，`p=1` 也必须落回 `rest`；
  违反即「演完留在人身上」，红。
- **#74 workStatus 端到端**：真跑一次工具调用与一次 ask-card，六档至少覆盖 4 档，逐档截屏，
  且断言 `toolName` 未登记的档不显示内部标识。

**变异验牙（本项目纪律：尺要证明有牙，`project-false-green-locks`）**：
① 把 `matMul` 改成不复合父阵 → 手臂该红；② 拿掉某个 clip 的 `rest` 归零 → #73 该红；
③ 把两档表情改成同一张 → #72 该红；④ 把 `formAspect` 写回 1.85 → #71 该红；
⑤ 把 `work-status` 的一档触发源注掉 → #74 该红。

**门**（全部是 `package.json` 里已存在的脚本）：`CI=true npx vitest run`、
`check:main`/`check:preload`/`check:renderer`、`palette:check`/`palette:migrate:check`/
`check:brand`/`check:roster`/`check:sprites`（该脚本本身就是 `cat-sprites.mjs --check`）、
i18n 锁与 `src/main/application/ipc-contract.test.ts`（新增两通道必须登记）、
`verify:installer --expect-version 1.5.0`。

## 11. 错误与降级

- **无新依赖、无新外部出口**：全部程序化，不生成图像、不下载模型；`--egress-probe` 的
  「外部请求＝0」判据保持。
- `workStatus` 事件空洞 8 s → 自动回落 `stand`＋`neutral`（不能让猫娘冻在「工作中」）。
- 主进程拿不到状态源（未配 key／orchestrator 未起）→ 不投 `提醒`，走现有的空态与
  「还没读到不等于 0」口径（`project-pet-boot-experience`）。
- `Expression`/`Clip` 查不到 id → **抛错**（构建期即红），不许静默退化成 `neutral`
  （同 `variantFor` 的「缺行当场红」纪律，`cat-sprite-manifest.ts:91-94`）。
- 切 form／切 tier 时不许逐帧写盘，仍走一次性 `pet-position-settled`。
- 安静期（免打扰）语义不变：`workStatus` 的 `提醒` 只画记号不气泡，醒来进值班简报
  （沿用 `project-pet-quiet-mode` 的契约）。

## 12. 分期

| 期 | 内容 | 出口判据 |
|---|---|---|
| P1 | `pet-profile.ts`＋`rig.ts`（`Mat`/`Joint`/helper 放宽到 `Map2`）＋`girl.ts` 站姿 | 两条 ORDER 各自成锁；四足全量测试原样绿 |
| P2 | `face.ts` 16 档＋`motion.ts` clip 表＋四层合成取代 `applyCompanionPose` | 尺 #72 #73 绿；眨眼与视线复活 |
| P3 | `work-status.ts`＋两 IPC 通道＋`ipc-scope` 发送方声明 | 尺 #74 绿；ipc-contract 锁登记 |
| P4 | 18 手势＋5 点击反馈＋加权永不停轮＋仲裁＋触摸六类 | 与四足等价的调度单测；`companion.test.ts` 扩表 |
| P5 | 三档身形＋146 张资产重出＋尺 #71 实测反钉＋全量门＋发版 v1.5.0 | `check:sprites` 绿；`verify:installer` 绿 |

每期一个提交、一次全量门；发版沿用既有通路（HTTPS＋7896、手动 dispatch 打包、
Release 资产用 digest 核哈希），`electron-builder.yml` 的 `publish: null` 不许动。

## 13. 风险、延后与授权

**风险**

1. **程序化的观感上限**：chibi 小脸上做 16 档表情是本期最吃功力的地方。缓解＝尺 #72 当场把
   「十六张其实是一张」判红，做不出分辨度就减档并把减掉的名字写进本文档，不许悄悄合并。
2. **窄高剪影与命中区**（最危险的老洞）：`PIN`＋脚支点＋`alpha ≥ 10` 那三个数同时决定
   位置、锚点、可点性，而今天没有一把尺量过运行时画布。缓解＝尺 #71 是 P5 的硬出口。
3. **146 张资产一次重出**＝一次视觉大变化，`CROP_CRITERIA` 的覆盖带全部要重量。
   缓解＝P5 独立成期，先量后钉，量不出来不改判据。
4. **形态短期不一致**：146 张派生资产换猫娘、52 张贴纸仍是四足（R-D3 的代价，见 §13 延后）。

**延后清单（显式记账）**：sticker 猫娘版；outfit 三套；时节／道具／吃什么 12 档；声音；
多宠物互撞与接住小游戏；旧 IPC 通道分批补发送方声明；`setRedrawPolicy` 至今没人调用
（`renderer.ts:602-608`）——本期顺手接进 gesture 层提帧，或删掉，P2 里定。

**授权项**：合并／推送／发布（沿用你既有的「直接发布」令，走 fork 与 7896 通路）；
不涉及新依赖、不碰 `%APPDATA%\Cyrene`、不装系统组件、不改本机防火墙。
