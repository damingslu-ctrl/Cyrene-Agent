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

**比例（2026-10-24 按参考帧实测重写，取代原「二头身」这一条手工律）**：viewBox 仍是 `VB = 120`
（`art.ts:69`），脚支点沿用 `(60, 100)`——**这条不许改**，它是影子、月牙锚点、
藏身分步（`pet-geometry.ts:112-126`）共同的基准。

比例的实际来源是 `dsh-pet/assets/preview/daiji-huxi-xiuxian.gif` 的逐行墨迹扫描
（参考 220×124 画布、墨迹 73×93 px）。换算到 viewBox（crown=20、footY=100）：

| 部位 | 参考（行号 / 宽） | 这里（viewBox） |
|---|---|---|
| 发顶（含呆毛） | 0 | `crown 22` |
| 头最宽处 | 42 行、67 px | `headCy 46.5`、`headRx 29` → 58 宽 |
| 可见皮肤 | 33..56 行、42 px | `faceTop 33`、`faceRx 16` → 32 宽（头宽的 55%） |
| 眼 | 39..45 行、单眼 9 px、间距 7 px | `eyeY 44`、`±9.8`、`eyeRr 5.0`、`eyeRy 5.6` |
| 下巴 | 56 行 | `chin 58.9` |
| 肩 | 62 行 | `shoulderY 65.7` |
| 裙摆最宽 | 82..84 行、53 px | `hemY 90.9`、`hemHalf 23.5`（与头同量级但略窄） |
| 脚 | 92 行 | `footY 100` |

由此得到三条**可判据**的结构（`girl.test.ts` 按比值钉，不钉像素）：
① 头占全身 44%..54%（实测 0.486）；② 头是全身最宽处（`headRx*2 ≥ hemHalf*2`）；
③ 脸占头宽 50%..64%（实测 55%）。

⚠️ **v1.5.0 发出去的那一版漏了一件事**：头部矩阵没有挂到根矩阵上（`matMul`），
头部的线性部分是纯旋转（缩放恒 1），而身子按 `s` 缩放——头比身子大约 1.62 倍。
这就是「头小身更小、整只糊成一团」的根因，于 2026-10-24 连同配色一起修掉。

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

四档相加＝100。抽中小动作池后**不再 18 条等权**，而是照 dsh-pet
`assets/config.jsonc` 的 `animations.categories` 分五类、按 20/20/16/14/10 抽
（`GESTURE_CATEGORIES`，`companion.ts`）：

| 分类 | 权重 | 参考里的动作（举例） | 这里对应的 clip |
|---|---|---|---|
| 小动作 | 20 | 超大伸懒腰 / 哈欠连天 / 照镜子 / 轻快记录 | stretch / yawn / groom / tilt / shiver / nod / coverFace |
| 玩耍 | 20 | 原地跳跃 / 轻快摇摆舞 / 拍手 | clap / hop / wave / point / shake |
| 吃什么 | 16 | 吃白饭 / 大口吃零食 / 吃冰淇淋 | sip / curtsy |
| 时节 | 14 | 女仆屈膝礼仪 / 收红包 | bow / turnAway |
| 文字 | 10 | 深度思考碎碎念 | typeCode / peek |

与参考一致的两条**硬约束**（`companion.test` 有锁）：
① 五类权重合计必须等于顶层 `gesture` 权重 80（参考 `config.jsonc` 原注释的要求）；
② 18 条 clip 必须一条不落地进池——否则那条动作永远不会被自主抽到。

不重复上一动作的规则保留（`pickIdleActivity` 的 `previous` 剔除，`companion.ts:167`），
但**剔完为空的分类不整类消失**（否则类权重和变化会让其余四类的相对概率被悄悄放大）。
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

---

## 14. v1.5.0 实施记录与口径差回写（2026-10-24）

> 本节由 Task 28 回写。实现与实施计划见
> `docs/verge/plans/2026-10-24-catgirl-form-and-motion.md` 与 `docs/verge/notes/progress.md`。

### 14.1 口径差台账（①–⑱）

| # | spec 原文 | 实现 | 理由 |
|---|---|---|---|
| ① | `Map2` 只有 `map` | 另有 `scaleX/scaleY/k` | 绘图助手要椭圆半径与线宽；只给 `map` 等于把 `sx/sy` 泄回助手层 |
| ② | `Joint` 用 `dx/dy` | 用全局落点 `(gx,gy)` | 骨架要能直接说「肩在 (47,66)」，增量表达不了 |
| ③ | `buildPetOps(form, input)` | `buildPetOps(input)` 从 `input.form` 取 | `PetInput` 本来就有 `form`，两处给就要另定「谁赢」 |
| ④ | 四层合成取代 `applyCompanionPose` | 拆成 `applyCatPose` + `applyLayerPose` 按 form 分派 | R-D2：四足姿态的唯一生产者不能中途换，否则 P2 就红 |
| ⑤ | 复用 `character-status-moods` 的六档 | 不接管：两套词汇、两条码路 | 那套只在 run 结束后写、且广播永远到不了猫窗 |
| ⑥ | 提醒的起止＝`publishAskCard`→`resolveAskCardSubmission` | 订阅下游总线，覆盖 timeout/unavailable/cancelled | 按函数名挂钩会漏掉一半真实提醒 |
| ⑦ | 载荷发 `profileFor(...)` | 只发 `{ form, tier }` 两个字符串 | `PetProfile` 带 `catScale` 方法，structured clone 当场抛 |
| ⑧ | `Clip.bubbleKey` | 撤掉 | 猫窗没有 i18n 运行时，表里写 key 零读者＝假契约 |
| ⑨ | 已处理＝happy＋星星 | `star` 通道偏置到 `excited` 才出星 | Task 9 的差分表里 happy 的 star 是 0 |
| ⑩ | 提醒深链沿用 `tab_hint` | 改为 `revealAskWorkStatus()`（第五通道） | `tab_hint` 在本 fork 0 命中，是 native 版的东西 |
| ⑪ | #74 从生产入口灌 AGUI 事件 | 探针走 `WorkStatusService.feed` 的公开面 | 不出网、无模型凭据，只能从服务入口造事件 |
| ⑫ | 手势种子 6 条 | 本任务落 9 条（补 typeCode/peek/shiver） | Task 14/18 的测试与演出表要用；缺一条 `gestureClip` 当场抛 |
| ⑬ | 粒子是第四层 | `MotionLayer` 保持 body/gesture/face 三档 | 粒子不吃骨架；`sweat/tear/star` 在 `FaceParams`，其余由 overlay 承载 |
| ⑭ | 加权表取代 `IDLE_ACTIVITIES` | 新增 `pickRoll` 按 form 分派，四足平表退役另计 | 四足行为与 RNG 消耗被既有 18 条测试钉死 |
| ⑮ | 触摸六类形态无关 | 登记与合并共用，**反应只长在 girl** | 五档反馈都是猫娘 clip；四足单击仍走 `handleCommand("pet")` |
| ⑯ | 重推 `CAT_CROPS` 与覆盖带 | 加 `GIRL_CROPS` 与 `CROP_CRITERIA_BY_FORM` 第二套，CAT 保留 | 图标支路 5 件仍是四足（§9 没点名换），CAT 表仍有消费方 |
| ⑰ | 猫娘为默认 | `DEFAULT_VERGE_STATE` 翻 girl/large；`defaultProfile()` 仍 cat/standard | 前者是产品默认，后者是屏幕尺参照系；翻它等于重钉 ~70 把尺 |
| ⑱ | #71 只读画布 | 顺带修活 `getHitAreaDefs` 并把 `hitRect/form/tier` 加进诊断口 | 那个方法此前钉死 `PIN/e:0` 且零消费方；诊断口是测试面，不进 UI |

