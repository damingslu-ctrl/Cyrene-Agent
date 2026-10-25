# 更新日志

Cyrene-Agent 的版本变更记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
提交信息遵循 `type(scope): 描述`，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

> 本文件由 `pnpm run release` 生成，请勿手工编辑；需要调整措辞请改写对应的提交信息。

## [1.12.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.11.0...v1.12.0) (2026-10-26)

### 新增

* **桌宠:** 磨磨爪子。一块瓦楞纸板从脚边升起来，她按着板面磨 5.2 秒，爪痕按时间表一道道叠上去；
  点板面能再帮她按一下（420ms 冷却、最多补三道、整块板最多八道痕），整轮走完才记一次「磨爪」。
* **桌宠:** 滚个铃铛球。带铃铛的小球在脚边来回滚 5.6 秒；点球就摇响一声、球弹一下，
  360ms 内连点只响不重复计数，一轮最多记五声；到点自己滚走。
* **桌宠:** 放只发条鼠。上着发条的小老鼠在脚边窜 6.4 秒；点中＝按住它的背，拎起来 800ms 再收走，
  抓住才记一次；没抓住就等它跑掉，她自嘲一句，不产出数值。
* **桌宠:** 来局打地鼠。脚边三个洞，地鼠按固定时刻表轮流冒头、每次只露 720ms；拍中冒头的那只记一次，
  同一只不能拍两次；6 秒后洞收走，收尾说「手都拍热了」。
* **桌宠:** 抱一下。她张开手抱住你，胸口浮出一颗大爱心，演 3.6 秒；一开场就记一次抱抱并起呼噜，
  点她能再抱紧一点（450ms 冷却、最多叠五颗心），不重复计数。
* **桌宠:** 呼噜声纹。连着摸头（第二下起）或抱抱时，胸口浮出三圈声纹，4 秒才散；同一串互动只记一次
  「呼噜」，隔开再摸才算下一串——三串解锁「呼噜发动机」。
* **桌宠:** 今日小目标。每天三件小事：摸摸头 5 下 / 陪它玩 2 次 / 喂小鱼干 1 条；做完一件当场记一笔、
  涨一点亲密度，全清换一句更得意的；跨天自动清零，历史笔数收进猫咪日记。
* **桌宠:** 猫咪日记。跨天时把前一天的摸摸/陪玩/喂食写成一行，最多留最近七条；
  气泡里只排四行（标题 + 今天 + 最近两条），没笔数的日子不写空白条目。
* **桌宠:** 下场小雨。窗外下 20 秒小雨，26 颗雨滴按序号哈希斜落、脚边溅起水花；它是氛围层，
  不占玩具槽——雨里照样能滚铃铛球、抱一下，雨一直在。
* **桌宠:** 八项新计数与八枚新成就：抓板 3 轮（抓板艺术家）/ 摇铃 3 声（铃铛收藏家）/
  抓鼠 2 只（发条猎手）/ 拍地鼠 5 下（打地鼠高手）/ 抱抱 3 次（抱抱成瘾）/
  呼噜 3 串（呼噜发动机）/ 听雨 2 场（听雨的人）/ 做完 3 件每日小事（今日全勤）；
  成就页 18 枚，条件仍只来自计数器，解锁当场弹徽章并跨重启只记一次。
* **桌宠:** 成长记录改三行：「心意相通 · 第 1 天」「徽章 n/18」「互动 N 次」；徽章分母直接读
  `ACHIEVEMENT_IDS`，互动数仍是十八项计数之和，报表与存档同一本账。
* **桌宠:** 右键菜单加八项：磨磨爪子 / 滚个铃铛球 / 放只发条鼠 / 来局打地鼠 / 抱一下 / 下场小雨 /
  今日小目标 / 猫咪日记；四足形态统一置灰，任一件独演道具开场会收掉上一件。
* **桌宠:** 调试面扩展：`getGirlDiagnostics()` 增 `scratch` / `bell` / `mouse` / `mole` / `hug` /
  `rain` / `purrLeft`，坐标、阶段与计数和点击判定同一拍。

### 修复

* **桌宠:** 她正说着话时点「散步」，气泡占着 `canRoam`，引擎下一帧就把 `walk` 掰回 `idle`，
  菜单像没反应（v1.12 真窗探针抓到）：散步是用户明确下的令，现在先收掉气泡再迈步。

## [1.11.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.10.0...v1.11.0) (2026-10-26)

### 新增

* **桌宠:** 纸箱躲猫猫。一只奶油纸箱落在脚边，她钻进去、箱沿盖过发顶；三次探头各开
  一个短窗口，点箱面会晃两下并说「谁呀？」，点中探出来的脑袋就算抓住——箱子当场
  翻倒、她跳出来。一轮 6.6 秒，抓住才记一次；开场 / 敲门 / 被抓住各有一组台词。
* **桌宠:** 照个红点点。一颗红点按李萨如曲线在她脸周围游走 8 秒，视线跟着红点走；
  点中就算扑到，红点冻在原地炸一圈，700ms 后收起；空手一局到点自嘲一句。
* **桌宠:** 给她梳梳毛。小梳子沿发顶到后背来回刷 6 秒、正好四趟，每 1.25 秒一道；
  点梳子能再加一下「顺毛」，每下冒星与心，最多叠三下。整轮走完才记一次。
* **桌宠:** 闻闻猫薄荷。脚边冒出一小枝薄荷：先低头闻 1.6 秒，再滚作一团 3 秒，
  最后慢慢坐回来；戳薄荷枝会再喷一蓬叶子（只涨一点点亲密度，不计数），整轮结束记一次。
* **桌宠:** 放架纸飞机。奶油纸飞机从窗的一侧滑到另一侧（5.6 秒），点中就算接住，
  它打着旋落到脚边；没接住也有两句自嘲。飞行轨迹只由出生时刻解析，帧率不影响落点。
* **桌宠:** 请小鸟来做客。小鸟飞进来，在她头顶右上方的窗框上点头甩尾；落脚后点它
  就会受惊飞走、飘下两根羽毛。它只是来看她一眼：不涨数值、不计数，只留一句台词。
* **桌宠:** 成长记录。右键「成长记录」用两行说她现在的状态：第一行「羁绊档 · 第 N 天」，
  第二行「徽章 n/10 · 互动 N 次」；互动数是十项计数之和，和徽章、天数同一份存档。
* **桌宠:** 五枚新成就：箱中藏身（躲猫猫抓住 2 次）、光点猎手（扑到红点 3 次）、
  顺毛行家（梳完 10 轮）、薄荷上头（吸完 2 轮）、接机达人（接住纸飞机 2 次）。
  条件仍只来自既有计数器，解锁当场弹徽章并说专属台词，跨重启只解锁一次。
* **桌宠:** 右键菜单加七项：纸箱躲猫猫 / 照个红点点 / 给她梳梳毛 / 闻闻猫薄荷 /
  放架纸飞机 / 请小鸟来做客 / 成长记录；四足形态统一置灰。任何一件道具开场都会
  收掉上一件，不会两套演出抢同一张画。
* **桌宠:** 调试面扩展：`getGirlDiagnostics()` 增 `box` / `laser` / `brush` / `catnip` /
  `plane` / `bird`，坐标、阶段与计数和点击判定同一拍；快照继续带 `stats`。

### 修复

* **桌宠:** 纸箱盖住脚边毛线球时，点箱面会被球偷走（v1.11 真窗探针 O1 抓到）：
  新道具画在球之上，命中顺序却没跟上，球先截走了这一下。现在新道具整组排在
  小虫与毛线球之前，点箱面一定算敲门，也补了一条单测锁住这个次序。

## [1.10.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.9.0...v1.10.0) (2026-10-26)

### 新增

* **桌宠:** 逗猫棒。右键「挥挥逗猫棒」，一根羽毛从窗顶垂下来，绕着她的脸摆 7 秒；
  羽毛尖端带奶油光边，点中就捉住——她开心跳一下、涨一点亲密度，说一句「抓到了！」。
  空挥 7 秒也有一句自嘲。落点全部由出生时刻与种子解析，窗口搬动不会把羽毛留在旧坐标。
* **桌宠:** 吹泡泡。六颗泡泡从脚边升起，边升边轻轻横摆，5.6 秒自己散掉；每一颗都能戳破，
  破时「啵」地一响并溅一圈小水花，其余同伴继续飞。每戳四下她说一句，戳满 12 颗解锁成就。
* **桌宠:** 撒落叶。七片双色叶子从头顶打着旋儿落到脚边，深浅交替、各带一点延迟，
  不接点击——她抬手一扬，剩下的交给风；播完自己收场。
* **桌宠:** 猜拳。右键「猜拳」三个子菜单（石头 / 剪刀 / 布），她随机出一手，头顶举起
  一枚 3.6 秒的大手牌，按胜负说三组不同的台词：赢了涨一点亲密度、平局一点点、输了只不服气。