### 14.2 尺 #71–#74 落账

| # | 脚本/测试 | 判据 | 变异验牙 | 本期状态 |
|---|---|---|---|---|
| #71 | `src/renderer/pet/hit-iou.test.ts`（离线层，进 CI）＋ `scripts/verify/pet-hit-cdp.mjs`（真窗） | 六组 form×tier 的 IoU ≥ 0.55、头部中线一列有可点像素 | ④ 把 `hitAspect.height` 写回 1.85 → IoU 掉下去 | 离线层绿；**CDP 版未跑** |
| #72 | `src/renderer/pet/face-distinguishability.test.ts` | 16×15 对像素差全部 ≥ `MIN_PIXEL_DIFF` | 把 wink 写成 happy → 该对 0% 必红 | 绿（贴脸 104×104 栅格化） |
| #73 | `src/renderer/pet/motion-clips.test.ts` | 每条 clip 的 p=0/p=1 都落回 rest；rest 键集==tracks 键集 | ② 删某条 rest 项 → 点名该 clip | 绿（30 条，1e−12 容差） |
| #74 | `scripts/verify/work-status-cdp.mjs` | 六档至少 4 档、内部标识零泄漏 | ⑤ 注掉一档触发源 → 该档缺席必红 | **未实现**（见 14.3） |

### 14.3 本期未完成 / 延后

- **#74 的屏幕半条链与第五通道 `VERGE_PET_REVEAL_ASK`**：`workStatus` 六档服务与演出表已落
  （`work-status.test.ts` 10 条、`work-status-presentation.test.ts` 5 条），但「真跑一次工具调用
  与 ask-card、逐档截屏」的 CDP 探针与点气泡唤卡的第五通道本期没有实现。
- **#71 的真窗 CDP 版**：脚本已写、判据已定，本轮未跑（需起 Electron + D 盘一次性 profile）。
  离线层已量到同一套几何并反钉了 `FORM_GEOMETRY.girl`。
- **形态与 workStatus 的接线**：`composeChannels` 目前只按活动选 body、按显式手势选 gesture，
  `workStatus` 的六档演出表尚未接进去（仍走 mood 级联的脸）。这是 v1.5.1 的第一件事。
- 原延后清单继续有效，另加：图标支路 5 件猫娘版、四足 `IDLE_ACTIVITIES` 退役、
  `ACTIVITY_GESTURE` 收敛、`renderer.test.ts` 四段 harness 各带一份的工程账、猫窗气泡文案 i18n。

### 14.4 实测记录（2026-10-24）

- 资产：`cat-sprites --measure` 的 girl 五组覆盖度为 square 0.150–0.157 / bust 0.180–0.192 /
  full 0.091–0.118 / round 0.136–0.142 / wide 0.058（n=83/30/17/15/1）；146 张重出 1267.3 KB。
- 命中：girl 墨 bbox 三档 1.56/1.32/1.09u 宽、2.19/2.00/1.79u 高，中心在钉位下方 0.40–0.59u。
- 表情：`MIN_PIXEL_DIFF` 按形态分列（cat 0.5%、girl 0.15%）；撞车的 5 对 mood 已改姿态拉开。

---

## 15. v1.7.0 猫娘专项（2026-10-25）

> 用户令：只提猫娘、要巨量。所有新能力只在 `form === "girl"` 生效，四足路径原样不动。
> 实施台账与量测见 `docs/verge/notes/progress.md` 的「v1.7.0」一节。

### 15.1 新增的四个模块

| 模块 | 职责 | 关键常量/契约 |
|---|---|---|
| `girl-face-meta.ts` | 146 帧的脸块与墨框（格内 0..1，构建期实测） | `GIRL_FACE` / `GIRL_INK_BOX`；由 `build-girl-face.py` 生成，禁止手改 |
| `girl-presence.ts` | 注视存在感：倾斜、侧移、迟滞转身、注意边沿 | `near 60 / far 300 / turn 10px / hold 380ms / lock 900ms / notice 0.86 / cooldown 12s / lean 4.2° / shift 2.2px` |
| `girl-fx.ts` | 屏幕记号层：投影 / 腮红 / `!` / 晕星 / 音符 / 蒸汽 / 尘 | `NOTICE_FX_MS 1800` / `DIZZY_FX_MS 3200`；`below` 只放投影，其余在 `above` |
| `girl-zones.ts` | 三区分界与连点计数 | `headEnd 0.36 / feetStart 0.76`；`2.4s / 4 下 / 冷却 6s` |