* **桌宠:** 「跟我来」。12 秒内她跟着光标的横向位置走：最多离出发点 160px、不出工作区，
  差 14px 就算到位；目标挪 42px 以上才重发漫游，不会把自己钉在原地。
  说着「我跟着你哦」也照样迈步，跟到位或跟丢各有一句回执；睡着、被拖、点她都会收工。
* **桌宠:** 爪印。她走路时每 260ms 在脚下留一枚双色小爪印，3.2 秒淡掉；爪印记的是
  屏幕坐标，窗户搬走时脚印留在桌布上，走远了自然滑出画面。
* **桌宠:** 梦话云。她真的睡熟 1.8 秒后，头顶浮出一朵奶油云，云里一条玫瑰色小鱼
  来回游，旁边冒两个越来越高的梦泡泡；醒来即收。免打扰时不出——那半小时是陪你不吵，
  不是她睡下了。
* **桌宠:** 五枚成就：第一次抓住光、逗猫棒初体验、泡泡终结者（戳满 12 颗）、七日之约、
  心意相通。条件全部来自既有计数器，解锁当场头顶弹一枚 3.6 秒徽章并说一句专属台词；
  徽章与计数写进羁绊存档，跨重启保留，同一条只解锁一次。首次解锁的台词优先级高于
  普通玩具台词——这一句值得压住别的。
* **桌宠:** 调试面扩展：`getGirlDiagnostics()` 增 `wand` / `bubbles{live,left,spots}` /
  `leaves` / `rps` / `prints` / `follow` / `achievements` / `achievement` / `stats` /
  `sleepSince`；快照同步带 `achievements` / `achievementLeft` / `achievementId` / `stats`。
  泡泡的 `spots` 与诊断同一拍，真窗探针点哪颗、验哪颗都是同一份坐标。

## [1.9.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.8.1...v1.9.0) (2026-10-25)

### 新增

* **桌宠:** 猫娘可以打扮了：铃铛项圈、蝴蝶结、小围巾、耳边小花、星星发夹五件饰品。每一件
  都按**逐帧脸框**锚定，转身、侧移、走路的摇摆都跟着走，不会飘到空气里；右键「给她打扮」
  随时换装或摘下。选择写进羁绊存档，下次开机还戴着，换装都有自己的回执台词。
* **桌宠:** 白天有一只蝴蝶、入夜换成流萤，绕着她的脸飞一小会儿，不占任何 HUD。
  点它就能捉住：涨一点亲密度、开心跳一下、说一句捉虫的话，亮半秒后消失；
  睡着或被拖着的时候捉不到——叫醒她只能靠摸或戳。
* **桌宠:** 喂小鱼干时脚边真的会落下一尾鱼：带奶油光边的双色鱼形，摇尾、亮眼睛，
  2.6 秒后收场。喂食的数值与台词仍走原来的引擎入口，道具只是把「喂」画出来。
* **桌宠:** 相识第 7 / 30 / 100 / 365 天会有一场彩带庆典：头顶落下双色纸屑，同时说出
  那一天的专属台词；同一天只庆祝一次，跨重启记在羁绊存档里。久别 3 小时以上再见面，
  会先说一句重逢的话。
* **桌宠:** 睡下时身上多一张玫瑰色小盖毯（奶油包边、两道折痕），醒来收起；
  静息时的坐垫与睡毯互不抢位。
* **桌宠:** 自主碎碎念接上星期语料：周一、周五、周末各有一半概率说当天的话，
  深夜永远先劝睡——日历是陪伴的线索，不是准点播报机。
* **桌宠:** 右键新增「陪她散散步」：水平走 60–160px，贴边会自己掉头；
  走路仍由引擎统一接管物理与落盘，和自主漫游同一条链。

### 修复

* **桌宠:** 开机问候不再抢在形态落档之前开口。渲染进程出生时还是默认的四足猫，
  问候会走四足台词，并且把「第 N 天」、纪念日彩带和久别重逢整条分支一起吃掉；
  现在等 profile 到位后再 greet，猫娘一定用自己的台词开口。问候被更高优先级的
  提醒顶掉时也不再记成「今天已露脸」，「第 N 天」会留到下一次补上。

## [1.8.1](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.8.0...v1.8.1) (2026-10-25)

### 修复

* **桌宠:** 问候句在 78px 内宽里被贪心折行劈出孤字（「早呀，今天也要一 / 起」）。四段问候
  现在按标点各自预断成两行，第 2 天起再接「第 N 天」独占的一行；新增单测锁住每一行都
  放得进 78px，避免以后改文案又劈字。
* **桌宠:** 长句换行补上中文禁则：收尾标点不再落在行首；末行只剩 1–2 个字时从上一行匀
  过来（「今天也想多黏你— / 会儿」→「今天也想多黏 / 你—会儿」）。

## [1.8.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.7.0...v1.8.0) (2026-10-25)

### 新增

* **桌宠:** 猫娘脚边多了一颗毛线球。她闲下来会自己伸爪扒拉（球滚、带毛线拖尾、撞墙回弹、
  落地弹跳后自己躺平），点球则是用力踢出去并说一句「看我的—— / 接住！」；球在绘制空间里
  走固定 8ms 子步的物理，窗户怎么搬都不影响弹道。手动踢球会微弱加亲密度。
* **桌宠:** 猫娘坐下时身下会浮起一张粉色坐垫（180ms 淡入），起身再淡出；坐垫与地面投影
  同属 `below` 层，不挡猫身，也不改窗口尺寸。
* **桌宠:** 亲密度有了五档羁绊：初识 / 熟悉 / 亲近 / 依赖 / 心意相通。跨档时头顶炸开一圈
  爱心与升级记号，并说一句只在该档出现的台词；状态对话同时报出档位与「相识第 N 天」，
  天数按本地日历日累计、跨重启保留。
* **桌宠:** 摸头连击：3.2s 内连续摸头累计 1–5 连，每连有递进的台词，第五连亲密度多给
  0.02；连击窗口过期自动归零。
* **桌宠:** 睡着时被摸会惊醒：她先缩一下、说「唔…我没有睡着！」，1.6s 内保持受惊姿态；
  深夜被摸则换成「这么晚还来摸我…」这一组。
* **桌宠:** 作息节律。每天早上第一次露面先伸个懒腰（5–11 点、每个日历日一次、跨重启
  去重），问候句把「第 N 天」单独放一行；23 点后到凌晨 5 点，每 30s 询问一次是否该提醒，
  同一晚最多提醒一次（间隔 45 分钟），睡着 / 被拖着 / 刚被扔出去 / 免打扰时都不吵。
* **桌宠:** 逗光标会挨扑。在她身边 900ms 内快速甩两下（单次 ≥26px），她会短促扑过去、
  位置真的挪 9–26px 并说「抓到你啦！ / 别跑——」；18s 冷却，太近（<6px）不扑、睡觉与
  眩晕时不扑。
* **桌宠:** 状态对话改成四行小卡片（亲密度 / 饱腹 / 精力 / 羁绊·天数），每行都按真
  Chromium 的 9px 字宽量过，全落在气泡 78px 内宽里。
* **桌宠:** 调试面扩展：`getGirlDiagnostics()` 增 `toy` / `cushion` / `bondUpLeft` /
  `patCombo` / `startleLeft` / `pounces` / `teasePending` / `nightCheckInMs`，
  `getSnapshot()` 增 `bond` / `days` / `bondUpLeft` / `patCombo` / `startleLeft`。

### 修复

* **桌宠:** 气泡里的长句会切字。断行估算把 `·`（中文回退字体里是全角 9px）当成 5.2px，
  状态句算出 74.5 而真宽 78.3，最后两个字画到盒外。断行表改用 Chromium 实测字宽，
  `\n` 成为硬换行，`fillText` 再带 `maxWidth` 兜底——估算再偏也只能压紧字距，不能切字。
* **桌宠:** 第二天露面的问候句 `早呀，今天也要一起 · 第 2 天` 会被 78px 内宽从词中间
  劈成「…一 / 起 · 第 2 天」；现在「第 N 天」独占一行。

## [1.7.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.6.0...v1.7.0) (2026-10-25)

### 新增

* **桌宠:** 猫娘会「看你」了。光标在她附近时，整身朝光标方向压 0–4.2°、往同一侧挪 0–2.2px
  （240ms 缓动，300px 外淡出）；光标跨到另一侧要停 380ms 才真翻身、翻完锁 900ms——
  跨中线一瞬就翻会像抽搐。光标从远处进入近圈（注意力 ≥0.86）时，头顶弹出双色「！」并接一句
  「你回来啦 / 刚刚在看什么呀？」：只认边沿、冷却 12s，睡着与免打扰期间不出（闭着眼注意到你
  不成立）。
* **桌宠:** 猫娘的屏幕记号层——地面投影（3.5% 奶油底光 + 五环伪高斯，深色桌布上才不「浮空」，
  跳起来会缩小变淡）、腮红包络、注意「！」、连点晕星、开心音符、生气蒸汽、走路与落地的双色
  尘埃。所有落点来自逐帧实测的脸框/墨框（146 帧，`build-girl-face.py` 从图集量出，记进
  `girl-face-meta.ts`），不按固定比例猜脸在哪；画在桌布上的每一笔都先铺奶油光边再压深色。