### 15.2 行为与渲染契约

- **静息**：`REST_AFTER_MS 40s` → 坐 `18s + 0..12s` → `stretch 2.2s`；判据排在 `canRoam` 之前，
  且 `userActive`（光标在窗内）每拍把 `lastUserAt` 按到 `now`。歇完重置秒表。
- **记号跟帧**：`girlCellPoint` 按 `paintGirlFrame` 的同一顺序折进朝向/缩放/旋转；腮红、
  「！」、晕星、音符、蒸汽的落点全部来自 `girlFaceBox(frame)`，不按固定比例猜脸。
- **双色纪律**：画在桌布上的一笔先铺 `PAPER` 光边再压深色（native #69 同一条）。
- **直点反应**：`say(text, priority, now, replaceSame)`；`replaceSame` 只给用户动作，
  ≥3 的播报仍不可抢。
- **点击入口**：`renderer.tapAt(cssX, cssY, heldMs)`。四足原路 `clickKindFor → touch`；
  猫娘长按仍是摩挲，轻点按分区，晕只跟点多快有关。
- **调试面**：`getLayoutInfo()` 增 `zoom`（绘制空间→窗口 CSS 的唯一系数）；
  `getGirlDiagnostics()` 报 presence/noticeAgeMs/dizzyLeft/blush/clip/fx；
  `__cyrene.setGazeFrozen` 只停探针那一轮的光标轮询。

### 15.3 验收

- 单测：猫娘 7 个文件 117 条绿；全仓 664 文件 / 7057 通过（1 skipped）。
- 真窗：`scripts/verify/pet-girl-cdp.mjs` 18 条判据 `all clear`——倾斜 −3.96° / 转身 −1 /
  松开 −0.15°；注意 422.6ms；头 tap：`shy` + `coverFace` + 腮红 0.72；脚 tap：`wink` +
  `shiver` + 换句；晕 3169.3ms / 记号 16 笔；坐：`rest` + `sit`。
- 未覆盖：记号层只查了状态与笔数（外加截图目检），没有逐像素尺；眩晕冷却 6s 与注意冷却
  12s 没有在真窗里等满，由单测锁住。

---

## 16. v1.8.0 猫娘专项 II（2026-10-25）

> 用户令：继续猫娘专项，「我要超级多」。仍只在 `form === "girl"` 生效；四足的 RNG、
> 行为表与渲染路径不动。实施台账见 `docs/verge/notes/progress.md` 的「v1.8.0」一节。

### 16.1 新增模块

| 模块 | 职责 | 关键常量/契约 |
|---|---|---|
| `girl-bond.ts` | 亲密度→五档称号、升级秒表、本地日键、相识天数 | `BOND_TIERS` 初识 0 / 熟悉 0.22 / 亲近 0.45 / 依赖 0.66 / 心意相通 0.86；`BOND_UP_MS 2600`；`dateKey` / `nightKey`（凌晨 0–5 点算前一晚）/ `daysTogether`（见面当天=第 1 天，坏档回 1） |
| `girl-toy.ts` | 毛线球的物理与画面 | `TOY`：r 4.5 / g 760 / 地面弹性 0.42 / 墙 0.55 / 滚动摩擦 2.2 / 空气阻力 0.35 / 弹跳下限 42 / 静止阈值 9 / 踢力 260 / 封顶 560 / 拖尾 7 / 单步 50ms；固定 8ms 子步、每拍最多 10 步 |
| `girl-tease.ts` | 「逗光标」纯计数器 | `TEASE`：900ms 窗 / 单次 ≥26px / 采样间隔 ≤240ms / 凑满 2 次快速移动触发；冷却归引擎（18s，且睡觉/安静/被抓时整段不接） |

### 16.2 引擎契约

- **羁绊升级**：只有 `rewardAffinity`（摸头/挠脚/踢球）会广播升级；`setVitals`/读档不广播。
  升级时 `bondUpUntil = now + 2600` + `clap` 手势 + 档位台词（优先级 2），并立即落盘。
- **相识天数**：`metAt` 在首次构造时写入，`daysTogether` 用本地 y/m/d 重组的 UTC 零点做差
  （DST 不会多/少一天）。状态卡片与问候句都读它。
- **摸头连击**：`PAT_COMBO_WINDOW_MS 3200` / 封顶 5；第 1 下与旧口径逐字节一致
  （`coverFace` + `+0.04`）；第 3/4 下换 `shiver`/`hop`，封顶那下多给 `+0.02`；
  第 2 下起换连击台词。`patCombo` 与 `patComboLeft` 进快照供诊断。
- **受惊唤醒**：睡着时碰头走 `wakeStartle`——立刻 `idle`、`STARTLE_MS 1600` 缩身、
  夜/日两套台词，不走摸头/挠脚反馈。
- **深夜提醒**：渲染端每 `NIGHT_NUDGE_POLL_MS 30s` 调一次 `nightNudge`；23 点后或 5 点前、
  同一晚 45 分钟去重、优先级 0；不挂 `stepIdle`，避免多一个随机源挪动既有抽签。
- **扑光标**：只接 `idle/rest`，非晕、距光标 ≥6px；一步 9–26px（`18%` 距离，夹在
  `[9,26]`），落地压扁 220ms + `hop` 片 + 得意台词；冷却 `POUNCE_COOLDOWN_MS 18s`。
  触发源是 `TeaseTracker`：渲染端每拍喂一次光标，凑满一次才扑。