* **桌宠:** 点哪里都不一样——命中框分三区（上 36% 头 / 中段身 / 下 24% 脚）。摸头是害羞
  （`shy` 片 + 捂脸 + 红脸 + 亲密度 +0.04），戳身是普通反应，挠脚是怕痒（`wink` 片 + 躲一下），
  三套台词；长按仍是摩挲。2.4s 内第 4 下把她逗晕：站定晃身、头顶三颗双色星转 3.6s、
  说一句「站、站不稳了」，6s 内再点不会重晕。
* **桌宠:** 猫娘有了自己的静息节拍——一个人待满 40s 就坐下歇 18–30s（`sit` 片），起身先伸个
  懒腰（2.2s）再站好。光标压在她窗子里算「有人陪」，秒表一直按在 0；歇完重新计时，
  不会变成「坐一会儿站一会儿」。等待期另加两个微动作：35% 概率抬眼看你（`peek`）或轻眨眼
  （`wink`），短到不打断静坐。
* **桌宠:** 猫娘的人格文案与四足分开：按时段四套闲话（早/午/晚/夜）、露面问候、摸/喂/玩各自
  一套说法，外加摸头、挠脚、晕、注意四组专用台词；四足词表原样保留。直接点的反应可以顶掉
  同级上一条（点完头立刻点脚，不会再停在「摸头」那句上），网络播报（优先级 ≥3）依旧不可抢。

### 修复

* **桌宠:** 连点不同部位时，气泡还停在上一句——`say()` 默认同级不抢，导致「点了脚像没反应」。
  新增 `replaceSame` 只作用于用户刚做的动作。
* **桌宠:** 量尺的 `zoom` 一度按 `innerWidth / 基址宽` 反推，气泡展开时窗口是 172 而基址 82，
  算出 2.09 的假值，真窗探针的点击坐标全落到命中框外（判成「点了没分区反应」）。
  `getLayoutInfo()` 现在直接报渲染器的真实缩放；调试面另加 `setGazeFrozen`，让探针不必动
  用户的真光标。

### 测试

* 新增 `girl-face-meta` / `girl-presence` / `girl-fx` / `girl-zones` 四把尺与接线锁：146 帧脸框
  全在格内且亮部占比合规、倾斜/侧移的饱和与回转、转身迟滞与锁定、注意边沿只发一次、记号层
  的双色与投影在人物之前、三区边界与连点计数（含冷却）、静息不受 `canRoam=false` 影响、
  「光标在窗内不算一个人待着」、同级顶替与高优先级不可抢。猫娘 7 个文件 117 条全绿。
* 新增真窗探针 `scripts/verify/pet-girl-cdp.mjs`（CDP，18 条判据）：倾斜 −3.96° / 侧移 −1.50px /
  转身 −1 / 松开 −0.15°、注意 422.6ms、头 tap 的 `shy`+`coverFace`+腮红 0.72、脚 tap 的
  `wink`+`shiver`+换句、晕 3169.3ms 与 16 笔记号、坐 `rest`+`sit`，全部 `all clear`。
* 全仓 `CI=true npx vitest run`：664 个文件 / 7057 条通过（1 skipped）。两条与桌宠无关的用例
  在 664 worker 并发下抖动（AG-UI 轮询窗口、Excel 写盘 15s 超时），单文件复跑 138/138 绿。
  `check:brand` / `check:main` / `check:preload` / `check:renderer` / `check:sprites` /
  `check:roster` / `palette:check` / `palette:migrate:check` 与四个构建全绿。

## [1.6.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.5.0...v1.6.0) (2026-10-25)

### 新增

* **桌宠:** 猫娘立绘换成用户参考图派生的整身位图（透明 WebP，512 高），桌宠、登场动画与
  Loading 窗是同一形象；脚心与墨框锚点由 `scripts/assets/build-girl-sprite.cjs` 生成，不再手调。
* **桌宠:** 猫娘的动作改成多帧逐帧动画——参考视频按**原片 24fps 全帧**抽成 146 帧图集
  （10×15 格、每帧 170×124、带 alpha），16 段动作（待机/走/舔毛/哈欠/伸懒腰/歪头/睡/被摸/
  吃/玩/被拖/被扔等）按原片节拍播放：静息循环 12fps（一拍两格）、动作与走路 24fps（原速，
  走路跟地面速度一致才不会滑步），切段 160ms 交叉淡化。旧版只抽 15fps 的 91 帧、再按 3–10fps
  播——每张画被撑到 100–333ms，那才是「不连贯」的真正来源：源片 6 秒里只有 88 张不同的画，
  采样率与「每 2 帧换一张」的原节拍错位，播放又把画面进一步拉长。
* **桌宠:** 循环段改**往返播放**（ping-pong）。逐段实测：首尾接缝的画面差（53–100）比段内
  相邻帧差（19–36）大 1.3–2.5 倍，直接 wrap 必看见一次回跳；往返播放把这一跳抹掉。
  躯干轴仍按「最大连通域在 y∈[90,170] 的 alpha 加权横坐标」分段取中位数钉到格心。
* **客户端美术:** 145 张派生位图（12 只猫 × 6 档状态 + 25 档散点情绪 + 12 任务卡 + 12 方头像
  + 16 张非角色 + 4 张欢迎页）换成参考图派生的位图立绘：30 格情绪/姿态静帧 + **7 格高清姿态**
  （用户给的 1136×912 立绘：坐姿打招呼 / 比心 / 蹦跳 / 奔跑 / 伸懒腰 / 转身回眸 / 抱膝）。
  12 姿态里 6 个直接取高清图、其余仍取静帧表；高清图按「最大连通域 + 填洞」抠像，
  把背景那层粉色柔光与星星整片去掉（只按色差抠会在深色桌布上留一片灰雾）。
* **桌宠:** 每次启动播放一次参考视频派生的登场动画（146 帧 / 24fps，透明底色）；
  会播放动画时不再创建 Loading 窗，启动期只保留一条动画。
* **桌宠:** Loading 窗缩到 260×260，并显示整身立绘（190px 高）——不再裁头部。

### 修复

* **桌宠:** v1.5.0 的猫娘在所有装机上不可见——宠物窗没登记 IPC 发送方类别，
  `verge:profile:get` 被发送方闸门拒绝、异常又被渲染端咽掉；补上登记、销毁清理与源码锁。
* **桌宠:** 命中几何按重画后的真窗实测重钉为 1.24u × 1.71u（中心右移 2.6s、下移 37.0s），
  旧框点身侧会点空；尺 #71 改按无气泡帧并集判定，并加「缩到 40% / 右移半宽必须判红」的变异自检。
* **桌宠:** 头部矩阵挂到根矩阵（v1.5.0 漏了 `matMul`，头比身子大 1/s），派生位图随新造型重出。

### 测试

* 新增登场动画几何/资产锁、Loading 策略锁与「Loading 用整身立绘」锁；新增帧段表锁
  （播放表与图集区间一一对应、12 活动 / 18 手势全有段可播、切段淡化与一次性段让位）、
  「循环段往返播放」锁（末帧后必须回到 n−2 而不是 0）、「播放帧率不低于 12fps 且重绘下限
  盖住片段的锁」，以及「图集与静态立绘同尺」不变式（`k × inkRefPx = 91vb × s`）；
  派生位图侧加「每格取样不许跨格」、12 姿态按实际图集（静帧/高清）取格的锁与两两像素差锁。
  全仓 659 个测试文件 / 7001 条通过（1 skipped），`check:brand` / `check:main` / `check:preload`
  / `check:renderer` / `check:sprites` / `check:roster` 全绿；`check:sprites` 的 197 张
  重测后按新量程重标带宽（square 0.409–0.484 / bust 0.373–0.497 / full 0.213–0.296 /
  round 0.349–0.450 / wide 0.141）与预算（256 档 ≤100 KB、512 档 ≤210 KB）；
  命中尺在真窗重跑：标准档质心 42.7 对窗轴 41，IoU 0.799 且变异对照判红。

## [1.5.0](https://github.com/damingslu-ctrl/Cyrene-Agent/compare/v1.4.0...v1.5.0) (2026-10-24)

### 新增

* **桌宠:** 猫娘形态——二头身站姿、18 层骨架、16 档表情与四层并发演出（body/gesture/face），
  右键菜单与设置页都能在「像素猫 ⇄ 猫娘」之间切换，身形三档（70×92 / 82×108 / 100×132）。
* **桌宠:** 18 个手势（spec §5 全量）、点击反馈 5 变体、触摸六类与 2.5s 合并。
* **桌宠:** 146 张派生资产重出为猫娘（文件名与语义冻结），图标支路 5 件仍是四足。
* **桌宠:** 六档工作状态的主进程单一权威（`work-status.ts`）与两条下行通道。
* **安全:** IPC 发送方白名单（按 webContents.id 认窗口），宠物通道只收宠物窗的请求。