- **毛线球**：物理跑在绘制空间，边界由渲染端给（左右 5px、地面 = 脚线）。球静止、离她
  ≤40px、她闲着且不安静/不睡时才会自动扒拉：首拍 12–22s，扒过后 14–26s，忙着别的
  则 8s 后再试。`auto` 只换 `peek` 手势，不出声不涨好感；用户点球才换 `hop` +
  `play` 动作 + 台词 + `+0.01` 亲密度。
- **坐垫**：`activity === "rest"` 时 180ms 指数淡入，起身淡出；画在 `below`（人物之下）。
- **晨间伸懒腰**：只在 `greet()` 里判 5–11 点、`dateKey` 落盘去重；拖拽/投掷/睡觉不打断。
  四段问候自身按标点预断成两行（每行 ≤78px），第 2 天起再接「第 N 天」独占的一行。
- **状态卡片**：猫娘形态改为四行 `亲密度/饱腹/精力/称号 · 第 N 天`，靠 `\n` 硬换行，
  不走贪心折行；四足仍是原来的一行 `vitalLine`。

### 16.3 渲染契约

- 玩具与坐垫的绘制 op 都进 `buildGirlFxOps` 的 `below`（人物之下），记号/爱心/受惊星在
  `above`；`girl.fx` 诊断分别报 `below/above` 笔数。
- `getGirlDiagnostics()` 新增：`cushion`、`toy{x,y,vx,vy,rest,trail}`、`bondUpLeft`、
  `startleLeft`、`pounces`、`teasePending`、`nightCheckInMs`。
- 帧率分档：球在动或羁绊升级/连击/受惊进行中 → `FPS_HOVER`；坐垫淡入淡出 → `FPS_ACTIVE`。
- 气泡文本 op 增加 `maxWidth`（78 = 86 − 2×4），`fillText` 在合成端硬裁；`wrapBubbleText`
  的 `\n` 为硬换行。字宽表换成 Chromium 9px 实测值（CJK/`·`/`…` 9.00、`%` 8.29、
  `—` 8.05、空格 2.02）——旧表把 `·` 估成 5.2，状态句算 74.5 实宽 78.3，最后两字切在盒外。

### 16.4 验收

- 单测：全仓 **667 文件 / 7092 通过（1 skipped）**；猫娘相关 12 个文件 **208 条**绿：
  companion 69 / art 39 / renderer 22 / girl-anim 16 / girl-sprite 15 / girl-fx 12 /
  girl-presence 9 / girl-zones 8 / girl-toy 6 / girl-bond 4 / girl-tease 4 / girl-face-meta 4。
- 真窗：`scripts/verify/pet-girl-cdp.mjs` **50/50 `all clear`**（girl/standard，zoom=1）：
  - 球：踢前 `x=67 rest` → 踢后 `x=18.27 vx=138.42 trail=7`，最终落 `x=57.86 y=83.2`
    在界内；手势 `hop`，台词从 `GIRL_TOY_LINES` 抽一句（终跑「滚回来呀」）。
  - 连击：`patCombo=3`，档位 `reliant/依赖`，`bondUpLeft=1614.8`，记号层 `above=54 / below=6`。
  - 状态卡四行实测宽 47.29 / 38.29 / 38.29 / 58.06 px（内宽 78，全部放得下）。
  - 晨间：`activity=stretch`、`days=2`、气泡「早呀，\n今天也要一起\n第 2 天」，
    三行实测 27 / 54 / 27.03 px。
  - 受惊：睡→`idle`，剩余 1413.9ms，台词从 `GIRL_WAKE_LINES` 抽一句（终跑「刚才只是闭目养神」）。
  - 扑：计数 0→1，位置 x 919→905，台词从 `GIRL_POUNCE_LINES` 抽一句（终跑「嘿！」），
    `teasePending` 归 0。
  - 静息：`rest` + `sit`，坐垫 `cushion=1.00`；深夜提醒从 `GIRL_NIGHT_LINES` 抽一句
    （终跑「再陪你十分钟，然后去睡」）。
- 门：`check:brand` / `check:main` / `check:preload` / `check:renderer` / `check:sprites` /
  `check:roster` / `palette:check` / `palette:migrate:check` 全绿；
  `build:main`（773 文件）/ `build:preload` / `build:cli`（v1.8.1）/ `build:renderer` 全绿。
- 截图与报告：`D:/cyrene-p5-accept/shots-v1.8-9/`（13 张 + `pet-girl-report.json`）。
- 未覆盖：坐垫只有淡入终态（1.00）与截图目检，没有量 180ms 曲线；自动扒球 12–26s 的
  实际等待没有在真窗里等满，由单测锁；扑的 18s 冷却没有等满（单测锁）；夜里 45 分钟
  去重只验了「首次会说」，没有等到第二次窗口。截图是 82×108 基址下的静态帧，
  慢速弹道与拖尾的运动观感由 6× 放大图目检补充。

### 16.5 v1.8.1 收口：换行禁则

- 触发：v1.8.0 打 tag 后、CI 构建期间目检截图，发现问候句仍被劈成「早呀，今天也要一 / 起」——
  预断只解决了「第 N 天」，问候句第一行本身 81px 仍超 78px；继续扫连击截图又见
  「今天也想多黏你— / 会儿」。CI run 40199751553 被主动取消，未发 Release。
- 修复：四段问候按标点预断为两行；`wrapBubbleText` 加两条中文禁则——收尾标点不落行首
  （把上一字一起带下去），末行 1–2 字时从上一行匀（标点连同前一个字一起搬）。
  探针新增 `morning.lines` / `morning.fits`，检查从 48 条涨到 50 条。
- 验收：猫娘 12 文件 **208 条**；真窗 **50/50**；晨间三行 27 / 54 / 27.03px；
  连击气泡「今天也想多黏你 / 一会儿」不再是孤字。