### 修复

* **桌宠:** 命中几何按运行时实测反钉——猫娘的命中框此前窄 35%、矮 28%，点头顶点不中。
* **桌宠:** 眨眼与视线复活（四足的死通道），`form` 分派缺省 cat，四足逐像素不变。

### 测试

* 新增尺 #72（16×15 表情像素差）、#73（clip 归零）、#71 离线层（命中框 IoU）；
  全仓 654 个测试文件 / 6943 条通过。

## [1.3.4](https://github.com/Playa-Cyrene/Cyrene-Agent/compare/v1.3.3...v1.3.4) (2026-10-18)

### 新增

* **工具:** 移除模型控制 Live2D 的能力 ([5f95ec3](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/5f95ec357c71772ac98f696f47c59aa384b120ae))
* **模型:** 适配 Gemini 4 Argon ([3099bff](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/3099bff3e89b0a4ed1eceba0869b0e174dbed1b1))
* **chat:** 添加暂不回答入口与推荐选项提示 ([336eb59](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/336eb5983b3f71142247d177c6509a73d1c13cf2))

### 修复

* **插件面板:** 市场视图里点刷新重新拉取市场列表 ([7414786](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/7414786b9a742a5c77d2cb189a90b32c4edeb56b))
* **代码工作区:** 过滤 Windows refs 根目录元数据事件 ([a8b36fd](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/a8b36fdbd1939264fd6a26961254a8b177b92cfc))
* **动态:** 放行 CSP 中动态配图与贴图的本地协议加载 ([147909f](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/147909f937df9d063f764b9545ed6470bf1a436a))
* **对话轨迹:** 结束回退恢复失败的加载状态 ([52e7b88](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/52e7b88f2eb4262845197792c172741e731e7e53))
* **对话轨迹:** 拒绝过期末轮回退并刷新会话 ([cb17433](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/cb17433398bbd2be6d17ed93f49fdb94642d0da3))
* **对话轨迹:** 完善过期回退的并发恢复 ([6a81969](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/6a8196945f274a6eb4f1c81d0e6edef14e6aef6a))
* **工作区:** 修复 Git 监视防抖重复通知 ([07072f1](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/07072f1239df4a18609aa1fe4c9cfafa38677be9))
* **工作区预览:** 按打开代际拒绝旧关闭回调 ([0975969](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/09759690403aef6c9c8bedf211934a7a450bea2d))
* **工作区预览:** 在 SVG 关闭完成后恢复焦点 ([ce80d8e](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/ce80d8e605081adb7cfe8829fb9287d5cb222653))
* **会话存储:** 重试短暂占用导致的原子替换失败 ([f90396f](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/f90396f1fce631047432f698118b596e6cea1d52))
* **聊天:** 清理会话切换后的 Git 弹窗 ([4454531](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/4454531626d3c5ccba12d88bdd864d69f53a9ec9)), references [#190](https://github.com/Playa-Cyrene/Cyrene-Agent/issues/190)
* **聊天:** 修复图片和图表预览被网页遮挡 ([863c204](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/863c204b1b8709950fb8c447db7ed98816c35c78)), references [#190](https://github.com/Playa-Cyrene/Cyrene-Agent/issues/190)
* **聊天:** 支持问答输入框回车翻页和提交 ([0efadc6](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/0efadc68d19bcbdf065d8327b4fd2e4219395f52))
* **浏览器:** 避让工作区内的可见弹窗 ([bee8434](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/bee84348857f486133e37869a686bb5f4ce546d3)), references [#190](https://github.com/Playa-Cyrene/Cyrene-Agent/issues/190)
* **浏览器:** 单独的 home.arpa 与 .arpa 基础设施域不再补 https ([7aaca8f](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/7aaca8ff8bb58de31e4906ebec6f2d3952649111))
* **浏览器:** 单段主机名不再补全，保留后缀需前置名称 ([e7434fa](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/e7434faa1b9a28b2848dfc5097900e36721c153b))
* **浏览器:** 地址补全改为按解析器规范化后的主机分类 ([51e3808](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/51e380856d20a521d158a2b2ce55c2e19ca048bd))
* **浏览器:** 地址补全识别反斜杠路径与全角数字 ([7c39cc1](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/7c39cc12dc1a5cdebd3248d5ab157393b0cac495))
* **浏览器:** 地址补全只在主机部分拒绝空白 ([89562fe](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/89562fe15e1575a588f33a51fb36ed6a7ce11a68))
* **浏览器:** 地址栏输入省略协议时自动补全 ([3f8d530](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/3f8d530ffedf81bb6148f81fd17f84233d5a8d0d))
* **浏览器:** 地址栏提示文案不再要求输入完整 HTTP(S) 地址 ([9eb03ae](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/9eb03aeca6583b451c3663e68573d55d484bb2a0))
* **浏览器:** 内网保留域名与 CGNAT 补 http，单段主机名带端口可补全 ([bdf7b6f](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/bdf7b6ff809053c25e38eedf4fb168daa3bbc01d))
* **浏览器:** 排除非模态角色卡的网页避让 ([bf2960e](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/bf2960e9873e66a6ca0b642d70f7b19fd54eefc1))
* **浏览器:** 主机部分带 @ 时不补全，覆盖空用户信息 ([665066a](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/665066aa7b8f9b60cf4bc958994bbeac198f4e33))
* **朋友圈:** 保留落盘失败的队列任务以供重试 ([8a36444](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/8a36444334e669e14a7b979f4872677c961b567d))
* **朋友圈:** 保留删除失败任务的完成状态 ([63dcfdf](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/63dcfdf78e2430013d224396b70ea326f1218313))
* **数据迁移:** 迁移只执行一次，避免旧版重建的旧目录覆盖当前数据 ([0afb22d](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/0afb22d6047da0c048cb2c32fc1b22bc865d0328))
* **数据迁移:** 阻止迁移失败后使用不完整目录启动 ([e6289fb](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/e6289fb9d98e44daa0ec65b29f494885540f0d12))
* **贴纸:** 模型侧改用自然语言描述，避免表情包阻塞模型调用 ([a4bd441](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/a4bd4419bf298e412bd2479c5f7bfa1a3066de00))
* **文件预览:** 修复已打开 Markdown 的行号跳转 ([18ffdbb](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/18ffdbb4fe0fde1ab623c36fc984161555787314))
* **音乐:** 避免缺失歌曲标识时误判重复页 ([0c0fd55](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/0c0fd557743bf508e489420a628df2292e39154b))
* **音乐:** 补齐完整歌单的交互边界 ([eb9e292](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/eb9e2929d377e00a7192ee0d36fdf414ba8c3e98))
* **音乐:** 修复网易云歌单分页加载不完整 ([1dcde85](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/1dcde85fb4ed2325ee4284a5f78b8aa6a2766647))
* **音乐:** 修正歌单播放曲目与缓存标识错配 ([2b2b952](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/2b2b9521bfb3ea1525c9521ce35fe432516994c2))
* **音乐:** 优先显示主动播放操作的错误 ([037aa10](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/037aa10bb572be6ac0d54819e75cf50a9fb44a1e))
* **桌宠:** 修正 Live2D 动作资源解析 ([45ab1e9](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/45ab1e9e187891b1da0d1f01dd665db5d2b399fb)), references [#199](https://github.com/Playa-Cyrene/Cyrene-Agent/issues/199)
* **chat:** 本地化暂不回答的提交内容 ([9460cd2](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/9460cd2c689aca488364061409768322542a3d7c))
* **chat:** 完善推荐选项的提示说明 ([72ad53b](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/72ad53b846e9346b1c03fe205d64beb4a296f329))
* **memory:** preserve run ownership across user adjustments ([538a5b4](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/538a5b4005b46baa8e445830f311e297335cc9f7))
* **memory:** synchronize pending turns with canonical transcript sources ([7dd2958](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/7dd2958367e8bf9c8f3ee6133f5820046c04c49f))
* **music:** 未就绪界面可拖动，歌单多时保留拖拽区并可滚动 ([6f7125d](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/6f7125d839a7c581fa38d7755f20b3f12c197cc3))
* **qq:** 解除 loopback/custom 地址解析对网卡枚举的依赖 ([f28874b](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/f28874b5cbd3ba06ddaebeaac7678c839edb8bf3))
* **shell:** drain historical initialization before shutdown ([e9b9e73](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/e9b9e73e9f599e0c67df3abab68a5030c8efa092))
* **shell:** persist background job metadata in SQLite ([1292f02](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/1292f0245ced6c25e31a41692ee800e6cf2ccd79))

### 重构

* **chat:** 精简 ask_user 工具描述 ([a217141](https://github.com/Playa-Cyrene/Cyrene-Agent/commit/a2171418a8b26fa05bfd9a834632fb949f0b3433))