- 截图与报告：`D:/cyrene-p5-accept/shots-v1.8-9/`。
- 版本说明：v1.8.0 的 commit `a5c97400` 与 tag 保留，但 Release 从 v1.8.1 出。
- 发布：commit `0b6a7168` + tag `v1.8.1` 只推 fork；CI run
  [40200850130](https://github.com/damingslu-ctrl/Cyrene-Agent/actions/runs/40200850130) 成功；
  Release [v1.8.1](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.8.1)（Latest），
  `Mochi-Setup-1.8.1.exe` 296,261,011 B，
  sha256 `78ed910dcd60bb26935fdeae72f81393cac448b0d02c8d1a4e1ee10767647f6c`（与 CI 下载件逐字节一致）。

## 17. 猫娘专项 III（v1.9.0）：可见的小世界

这一轮不新增状态机，只把「她有自己的生活」落成看得见的东西：身上戴的、身边飞的、
嘴里吃的、睡时盖的、隔天记着的，以及她能自己走过去的那几步。

### 17.1 能力清单

| # | 能力 | 用户可见行为 |
|---|------|--------------|
| 1 | 装扮系统 | 铃铛项圈 / 蝴蝶结 / 小围巾 / 耳边小花 / 星星发夹，右键「给她打扮」换装或「不戴」；换装都有回执；选择跨重启保留 |
| 2 | 伴飞小虫 | 白天蝴蝶、入夜流萤，绕脸飞 12s；点得中，捉住后 +0.02 亲密度、跳一下、520ms 闪光后消失 |
| 3 | 喂食道具 | 「喂小鱼干」时脚边落下一尾双色鱼，620ms 下落、捧住摇尾，2.6s 收场；数值仍走原引擎 |
| 4 | 纪念日 | 第 7/30/100/365 天头顶落 10 枚彩带、说当天专属台词；同一天跨重启只庆祝一次 |
| 5 | 久别重逢 | 隔 3 小时以上再见面，先问一句重逢的话（优先于普通问候） |
| 6 | 星期语料 | 周一/周五/周末各有一半概率说当天的话，深夜永远先劝睡 |
| 7 | 睡毯 | 真睡着且不在免打扰时，身上盖一条玫瑰小毯（奶油包边 + 两道缝线），醒来收走 |
| 8 | 陪她散步 | 右键「陪她散散步」：水平走 60–160px，贴边自己掉头，物理/落盘仍归引擎 |

### 17.2 引擎契约

- **装扮**：`AccessoryId = none|bell|bow|scarf|flower|star`，与主进程菜单共用
  `src/shared/pet-accessory.ts` 词表；`setAccessory` 只认猫娘形态，坏值回 `none`，
  同一件再点返回 false 且不出声。换装写 `BOND_KEY` 的 `accessory`，并给
  `happyUntil +1.8s`、`idleUntil` 续命、按件抽一句回执（优先级 1）。
- **捉虫**：`catchCritter` 只认猫娘、且 `activity` 不是 `sleep/drag/thrown`——叫醒她的
  方式仍然只有摸或戳。成功时 `rewardAffinity(0.02)`、`hop`、`happyUntil +2.4s`、
  说一句捉虫台词；拒绝时返回 false，点击继续落回三区判定。
- **纪念日**：`milestoneFor` 只认 7/30/100/365；`takeMilestone` 在 `quiet` 期间不点火
  也不记账（醒来还能补），点火后 `milestoneUntil = now + 5200`、`milestoneDays` 进快照，
  `celebrated` 写 `day:N` 并立即落盘。纪念日台词占优先级 2，优先于重逢/普通问候。
- **重逢**：`REUNION_GAP_MS = 3h`；判定在写回 `lastSeenAt` **之前**读，否则每次都成
  「刚见过」。`save()` 也刷新 `lastSeenAt`——关窗落位算见过，整场陪跑的时长不能丢。
- **问候顺序**：纪念日 → 重逢 → 当天首次「第 N 天」 → 时段问候。只有 `say` 真的
  说出口才写 `greetedKey`；被更高优先级顶掉时留到下一次补。`greetedKey` 落盘，
  同一天重开不再重复「第 N 天」。
- **星期语料**：`chatterPoolFor(hour, weekday, roll)`；`night` 永远返回夜间池，
  其余抽签 `< 0.5` 时按周一/周五/周末换池，不中则原时段池。
- **睡毯**：`girl-fx.blanketOps` 只在 `mood === "sleep" && !quiet` 时出笔；
  免打扰是「陪你不吵」不是「睡着了」，两者不能画成同一件事（native #67 同一条规矩）。
- **散步**：`wanderTarget` 用 `workArea` 夹取，朝向侧先走；贴边时反向走；两边都没有
  空间（窗口与工作区同宽）返回 null，不发命令。落点距离
  `60 + 100 × random`，脚线不动。

### 17.3 渲染契约

- **装扮锚点**：五件全部取 `girlFaceBox(body, frame)` 的逐帧脸框，不按固定比例钉；
  呼吸/走路的轻摆加在锚点上（`sin(nowSec*2.1)` + 走路 `sin(nowSec*9.5)`）。
  每件先铺奶油光边再压玫瑰/强调色（双色纪律），层用 `collar` / `hair_front`；
  绘制顺序在人物帧之后、球 `above` 之前。
- **小虫**：轨道 `face.w × 1.12`（蝴蝶）/ `× 0.74`（流萤），命中半径
  `max(6, face.w × 0.42)`。自主刷新：首次 `45–85s`（刚见面就放虫太吵），
  飞走后 `30–75s`；只在 `idle/rest`、非睡、非安静时刷。菜单/命令可随时召一只。
  点击拦在毛线球与三区之前；引擎拒绝（睡着/被拖）时不吞点击，继续走三区。
- **小鱼干**：`createSnack` 从脸框上方落到手边，下落 `620ms` 三次缓出，捧住段
  `sin(18t)` 摇尾；`SNACK_MS = 2600`。只在非安静、非睡时出现。
- **彩带**：10 枚双色纸片，`milestoneLeft` 从 5200 递减到 0，越到尾端越淡；
  颜色轮换 `ACCENT/ROSE_DEEP/ROSE/WARN`，先铺奶油底再压色。层 `stars`。
- **睡毯**：以 `girlInkBox` 的 `cx/cy/bottom` 铺，宽度夹在 `[16,34]`，高至少 8；
  6 笔：奶油外圈 → 玫瑰毯面 → 奶油翻边 → 玫瑰深折痕 → 两道缝线。层 `stars`。
- **诊断**：`getPetDiagnostics().girl` 新增 `accessory`、`milestoneLeft`、
  `milestoneDays`、`critter{kind,caught,x,y}`、`snack{x,y,progress}`；
  快照同步带 `accessory/milestoneLeft/milestoneDays`。

### 17.4 验收

- 单测：全仓 **673 文件 / 7128 通过（1 skipped）**；猫娘相关 18 个文件 **242 条**绿
  （新增 6 个文件 32 条：accessory 5 / critter 6 / snack 4 / milestone 2 / wander 4 /
  companion-girl-three 11；`girl-fx` +2，原 12 文件 208 条不变）；
  菜单两文件 **19 条**绿（新增装扮子项与命令两条）。
- 真窗：`scripts/verify/pet-girl-cdp.mjs` **78/78 `all clear`**（girl/standard，zoom=1）：
  - 装扮：`accessory:bow` → 引擎 `bow`、`bond.accessory=bow`、气泡
    「蝴蝶结，系好了」；换回 `none` → 气泡「先这样也很好看」。
  - 小虫：夜间召唤得流萤；点实时坐标捉住，气泡「小家伙，对不起啦」，
    亲密度 `0.700 → 0.720`，闪光结束后诊断归 null。
  - 小鱼干：出现进度 `0.088 → 0.371`，2.6s 内自行收场。
  - 睡毯：下半身玫瑰像素 `36 → 860`；醒来掉到 `121`（毯子贡献 739 像素消失）。
  - 散步：`x 1302 → 1323.27`，最终位移 `103px`，落在 60–160 设计窗内。
  - 纪念日：`days=7`、气泡「我们认识第 7 天啦」、`left≈4903ms`、彩带 `above=20`。
  - 重逢：气泡「你回来了…我等好久」、`days=1`。
- 门：`check:brand` / `check:main` / `check:preload` / `check:renderer` /
  `check:sprites` / `check:roster` / `palette:check` / `palette:migrate:check` 全绿；
  `build:main`（774 文件）/ `build:preload` / `build:renderer`（6.07s）全绿。
- 截图与报告：`D:/cyrene-p5-accept/shots-girl-v190/`（19 张 + `pet-girl-report.json`）。
- 未覆盖：五件装扮只有蝴蝶结在真窗里戴过，其余四件由单测锁锚点/笔数；小虫的
  `45–85s` 自主首刷与 `30–75s` 复刷没有在真窗等满，也没有单测锁（只验了手动召唤
  路径与常量本身）；白天蝴蝶只由 `critterKindFor` 单测锁，真窗抓到的是夜间流萤；
  小鱼干只验了进度与收场，没有逐帧量 620ms 下落曲线；睡毯只验「在/不在」的像素
  量级，不比对具体待机帧；纪念日只真窗验了第 7 天，30/100/365 与跨重启去重由单测锁；
  重逢只验第一次。截图里她头顶的绿色对勾是四足/猫娘共用的「开心」徽章
  （`mood === "happy"`），不是环境的勾选浮层，也不是本轮新增。

### 17.5 本轮裁决

- **问候必须等形态落档**：renderer 出生时是四足，profile 是异步来的；抢跑会用猫的
  台词开口，并把纪念日/重逢整条分支吃掉。`main.ts` 等到 `quietReady && profileReady`
  再 `greet`，且 `greetedKey` 只在真说出口时写。
- **睡毯尺按「毯子贡献」判，不按「回到基线」判**：采样窗从大腿到脚，皮肤本身就在
  玫瑰色段里，不同待机帧露出的腿/手数量不同（实测醒着基线 36–131），拿「基线 +80」
  会把正常帧判红。毯子 660+ 像素，醒来掉 739 像素才是「收走了」的证据。
- **捉虫台词不写虫种**：夜里是流萤，说「小蝴蝶」会穿帮；改「小家伙」两种都叫得出口。
- **空帧不是产品帧**：气泡开合换窗宽时画布会先清成透明，真跑抓到过 315B 的纯空图；
  `shot()` 对 <1200B 的 PNG 重截，`rosePixels` 对 0 值重取，另把「基线非零」本身
  变成 `blanket.baseline` 一条检查。
- **首只小虫延迟 45–85s**：见面就放虫会抢开机问候的注意力，也会让她刚出现就被
  点虫打断；首刷比复刷更克制，是刻意的。

### 17.6 v1.9.0 发布证据（2026-10-26）

- commit `2615d165`（feat(pet): 猫娘会打扮、捉流萤、盖毯子，记纪念日与久别），
  tag `v1.9.0`（annotated，peel 到同一 commit）只推 fork；
  fork master 与本地同点，上游未动。
- CI：手动 dispatch run `40209095085`，Windows 安装包产物下载后本地
  `sha256sum` 为 `0692e801d9cc5045268c81059a876c64f4e3911fa158efd68ec1af9983abb9b2`。
- Release [v1.9.0](https://github.com/damingslu-ctrl/Cyrene-Agent/releases/tag/v1.9.0)：
  标题「Mochi v1.9.0 — 猫娘会打扮、捉流萤、盖毯子」，`isDraft:false`、
  `isPrerelease:false`、Latest；资产 `Mochi-Setup-1.9.0.exe` **296,267,356 B**，
  GitHub 记录的 digest 与本地 sha256 一致，上传完成于 `2026-10-25T16:22:33Z`。
- 插曲：首次 `gh release upload` 报 404（Release 当时并未真正建立）；核对 tag/
  commit/产物后改用 `gh release create` 一次性带资产重建，随后用 API 复核
  草稿态、资产大小与 digest。tag 与 commit 未改动。

## 18. v1.10.0：玩具箱、跟随、爪印、梦话云与五枚成就（2026-10-26）

### 18.1 目标与清单

前几轮把猫娘做成了「会待着、会回应」的伴；这一轮补的是**可主动发起的玩法**——
用户点一下菜单，窗里立刻有一场完整的演出或一局可交互的小游戏，并且每一场都能被
真窗探针用同源读数验完。

| # | 能力 | 入口 | 寿命 / 判定 | 玩法 |
|---|---|---|---|---|
| 1 | 逗猫棒 | 右键「挥挥逗猫棒」 | `WAND_MS 7000`，捉中再亮 `WAND_CATCH_MS 520` | 羽毛绕脸摆；点中尖端 → 捉住、+0.015、成就 |
| 2 | 泡泡 | 右键「吹一串泡泡」 | `BUBBLES_MS 5600`，`BUBBLE_COUNT 6`，破 `320ms` | 六颗可逐颗戳破；每 4 下说一句 |
| 3 | 落叶 | 右键「撒一把落叶」 | `LEAVES_MS 5600`，`LEAF_COUNT 7` | 纯观众型：双色叶打旋落下，不接点击 |
| 4 | 猜拳 | 右键「猜拳」→ 石头/剪刀/布 | `RPS_MS 3600` | 她随机出一手，头顶大手牌 + 脚边玩家小牌 |
| 5 | 跟我来 | 右键「跟我来」 | `FOLLOW_MS 12000`，限幅 `160px`，到位 `14px`，步进 `42px` | 跟光标横向走；点她/睡着/被拖/agent 忙即收工 |
| 6 | 爪印 | 走路自动 | `PRINT_MS 3200`，间隔 `260ms`，上限 10 | 屏幕坐标的双色小爪印，不跟窗搬 |
| 7 | 梦话云 | 睡熟自动 | `DREAM_DELAY_MS 1800` | 奶油云 + 玫瑰小鱼 + 两个梦泡泡；醒来即收 |
| 8 | 五枚成就 | 互动自动 | `ACHIEVEMENT_MS 3600`，台词 TTL 6s | first-catch / first-wand / bubble-lover / seven-days / heart-bond |
| 9 | 菜单与命令 | 右键 + `PET_COMMANDS` | 5 个猫娘专属项（猜拳带子菜单） | 四足形态一律置灰 / 静默忽略 |
| 10 | 诊断口 | `getGirlDiagnostics().girl` | 10 组新读数 | 探针与产品读同一份状态 |

### 18.2 契约

- **一把脸尺**：所有头顶/身边道具都走 `girlFaceAt(now)`（`girlFaceBox(girlAnimBodyFor(cat), frame)`）。
  立绘每一帧的脸都在动，另起一套比例锚一定会在某些帧飘到空气里。
- **四条时间线没有模拟物理**：逗猫棒、泡泡、落叶、猜拳的坐标全由「出生时刻 + 种子」解析，
  点中只记一个 `caughtAt/poppedAt`。同一拍里渲染、诊断、探针看到的是同一个落点；
  窗口搬动也不会把道具留在旧屏幕坐标。只有毛线球保留上一轮的 8ms 子步物理。
- **点击路由**：猫三区 → 头顶道具（逗猫棒尖端半径 `max(6, face.w*0.34)`；泡泡取最近一颗，
  半径 +3 容差）→ 脚下毛线球。玩具只在「她是猫娘 + 不在安静期 + 没被拖 + 没睡」时生成；
  拒绝不吞点击，三区照常工作。
- **跟随只走横轴**：目标 = 光标窗内横位相对窗心偏移，夹到 ±160px，再夹到工作区；
  与上一次下发目标差 ≥42px 才重发 `roamTo`，否则每帧归零会把她的速度钉死。
  14px 内算到位。跟随期间**允许气泡开着迈步**（这是唯一绕过 `canRoam` 气泡闸的路径）；
  到时、安静、睡着、被拖、agent 忙、用户点她，都会立即收工并给一句回执。
- **爪印记屏幕坐标**：`screenX = 窗口原点 + 窗内 x * zoom`，绘制时按当前原点差换算回窗内。
  桌布上的脚印不跟着窗户走；走远了自然滑出画面，不需要额外裁剪。
- **梦话云三重闸**：`mood === "sleep"`、`sleepSince >= 0`、睡熟 ≥1.8s，且 `!quiet`。
  免打扰是「陪你不吵」，不是「她睡下了」——安静期画梦会替用户宣布一个没发生的事。
- **成就只从既有计数器来**：摸头 / 捉虫 / 逗猫棒 / 戳泡 / 扑击 / 天数 / 羁绊档位；
  不新增成长线。一次互动最多弹一枚（多条件同时满足的余下等下一次），安静期不弹也不记账。
  首次解锁台词用优先级 2 压住普通玩具台词（优先级 1）；若升档台词正在说
  （`now < bondUpUntil`），徽章照弹但句子让给「心意相通」。
- **问候让路**：`greet()` 里 `refreshAchievements(now, !said)`——纪念日 / 重逢 / 第 N 天
  已经占着气泡时，成就只弹徽章不出声，避免把那一句顶掉。
- **持久化**：`stats` 与 `achievements` 写进 `cyrene.pet.bond.v1`，与 metAt/celebrated 同一份存档；
  坏值一律归零/丢弃，坏档不阻塞启动。解锁当场落盘，不等关窗。
- **菜单即命令**：`wand` / `bubbles` / `leaves` / `follow` / `rps:rock|scissors|paper`，
  全部进 `PET_COMMANDS` 词表；四足收到静默忽略。猜拳子菜单的标签也来自
  `RPS_LABELS` 共享词表，不在菜单里另抄一份。
- **诊断同拍**：泡泡的 `spots` 与 `live/left` 在同一次 `getGirlDiagnostics()` 里算出，
  探针不必猜「下一帧泡泡在哪」；这正是「每帧在飘的静物」能被真窗点的前提。

### 18.3 验收

- 单测：全仓 **684 文件 / 7185 通过（1 skipped）**，无红（v1.9 基线 673 / 7128，+11 文件 +57 条）。
  新增 11 个文件 **55 条**：wand 6 / bubbles 5 / leaves 3 / follow 3 / prints 4 /
  achievements 6 / dream 3 / rps 4 / pet-rps 2 / companion-girl-toys 11 / renderer-girl-toys 8；
  改动过的 15 个相关文件合计 **91 条**绿（含 pet-menu 10 + attach 9 + commands 6 + three 11）。
- 真窗：`scripts/verify/pet-girl-cdp.mjs` **110/110 `all clear`**（girl/standard，zoom=1）：
  - 逗猫棒：`left 6790ms` 时 `caught=false` → 同一拍点中 → `stats.wand=1`、
    徽章 `first-wand`、气泡「羽毛…还想再玩一次」、存档同步；7s 后诊断归 null。
  - 泡泡：`live 6` → 点破一颗 → `live 5`、`stats.bubbles=1`、气泡「再吹一串嘛」；
    5.6s 后归 null。点的是诊断同拍给出的 `spots[0]`。
  - 落叶：`left 5392ms`、气泡「哇…下叶子雨了」，5.6s 后归 null。
  - 猜拳：玩家石头 vs 她随机一手，`outcome` 与探针本地判定一致；本轮真跑抽到
    「输了」→ 气泡「再来一局嘛」。
  - 跟随：气泡「我跟着你哦」、`left 11793ms`；把注视目标放到头右 120px 后
    `x 804 → 853.5`（+49.5px），点她后 `follow=null`。
  - 爪印：走路 600ms 后 `prints=4`；3.2s 寿命后归 0。
  - 梦话云：睡下后 `sleepSince=122289`、`activity=sleep`；醒来 `sleepSince=-1`。
  - 成就串：捉虫首次解锁 `first-catch` 且气泡被成就句「捉到啦！这个要记下来」压过普通捉虫句；
    亲密度 `0.700 → 0.720`；逗猫棒再解锁 `first-wand`；第 7 天开机补解锁 `seven-days`；
    重逢读档后三枚都还在。
  - 纪念日 / 重逢 / 视觉基线等 v1.9 检查全部保持绿（同一条 110 条清单）。
- 门：`check:brand` / `check:main` / `check:preload` / `check:renderer` / `check:sprites` /
  `check:roster` / `palette:check` / `palette:migrate:check` / `check:plugin-schema` /
  `check:adapted-models` 全绿；`build:main`（776 文件）/ `build:preload`（144 + learn-exam）/
  `build:renderer`（6.84s）/ `build:cli`（v1.10.0）全绿。色板棘轮仍是 **22 行 / 上限 22**
  （本轮把 RPS 玩家牌的三个字面量收回 `girl-rps.ts` 的 token 之后通过，未抬上限）。
- 截图与报告：`D:/cyrene-p5-accept/shots-girl-v110/`（27 张 + `pet-girl-report.json`）。
- 未覆盖：逗猫棒只验点中路径，没验 7s 空挥的 miss 台词（单测锁 `wandEnd(false)`）；
  泡泡只点破一颗，没验连破 12 颗的成就触发（单测锁 `newlyUnlocked` 与 `%4` 说话节拍）；
  落叶只验寿命与首句，没逐帧量七片的旋落曲线；猜拳胜负/平三组台词里真窗只抽到一组，
  三组由单测锁；跟随只验一次窗口内移动与点她收工，没验 12s 到时/跨工作区夹取；
  爪印只数了枚数，没比对屏幕坐标在搬窗后的滑出；梦话云的云/鱼具体笔数与 1.8s 前不出现
  由单测锁；成就里 `bubble-lover`（12 颗）与 `heart-bond`（心意相通）真窗没触发，
  只由单测锁条件与去重。

### 18.4 本轮裁决

- **成就句压过玩具句是有意的**：首次解锁只有一次，玩具天天能玩；探针第一版把
  「泡破台词被 `first-wand` 压住」判成产品红，核对 `say()` 优先级后改探针：
  先让用户语义上的「点掉这句」发生，再验泡泡自己的台词。产品未改。
- **跟随必须能边说边走了**：`canRoam()` 的气泡闸是为漫游设的（说站着说），但「跟我来」
  的句子就是「我跟着你哦」——一边说一边走才是这句话的意思；因此只在
  `follow !== null` 时放行，其他气泡仍按原闸。
- **爪印用屏幕坐标，不是窗内坐标**：窗内坐标会在搬窗时把一串脚印一起拖走，
  像贴纸不像足迹；换算成本极低（一次减法），值得。
- **玩具不碰睡眠/拖拽/抛掷/眩晕**：叫醒她只能靠摸或戳；玩具是邀请，不是替用户动手。
  但**拒绝点击不能吞事件**——睡着时点玩具应当落到三区，否则「点头叫醒」会失真。
- **泡泡每 4 下才说一句**：泡泡是连续动作，颗颗都配台词会把气泡变成弹幕；
  第 1、5、9 颗说，既保留反馈又不刷屏。
- **猜拳输了不扣分**：这是陪伴游戏，不是排位；赢 +0.012、平 +0.005、输只给不服气的台词，
  保证「多玩」永远正向。
- **一条时间线自己收场，不新增调度器**：四个玩具各自有 `alive()` 与 `left` 读数，
  到寿命在 `tick*` 里归 null；没有新定时器、没有全局「当前玩具」状态机，
  所以任何两个玩具互斥靠生成时清空对方，逻辑只在一处。
- **静息不说话也不记账**：安静期成就不弹、不写、不占存档；醒来后的第一次互动会补上
  （`newlyUnlocked` 只比较存档与当前条件，本身无时间戳）。
