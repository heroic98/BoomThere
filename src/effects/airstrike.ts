import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { softTexture, ringTexture, flameTexture, smokePuffTexture, streakTexture, spawn, destroyAllParticles, requestFinishWhenDrained } from './particles';
import { initAudio, sfxJet, sfxBoom, stopAllAudio } from './audio';
import bombAsset from '../assets/bomb.png';

gsap.registerPlugin(MotionPathPlugin);

// ---- 时间轴常量（秒），与开发文档的时段表一致 ----
const BOMB_FALL = 0.62; // 炸弹下落时长
const IMPACT_AT = 1.6; // 起爆时间点
const RELEASE_AT = IMPACT_AT - BOMB_FALL; // 1.0s 投弹
const END_AT = 3.05;

// ---- 机甲涂装（RX-78 风格：白装甲 + 深蓝骨架 + 红黄点缀 + 青色能量光） ----
const HULL_DARK = 0x10152b;
const HULL_MID = 0x273049;
const ARMOR = 0xdde4f4;
const ARMOR_SHADE = 0xa9b5d3;
const ACCENT_RED = 0xe23c3c;
const ACCENT_YELLOW = 0xf5b90f;
const GLOW_CYAN = 0x6fe8ff;

const FIRE_TINTS = [0xfff3d0, 0xffd98f, 0xffb054, 0xff8a3c, 0xe8491f];
const SMOKE_TINTS = [0x9aa0a8, 0x6f747c, 0x4e5257];
const EMBER_TINTS = [0xffcf7d, 0xff9a3c, 0xff7a2f];
const PLASMA_TINTS = [0x9ff2ff, 0xd8f6ff, 0xffe2b0];

const JET_ART_SCALE = 0.26; // 640px 矢量机甲 → 世界约 166px
const JET_LEN = 78; // 机头到机身原点的世界距离（激光原点用）
const BOMB_ART_SCALE = 0.19; // 素材 256px → 世界约 49px

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 浏览器开发调试用的 window 挂载点（仅 DEV 构建生效）
type DebugWindow = Window & Record<string, any>;
const debugWindow = (): DebugWindow => window as unknown as DebugWindow;

let running = false;

export function isAirstrikeRunning(): boolean {
  return running;
}

/**
 * 播放一次空袭特效。同一时间只允许一场；
 * 完成或异常中止都会清理全部精灵、粒子与时间轴。
 */
export function playAirstrike(app: Application, x: number, y: number): Promise<void> {
  if (running) return Promise.resolve();
  running = true;
  app.ticker.maxFPS = 0; // 特效需要全帧率
  initAudio();
  return runEffect(app, x, y).finally(() => {
    running = false;
  });
}

function runEffect(app: Application, tx: number, ty: number): Promise<void> {
  return new Promise<void>((resolve) => {
    if (import.meta.env.DEV) {
      debugWindow().__btRun = { started: Math.round(performance.now()) };
    }
    const repeats: gsap.core.Tween[] = [];
    const root = new Container();
    // shakeWrap 仅用于起爆时的镜头震动，避免污染 stage 坐标
    const shakeWrap = new Container();
    root.addChild(shakeWrap);
    app.stage.addChild(root);
    app.ticker.start();

    let tl: gsap.core.Timeline | null = null;
    let finished = false;
    // 调试慢放会拉长真实耗时，兜底超时随之缩放
    let dbgScale = 1;
    const safetyRef = { id: 0 };
    const armSafety = (): void => {
      window.clearTimeout(safetyRef.id);
      safetyRef.id = window.setTimeout(finish, ((END_AT + 1.5) * 1000) / dbgScale);
    };
    armSafety();

    function finish(): void {
      if (finished) return;
      finished = true;
      window.clearTimeout(safetyRef.id);
      tl?.kill();
      for (const t of repeats) t.kill();
      stopAllAudio();
      destroyAllParticles();
      try {
        root.destroy({ children: true, texture: false, textureSource: false });
      } catch {
        /* 已销毁，忽略 */
      }
      if (import.meta.env.DEV) {
        debugWindow().__btRun.finished = Math.round(performance.now());
        delete debugWindow().__btDebug;
      }
      app.ticker.stop();
      resolve();
    }

    try {
      tl = buildTimeline(shakeWrap, tx, ty, repeats, () => requestFinishWhenDrained(finish), (s) => {
        dbgScale = s;
        armSafety();
      });
    } catch (err) {
      console.error('[boomthere] airstrike failed', err);
      if (import.meta.env.DEV) {
        debugWindow().__btRun.error = String(err);
      }
      finish();
    }
  });
}

// ---- 机体贴图：程序化矢量装甲，640px 高清画布一次烘焙 ----
let jetTex: Texture | null = null;
let bombTex: Texture | null = null;

/**
 * RX 风格重型机甲战机：机首 V 鳍、肩部厚甲、分段翼面与双涡轮推进器。
 * 全部在 640px 画布上绘制并烘焙，避免旧贴图的塑料感和低分辨率锯齿。
 */
function createMechaTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 640;
  const ctx = cv.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const poly = (points: number[], fill: string | CanvasGradient, stroke = '#172239', width = 5): void => {
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (width) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  };
  const seam = (points: number[], color = '#66758b', width = 3): void => {
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const white = ctx.createLinearGradient(80, 80, 540, 560);
  white.addColorStop(0, '#ffffff');
  white.addColorStop(0.45, '#e9eef5');
  white.addColorStop(1, '#aebbd0');
  const whiteReverse = ctx.createLinearGradient(560, 80, 100, 560);
  whiteReverse.addColorStop(0, '#ffffff');
  whiteReverse.addColorStop(0.45, '#e9eef5');
  whiteReverse.addColorStop(1, '#aebbd0');
  const blue = ctx.createLinearGradient(0, 130, 0, 520);
  blue.addColorStop(0, '#315ca8');
  blue.addColorStop(1, '#14294f');
  const red = ctx.createLinearGradient(0, 40, 0, 500);
  red.addColorStop(0, '#ff6258');
  red.addColorStop(0.45, '#d9323c');
  red.addColorStop(1, '#851f30');
  const glass = ctx.createLinearGradient(290, 135, 350, 250);
  glass.addColorStop(0, '#d9fbff');
  glass.addColorStop(0.28, '#58d9f1');
  glass.addColorStop(0.65, '#167b9f');
  glass.addColorStop(1, '#092c4b');

  // 一体式深色机械骨架：先确定有别于普通三角飞船的宽厚机甲轮廓。
  poly([320,16,348,64,352,112,388,150,404,220,476,274,586,392,584,468,490,458,456,510,408,506,390,566,346,566,320,538,294,566,250,566,232,506,184,510,150,458,56,468,54,392,164,274,236,220,252,150,288,112,292,64], '#111a2c', '#080d18', 9);

  // 后掠主翼：白色外甲 + 深蓝机械夹层，翼根保留厚重体积。
  poly([248,214,176,268,70,390,74,435,169,424,219,365,276,329,278,249], white, '#1a2940', 6);
  poly([392,214,464,268,570,390,566,435,471,424,421,365,364,329,362,249], whiteReverse, '#1a2940', 6);
  poly([174,287,91,387,102,402,164,387,220,329,241,272], blue, '#31445f', 4);
  poly([466,287,549,387,538,402,476,387,420,329,399,272], blue, '#31445f', 4);
  poly([75,392,54,392,56,468,116,449,133,420], red, '#561c2b', 5);
  poly([565,392,586,392,584,468,524,449,507,420], red, '#561c2b', 5);
  poly([117,448,169,424,199,435,180,485,139,500,112,477], white, '#1a2940', 5);
  poly([523,448,471,424,441,435,460,485,501,500,528,477], whiteReverse, '#1a2940', 5);
  seam([112,414,166,403,207,350,252,314]);
  seam([528,414,474,403,433,350,388,314]);
  seam([153,452,176,455,164,480]);
  seam([487,452,464,455,476,480]);
  seam([193,294,209,310,179,348], '#8a98aa', 2);
  seam([447,294,431,310,461,348], '#8a98aa', 2);

  // 肩部复合装甲：切面、灰色内侧与红色散热口营造拼装层次。
  poly([248,153,292,127,302,248,272,329,224,306,207,253], white, '#1a2940', 6);
  poly([392,153,348,127,338,248,368,329,416,306,433,253], whiteReverse, '#1a2940', 6);
  poly([238,207,273,181,282,250,258,296,228,280], '#c4cede', '#65748b', 3);
  poly([402,207,367,181,358,250,382,296,412,280], '#c4cede', '#65748b', 3);
  poly([222,263,251,283,243,310,218,292], red, '#762435', 3);
  poly([418,263,389,283,397,310,422,292], red, '#762435', 3);
  seam([258,161,270,178], '#ffffff', 4);
  seam([382,161,370,178], '#ffffff', 4);

  // 中央蓝色胸甲与白色驾驶舱框架。
  poly([294,112,346,112,369,202,356,321,386,389,364,477,320,512,276,477,254,389,284,321,271,202], blue, '#101a2e', 7);
  poly([286,132,311,117,309,250,286,290,272,221], white, '#26364e', 4);
  poly([354,132,329,117,331,250,354,290,368,221], whiteReverse, '#26364e', 4);
  poly([294,137,320,122,346,137,349,199,334,239,306,239,291,199], glass, '#0b253e', 5);
  poly([304,143,320,134,336,143,331,158,309,158], '#e9fdff', 'transparent', 0);
  seam([301,209,320,225,339,209], '#73ddef', 3);
  poly([284,279,309,256,309,348,278,372,265,334], white, '#26364e', 4);
  poly([356,279,331,256,331,348,362,372,375,334], whiteReverse, '#26364e', 4);
  poly([286,305,302,292,302,312,283,326], red, '#8e2937', 2);
  poly([354,305,338,292,338,312,357,326], red, '#8e2937', 2);
  seam([283,343,301,331], '#738298', 3);
  seam([357,343,339,331], '#738298', 3);

  // 标志性机首：红色传感冠、白色面甲、金色双 V 鳍。
  poly([320,18,342,68,339,111,320,135,301,111,298,68], white, '#16243a', 5);
  poly([320,20,334,69,320,91,306,69], red, '#812536', 3);
  poly([291,83,305,119,320,133,314,103,307,79], '#ffd84b', '#8b6420', 3);
  poly([349,83,335,119,320,133,326,103,333,79], '#ffd84b', '#8b6420', 3);
  poly([307,94,320,103,333,94,330,117,320,128,310,117], '#f4f7fb', '#26364e', 3);
  seam([313,108,320,114,327,108], '#36d9f3', 4);

  // 腰部、尾部稳定翼与双发动机舱。
  poly([275,370,309,351,309,461,286,486,261,453], white, '#1a2940', 5);
  poly([365,370,331,351,331,461,354,486,379,453], whiteReverse, '#1a2940', 5);
  poly([305,362,335,362,344,461,320,505,296,461], '#263c65', '#101a2e', 5);
  poly([309,389,331,389,333,432,320,447,307,432], red, '#701f32', 3);
  poly([266,434,242,503,250,552,282,525,295,473], red, '#561c2b', 5);
  poly([374,434,398,503,390,552,358,525,345,473], red, '#561c2b', 5);
  poly([195,350,257,337,276,381,264,486,226,506,183,466], white, '#172239', 6);
  poly([445,350,383,337,364,381,376,486,414,506,457,466], whiteReverse, '#172239', 6);
  poly([205,374,248,363,259,389,250,419,206,426,192,403], blue, '#31445f', 4);
  poly([435,374,392,363,381,389,390,419,434,426,448,403], blue, '#31445f', 4);
  seam([196,444,226,451,254,439]);
  seam([444,444,414,451,386,439]);

  // 涡轮：发光环 + 八片金属叶片，双引擎在近距离掠过时仍有清晰细节。
  for (const ex of [222, 418]) {
    ctx.save();
    ctx.shadowColor = '#5deaff';
    ctx.shadowBlur = 24;
    ctx.beginPath();
    ctx.arc(ex, 453, 35, 0, Math.PI * 2);
    ctx.fillStyle = '#38dff5';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(ex, 453, 32, 0, Math.PI * 2);
    ctx.fillStyle = '#10263e';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#a5f7ff';
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const a2 = a + 0.32;
      poly([
        ex + Math.cos(a) * 9, 453 + Math.sin(a) * 9,
        ex + Math.cos(a) * 27, 453 + Math.sin(a) * 27,
        ex + Math.cos(a2) * 27, 453 + Math.sin(a2) * 27,
        ex + Math.cos(a2) * 12, 453 + Math.sin(a2) * 12,
      ], '#70d9e9', '#173c55', 1);
    }
    ctx.beginPath();
    ctx.arc(ex, 453, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#efffff';
    ctx.fill();
    poly([ex - 29,482,ex + 29,482,ex + 21,510,ex - 21,510], '#14233a', '#080f1d', 4);
    seam([ex - 15,490,ex + 15,490], '#8b9aaf', 3);
  }

  // 小比例军规标识与铆钉：增加真实机甲的涂装信息密度。
  ctx.fillStyle = '#24344d';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(143, 374);
  ctx.rotate(-0.72);
  ctx.fillText('RX-78', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(497, 374);
  ctx.rotate(0.72);
  ctx.font = '700 15px Arial, sans-serif';
  ctx.fillText('E.F.S.F.', 0, 0);
  ctx.restore();
  ctx.fillStyle = '#e9b928';
  for (const [x, y] of [[259,342],[381,342],[278,397],[362,397],[162,414],[478,414]]) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  poly([89,415,103,409,99,425], '#ffd84b', 'transparent', 0);
  poly([551,415,537,409,541,425], '#ffd84b', 'transparent', 0);

  return Texture.from(cv);
}

/** 启动时预加载机体贴图（drawJet / drawBomb 同步取用）。 */
export async function preloadAirstrikeAssets(): Promise<void> {
  bombTex = await Assets.load(bombAsset);
  jetTex = createMechaTexture();
}

/**
 * 俯视战机（钢蓝装甲 + 青色引擎，机头朝上的 CC0 素材）。
 * 素材预旋转 90° 使机头指向容器 +x，航向角可直接作为容器旋转角。
 */
function drawJet(): { node: Container; exhausts: Sprite[]; navLight: Sprite } {
  const node = new Container();

  if (jetTex) {
    const art = new Sprite(jetTex);
    art.anchor.set(0.5);
    art.rotation = Math.PI / 2; // 机头（素材上方）→ 容器 +x
    art.scale.set(JET_ART_SCALE);
    node.addChild(art);
  }

  // 双引擎青色加力焰（对准矢量机体尾部双喷口）
  const exhausts: Sprite[] = [];
  for (const [ex, ey, es, col] of [
    [-49, -25.5, 1.15, '#7fe7ff'],
    [-49, 25.5, 1.15, '#7fe7ff'],
  ] as Array<[number, number, number, string]>) {
    const s = new Sprite(softTexture(col));
    s.anchor.set(0.5);
    s.position.set(ex, ey);
    s.scale.set(es);
    s.blendMode = 'add';
    s.alpha = 0.85;
    node.addChild(s);
    exhausts.push(s);
  }

  // 尾焰拉长锥（等离子拖尾）：头部贴喷口，向后渐隐
  const cone = new Sprite(streakTexture());
  cone.anchor.set(1, 0.5);
  cone.position.set(-54, 0);
  cone.scale.set(1.05, 0.85);
  cone.blendMode = 'add';
  cone.alpha = 0.7;
  cone.tint = 0x9ff2ff;
  node.addChild(cone);
  exhausts.push(cone);

  // 尾部核心灯（青白，闪烁）
  const navLight = new Sprite(softTexture('#bff4ff'));
  navLight.anchor.set(0.5);
  navLight.position.set(-48, 0);
  navLight.scale.set(0.5);
  navLight.blendMode = 'add';
  node.addChild(navLight);

  return { node, exhausts, navLight };
}

/** 太空炸弹（CC0 素材 + 青色能量芯 + 弹头等离子光环）。 */
function drawBomb(): { node: Container; core: Sprite; aura: Sprite } {
  const node = new Container();
  if (bombTex) {
    const art = new Sprite(bombTex);
    art.anchor.set(0.5);
    art.scale.set(BOMB_ART_SCALE);
    node.addChild(art);
  }

  const core = new Sprite(softTexture('#6fe8ff'));
  core.anchor.set(0.5);
  core.position.set(0, 1);
  core.scale.set(0.34, 0.9);
  core.blendMode = 'add';
  core.alpha = 0.95;
  node.addChild(core);

  // 弹头等离子光环（下落途中持续脉动的目标点）
  const aura = new Sprite(softTexture('#7fe7ff'));
  aura.anchor.set(0.5);
  aura.position.set(0, 14);
  aura.scale.set(1.1);
  aura.blendMode = 'add';
  aura.alpha = 0.75;
  node.addChild(aura);

  return { node, core, aura };
}
function buildTimeline(
  shakeWrap: Container,
  tx: number,
  ty: number,
  repeats: gsap.core.Tween[],
  onTimelineDone: () => void,
  onSlow?: (s: number) => void,
): gsap.core.Timeline {
  const W = window.innerWidth;

  const world = new Container(); // 实体层
  const fx = new Container(); // 粒子层（最上层）
  shakeWrap.addChild(world);
  shakeWrap.addChild(fx);

  // ---------- 0.0-0.4s 全息瞄准圈 ----------
  const reticle = new Container();
  reticle.position.set(tx, ty);
  reticle.alpha = 0;
  world.addChild(reticle);

  const retGlow = new Sprite(softTexture('#ff3b30'));
  retGlow.anchor.set(0.5);
  retGlow.blendMode = 'add';
  retGlow.alpha = 0.22;
  retGlow.scale.set(3.2);
  reticle.addChild(retGlow);

  // 雷达扫描扇形
  const sweep = new Graphics();
  sweep.moveTo(0, 0).arc(0, 0, 29, 0, Math.PI / 3).closePath().fill({ color: 0xff5a4f, alpha: 0.16 });
  reticle.addChild(sweep);

  const ring = new Graphics();
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2;
    ring.arc(0, 0, 46, a0, a0 + (Math.PI * 2 / 24) * 0.55);
  }
  ring.stroke({ width: 3, color: 0xff3b30, alpha: 0.95 });
  reticle.addChild(ring);

  // 八向刻度
  const ticks = new Graphics();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ticks.moveTo(Math.cos(a) * 37, Math.sin(a) * 37).lineTo(Math.cos(a) * 43, Math.sin(a) * 43);
  }
  ticks.stroke({ width: 1.4, color: 0xff8578, alpha: 0.7 });
  reticle.addChild(ticks);

  const inner = new Graphics();
  inner.circle(0, 0, 30).stroke({ width: 1.5, color: 0xff3b30, alpha: 0.85 });
  inner.moveTo(-46, 0).lineTo(-34, 0).moveTo(34, 0).lineTo(46, 0);
  inner.moveTo(0, -46).lineTo(0, -34).moveTo(0, 34).lineTo(0, 46);
  inner.stroke({ width: 2.5, color: 0xff3b30, alpha: 0.95 });
  inner.circle(0, 0, 3).fill({ color: 0xff5a4f });
  reticle.addChild(inner);

  // 外圈反向旋转的跟踪括弧
  const brackets = new Graphics();
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
    brackets.arc(0, 0, 58, a0, a0 + 0.5);
  }
  brackets.stroke({ width: 2.5, color: 0xff6a5e, alpha: 0.75 });
  reticle.addChild(brackets);

  const lockText = new Text({
    text: 'TGT LOCKED',
    style: { fontFamily: 'Consolas, "Courier New", monospace', fontSize: 13, fill: 0xff7b6b, letterSpacing: 4 },
  });
  lockText.anchor.set(0.5);
  lockText.position.set(0, 74);
  lockText.alpha = 0;
  reticle.addChild(lockText);

  const ping = new Graphics();
  ping.circle(0, 0, 30).stroke({ width: 2, color: 0xffd2c8 });
  ping.alpha = 0;
  reticle.addChild(ping);

  // ---------- 战机与炸弹 ----------
  // 目标在左半屏时从左向右掠过（dir=1），右半屏反之（整条航线水平镜像）。
  const dir: 1 | -1 = tx < W / 2 ? 1 : -1;
  const alt = Math.min(320, Math.max(110, ty - 70));

  const jet = new Container();
  const { node: jetBody, exhausts, navLight } = drawJet();
  jet.addChild(jetBody);

  // 地面投影：俯视飞越的高度感（随飞行缩放，偏移向"地面"）
  const jetShadow = new Sprite(softTexture('#0a0e18'));
  jetShadow.anchor.set(0.5);
  jetShadow.alpha = 0;
  world.addChildAt(jetShadow, 0);

  // 环绕航线：自屏幕边缘切入，向目标方向压低绕近（近目标处放大掠过），投弹后爬升离场
  const mx = (x: number): number => (dir === 1 ? x : W - x); // 航线水平镜像
  const clampY = (y: number): number => Math.max(30, y);
  const flightPath = [
    { x: mx(-180), y: clampY(ty - alt - 70) }, // 屏外切入
    { x: mx(tx - 540), y: clampY(ty - alt + 50) }, // 开始压低
    { x: mx(tx - 220), y: clampY(ty - 80) }, // 最近掠过点（放大顶点）
    { x: mx(tx + 260), y: clampY(ty - 170) }, // 拉起
    { x: mx(W + 200), y: clampY(ty - alt - 130) }, // 爬升离场
  ];
  const FLIGHT_DUR = 1.9; // 0.3s 入场 → 2.2s 离场
  jet.position.set(flightPath[0].x, flightPath[0].y);
  world.addChild(jet);

  const { node: bomb, core: bombCore, aura: bombAura } = drawBomb();
  bomb.visible = false;
  world.addChild(bomb);

  // 浏览器开发调试探针：验证战机/炸弹运动与渲染状态
  let tlRef: gsap.core.Timeline | null = null;
  if (import.meta.env.DEV) {
    debugWindow().__btDebug = {
      jet: () => ({
        x: Math.round(jet.x),
        y: Math.round(jet.y),
        rot: Math.round(jet.rotation * 100) / 100,
        visible: jet.visible,
        alpha: jet.alpha,
        renderable: jet.renderable,
        inStage: !!jet.parent,
      }),
      bomb: () => ({
        visible: bomb.visible,
        x: Math.round(bomb.x),
        y: Math.round(bomb.y),
      }),
      tlTime: () => (tlRef ? Math.round(tlRef.time() * 100) / 100 : -1),
      seek: (t: number) => {
        if (tlRef) tlRef.time(t);
      },
      flyN: () => flyN,
      t: performance.now(),
    };
  }

  // 导引激光（机甲风设计照射）
  const laser = new Graphics();
  laser.blendMode = 'add';
  laser.visible = false;
  let laserOn = false;
  world.addChild(laser);

  // 投弹倒计时收缩环：随炸弹坠落收紧到目标点
  const incoming = new Graphics();
  incoming.circle(0, 0, 30).stroke({ width: 2, color: 0x7fe7ff, alpha: 0.9 });
  incoming.circle(0, 0, 36).stroke({ width: 1, color: 0x7fe7ff, alpha: 0.4 });
  incoming.position.set(tx, ty);
  incoming.alpha = 0;
  world.addChild(incoming);

  // 飞行随动：机身姿态对齐航向 + 尾焰/翼尖涡流逐帧发射 + 导引激光重绘
  let prevX = flightPath[0].x;
  let prevY = flightPath[0].y;
  let flyN = 0;
  const flyUpdate = (): void => {
    try {
      flyN++;
      const vx = jet.x - prevX;
      const vy = jet.y - prevY;
      prevX = jet.x;
      prevY = jet.y;
      if (!vx && !vy) return;
    const ang = Math.atan2(vy, vx);
    // 俯视对称机身：机头（容器 +x）直接对齐航向
    jet.rotation = ang;
    const len = Math.hypot(vx, vy) || 1;
    const nx = vx / len;
    const ny = vy / len;
    const sc = jet.scale.x;
    // 地面投影随高度（缩放）变化
    jetShadow.position.set(jet.x + 18 * sc, jet.y + 26 * sc);
    jetShadow.scale.set(2.6 * sc);
    jetShadow.alpha = 0.22 * Math.min(sc, 1);
    // 发动机等离子尾焰（喷口沿反航向）
    const tailX = jet.x - nx * 58 * sc;
    const tailY = jet.y - ny * 58 * sc;
    spawn({
      parent: fx,
      tex: softTexture('#7fe7ff'),
      x: tailX + rand(-3, 3),
      y: tailY + rand(-3, 3),
      vx: -nx * rand(90, 160),
      vy: -ny * rand(90, 160),
      life: rand(0.22, 0.38),
      sc0: 0.7,
      sc1: 0.05,
      a0: 0.85,
      additive: true,
      tint: 0x9ff2ff,
    });
    // 白热核心
    spawn({
      parent: fx,
      tex: softTexture('#ffffff'),
      x: tailX - nx * 4,
      y: tailY - ny * 4,
      vx: -nx * rand(60, 110),
      vy: -ny * rand(60, 110),
      life: rand(0.1, 0.16),
      sc0: 0.34,
      sc1: 0.04,
      a0: 0.9,
      additive: true,
    });
    // 翼尖涡流（垂直航向偏移）
    spawn({
      parent: fx,
      tex: softTexture('#ffffff'),
      x: jet.x - ny * 26 * sc,
      y: jet.y + nx * 26 * sc,
      vx: -nx * rand(30, 70),
      vy: -ny * rand(30, 70),
      life: rand(0.3, 0.5),
      sc0: 0.16,
      sc1: 0.55,
      a0: 0.12,
      tint: 0xd7e2ee,
      fadeIn: 0.35,
    });
    // 导引激光随动重绘（机头指向目标）
    if (laserOn) {
      const noseX = jet.x + nx * JET_LEN * sc;
      const noseY = jet.y + ny * JET_LEN * sc;
      laser.clear();
      laser.moveTo(noseX, noseY).lineTo(tx, ty).stroke({ width: 1.2, color: 0xff5040, alpha: 0.45 + Math.random() * 0.2 });
      laser.moveTo(noseX, noseY).lineTo(tx, ty).stroke({ width: 0.4, color: 0xffb9a8, alpha: 0.9 });
    }
    } catch (err) {
      if (import.meta.env.DEV) {
        (window as unknown as Record<string, any>).__btFlyErr = String(err);
      }
    }
  };

  // 炸弹等离子尾迹：拉长光条沿弹道方向排列，形成"能量鱼雷"拖尾
  const emitBombTrail = (): void => {
    const r = bomb.rotation;
    const tail = 24; // 弹体尾部世界偏移
    const tailX = bomb.x + tail * Math.sin(r);
    const tailY = bomb.y - tail * Math.cos(r);
    const va = Math.atan2(ty - bomb.y, tx - bomb.x); // 弹道方向
    const back = rand(20, 70);
    // 青白等离子核心光条
    spawn({
      parent: fx,
      tex: streakTexture(),
      x: tailX + rand(-2, 2),
      y: tailY + rand(-2, 2),
      vx: -Math.cos(va) * back,
      vy: -Math.sin(va) * back,
      life: rand(0.18, 0.3),
      sc0: rand(0.55, 0.85),
      sc1: 0.06,
      sy0: 0.16,
      sy1: 0.05,
      a0: 0.95,
      rot: va,
      additive: true,
      tint: 0x9ff2ff,
    });
    // 橙色火舌光条
    spawn({
      parent: fx,
      tex: streakTexture(),
      x: tailX,
      y: tailY,
      vx: -Math.cos(va) * back * 0.8,
      vy: -Math.sin(va) * back * 0.8,
      life: rand(0.22, 0.34),
      sc0: rand(0.7, 1.0),
      sc1: 0.08,
      sy0: 0.2,
      sy1: 0.05,
      a0: 0.85,
      rot: va,
      additive: true,
      tint: 0xffc069,
    });
    // 偶发白色热星
    if (Math.random() < 0.4) {
      const vx = rand(-160, 160);
      const vy = rand(-140, -20);
      spawn({
        parent: fx,
        tex: streakTexture(),
        x: tailX,
        y: tailY,
        vx,
        vy,
        life: rand(0.2, 0.32),
        sc0: rand(0.3, 0.5),
        sc1: 0.05,
        sy0: 0.12,
        sy1: 0.03,
        a0: 0.95,
        rot: Math.atan2(vy, vx),
        additive: true,
      });
    }
    // 烟迹（分瓣云团）
    spawn({
      parent: fx,
      tex: smokePuffTexture(),
      x: tailX,
      y: tailY,
      vx: rand(-12, 12),
      vy: rand(-30, -8),
      life: rand(0.5, 0.75),
      sc0: 0.4,
      sc1: 1.3,
      a0: 0.3,
      rot: rand(0, Math.PI * 2),
      spin: rand(-1.2, 1.2),
      tint: 0xaab2bd,
      fadeIn: 0.25,
    });
  };

  // ---------- 起爆（电影感：瞬间成型 + 全屏闪光 + 多尺度火焰，全部走粒子系统便于清理） ----------
  const explode = (): void => {
    const cover = Math.max(window.innerWidth, window.innerHeight) / 40;
    // 全屏冲击闪光（两层：白快 + 暖慢，透过透明覆盖层"点亮"整个桌面）
    spawn({
      parent: fx, tex: softTexture('#ffffff'), x: tx, y: ty,
      life: 0.2, sc0: cover, sc1: cover * 1.25, a0: 0.42, a1: 0, additive: true,
    });
    spawn({
      parent: fx, tex: softTexture('#ffd9a0'), x: tx, y: ty,
      life: 0.45, sc0: cover * 0.8, sc1: cover * 1.4, a0: 0.2, a1: 0, additive: true,
    });
    // 火球主体：不规则火舌贴图瞬间成型，只轻微膨胀
    spawn({
      parent: fx, tex: flameTexture(), x: tx, y: ty,
      vy: -40, life: 0.5, sc0: 3.2, sc1: 4.0, sy0: 2.7, sy1: 3.2,
      a0: 1, a1: 0, rot: rand(0, Math.PI * 2), spin: 0.5,
      additive: true, tint: 0xffc873, fadeIn: 0.04,
    });
    // 白热核心
    spawn({
      parent: fx, tex: softTexture('#fff6e0'), x: tx, y: ty,
      life: 0.16, sc0: 2.2, sc1: 3.0, a0: 1, additive: true,
    });
    // 火舌群：沿速度方向拉长，爆发后急速减速上飘
    for (let i = 0; i < 8; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(140, 380);
      const vx = Math.cos(ang) * sp;
      const vy = Math.sin(ang) * sp * 0.7 - 60;
      const sx = rand(0.9, 1.6);
      spawn({
        parent: fx,
        tex: flameTexture(),
        x: tx + Math.cos(ang) * 12,
        y: ty + Math.sin(ang) * 8,
        vx,
        vy,
        g: -80,
        drag: 3.2,
        life: rand(0.28, 0.45),
        sc0: sx,
        sc1: sx * 0.3,
        sy0: sx * rand(0.55, 0.8),
        sy1: sx * 0.2,
        a0: 0.95,
        rot: ang,
        additive: true,
        tint: pick([0xfff3c4, 0xffd873, 0xff9a3c, 0xff6a2a]),
      });
    }
    // 高温火花：拉长条运动模糊 + 重力坠落地平抛
    for (let i = 0; i < 18; i++) {
      const ang = rand(0, Math.PI * 2);
      const sp = rand(500, 1100);
      const vx = Math.cos(ang) * sp;
      const vy = Math.sin(ang) * sp * 0.65 - 200;
      spawn({
        parent: fx,
        tex: streakTexture(),
        x: tx,
        y: ty,
        vx,
        vy,
        g: 1300,
        drag: 1.6,
        life: rand(0.3, 0.6),
        sc0: rand(0.4, 0.75),
        sc1: 0.1,
        sy0: 0.14,
        sy1: 0.05,
        a0: 1,
        rot: Math.atan2(vy, vx),
        additive: true,
        tint: pick([0xfff3c4, 0xffcf7d, 0xff9a3c]),
      });
    }
    // 等离子流（青色能量碎片）
    for (let i = 0; i < 10; i++) {
      const ang = rand(0, Math.PI * 2);
      const speed = rand(380, 980);
      spawn({
        parent: fx,
        tex: streakTexture(),
        x: tx,
        y: ty,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed * 0.7 - 120,
        g: 900,
        drag: 1.6,
        life: rand(0.25, 0.45),
        sc0: rand(0.4, 0.7),
        sc1: 0.1,
        sy0: 0.13,
        sy1: 0.04,
        a0: 0.95,
        rot: Math.atan2(Math.sin(ang) * speed * 0.7 - 120, Math.cos(ang) * speed),
        additive: true,
        tint: pick(PLASMA_TINTS),
      });
    }
    // 暗色爆心（分瓣烟团）
    spawn({
      parent: fx, tex: smokePuffTexture(), x: tx, y: ty,
      vy: -35, life: 0.55, sc0: 1.0, sc1: 2.4, a0: 0.75, a1: 0,
      rot: rand(0, Math.PI * 2), spin: 0.8, tint: 0x2a180d,
    });
    // 冲击波：先快后慢（三次方缓出），白主环 + 青从环
    spawn({
      parent: fx, tex: ringTexture('#fff3e0'), x: tx, y: ty,
      life: 0.38, sc0: 0.3, sc1: 5.0, a0: 0.95, additive: true, easeOut: true,
    });
    spawn({
      parent: fx, tex: ringTexture('#7fe7ff'), x: tx, y: ty,
      delay: 0.05, life: 0.5, sc0: 0.2, sc1: 3.8, a0: 0.55, additive: true, easeOut: true,
    });
    // 垂直能量光柱（快速上升收细）
    spawn({
      parent: fx, tex: softTexture('#bff4ff'), x: tx, y: ty - 8,
      vy: -55, life: 0.38, sc0: 0.5, sc1: 0.85, sy0: 1.6, sy1: 6.0,
      a0: 0.7, additive: true, fadeIn: 0.05,
    });
    // 深色碎屑
    for (let i = 0; i < 6; i++) {
      spawn({
        parent: fx,
        tex: smokePuffTexture(),
        x: tx,
        y: ty,
        vx: rand(-450, 450),
        vy: rand(-520, -120),
        g: 1800,
        life: rand(0.45, 0.7),
        sc0: 0.16,
        sc1: 0.05,
        a0: 0.85,
        rot: rand(0, Math.PI * 2),
        spin: rand(-9, 9),
        tint: 0x232323,
      });
    }
    // 爆点首批翻卷浓烟（分瓣云团 + 自旋）
    for (let i = 0; i < 6; i++) {
      spawn({
        parent: fx,
        tex: smokePuffTexture(),
        x: tx + rand(-18, 18),
        y: ty + rand(-10, 6),
        vx: rand(-40, 40),
        vy: rand(-90, -40),
        drag: 1.2,
        delay: rand(0, 0.06),
        life: rand(0.6, 0.78),
        sc0: rand(0.9, 1.4),
        sc1: rand(2.2, 3.0),
        a0: 0.5,
        a1: 0,
        fadeIn: 0.08,
        rot: rand(0, Math.PI * 2),
        spin: rand(-1.6, 1.6),
        tint: pick([0x5b6066, 0x474b52, 0x6f747c]),
      });
    }
  };

  // ---------- 时间轴 ----------
  const tl = gsap.timeline({ onComplete: onTimelineDone });
  tlRef = tl;
  if (import.meta.env.DEV) {
    debugWindow().__btDebug.slow = (s: number) => {
      tl.timeScale(s);
      onSlow?.(s);
    };
  }

  // 锁定
  tl.to(reticle, { alpha: 1, duration: 0.12 }, 0);
  tl.fromTo(reticle.scale, { x: 1.8, y: 1.8 }, { x: 1, y: 1, duration: 0.38, ease: 'power3.out' }, 0);
  repeats.push(gsap.to(ring, { rotation: Math.PI * 2, duration: 1.4, repeat: -1, ease: 'none' }));
  repeats.push(gsap.to(brackets, { rotation: -Math.PI * 2, duration: 2.2, repeat: -1, ease: 'none' }));
  repeats.push(gsap.to(sweep, { rotation: Math.PI * 2, duration: 1.1, repeat: -1, ease: 'none' }));
  tl.to(inner, { alpha: 0.25, duration: 0.05, yoyo: true, repeat: 3 }, 0.38);
  tl.fromTo(ping, { alpha: 0.9 }, { alpha: 0, duration: 0.3, ease: 'power2.out' }, 0.4);
  tl.fromTo(ping.scale, { x: 0.4, y: 0.4 }, { x: 1.7, y: 1.7, duration: 0.3, ease: 'power2.out' }, 0.4);
  tl.to(lockText, { alpha: 1, duration: 0.15 }, 0.45);

  // 战机环绕掠场（0.3s 入场 → 2.2s 爬升离场），近目标处放大
  tl.to(
    jet,
    {
      motionPath: { path: flightPath, curviness: 1.3 },
      duration: FLIGHT_DUR,
      ease: 'none',
      onUpdate: flyUpdate,
    },
    0.3,
  );
  // 距离感：远小近大，掠过目标时放大到 1.7 倍再收回
  tl.fromTo(jet.scale, { x: 0.5, y: 0.5 }, { x: 1.7, y: 1.7, duration: 0.78, ease: 'power1.in' }, 0.3);
  tl.to(jet.scale, { x: 1.05, y: 1.05, duration: FLIGHT_DUR - 0.78, ease: 'power2.out' }, 0.3 + 0.78);
  repeats.push(gsap.to(jetBody, { y: 7, duration: 0.35, yoyo: true, repeat: 8, ease: 'sine.inOut' }));
  repeats.push(gsap.to(exhausts[0], { alpha: 0.55, duration: 0.07, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
  repeats.push(gsap.to(exhausts[1], { alpha: 0.5, duration: 0.11, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
  repeats.push(gsap.to(exhausts[2], { alpha: 0.4, duration: 0.09, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
  repeats.push(gsap.to(navLight, { alpha: 0.05, duration: 0.35, yoyo: true, repeat: -1, ease: 'none' }));
  repeats.push(gsap.to(bombCore, { alpha: 0.3, duration: 0.16, yoyo: true, repeat: -1, ease: 'none' }));
  repeats.push(gsap.to(bombAura.scale, { x: 1.55, y: 1.55, duration: 0.22, yoyo: true, repeat: -1, ease: 'sine.inOut' }));

  // 投弹（1.0s）：从低空掠过位置抛出，弹体加速坠向目标
  tl.call(
    () => {
      bomb.visible = true;
      bomb.position.set(jet.x, jet.y + jetBody.y);
      spawn({
        parent: fx, tex: softTexture('#bff4ff'), x: bomb.x, y: bomb.y,
        life: 0.18, sc0: 0.3, sc1: 1.2, a0: 0.9, additive: true,
      });
    },
    [],
    RELEASE_AT,
  );
  tl.to(bomb, { x: tx, duration: BOMB_FALL, ease: 'power1.inOut', onUpdate: emitBombTrail }, RELEASE_AT);
  tl.to(bomb, { y: ty, duration: BOMB_FALL, ease: 'power2.in' }, RELEASE_AT);
  tl.fromTo(bomb, { rotation: -0.5 * dir }, { rotation: -0.05 * dir, duration: BOMB_FALL, ease: 'power1.in' }, RELEASE_AT);
  // 倒计时环随弹坠落收紧，命中瞬间消散
  tl.fromTo(incoming, { alpha: 0 }, { alpha: 1, duration: 0.12 }, RELEASE_AT);
  tl.fromTo(
    incoming.scale,
    { x: 3.4, y: 3.4 },
    { x: 0.9, y: 0.9, rotation: Math.PI, duration: BOMB_FALL, ease: 'power1.in' },
    RELEASE_AT,
  );
  tl.to(incoming, { alpha: 0, duration: 0.12 }, IMPACT_AT);
  tl.call(() => {
    laser.visible = true;
    laserOn = true;
  }, [], RELEASE_AT);
  tl.call(() => {
    laserOn = false;
    laser.visible = false;
    bomb.visible = false; // 起爆即消耗弹体，避免残留在爆点上
  }, [], IMPACT_AT);

  // 起爆（1.6s）
  tl.to(reticle, { alpha: 0, duration: 0.12 }, IMPACT_AT - 0.08);
  tl.call(explode, [], IMPACT_AT);
  tl.call(() => void sfxBoom(), [], IMPACT_AT);

  // 镜头震动（仅特效层内部，不影响桌面）
  for (let i = 0; i < 7; i++) {
    const decay = 1 - i / 7;
    tl.to(shakeWrap, { x: rand(-10, 10) * decay, y: rand(-7, 7) * decay, duration: 0.045, ease: 'none' }, IMPACT_AT + i * 0.045);
  }
  tl.to(shakeWrap, { x: 0, y: 0, duration: 0.05 }, IMPACT_AT + 7 * 0.045);

  // 烟雾与余烬（2.0s 起，全部在 3.05s 前耗散）
  tl.call(
    () => {
      for (let i = 0; i < 10; i++) {
        spawn({
          parent: fx,
          tex: smokePuffTexture(),
          x: tx + rand(-30, 30),
          y: ty + rand(-14, 10),
          vx: rand(-45, 45),
          vy: rand(-95, -35),
          g: -12,
          drag: 1.1,
          delay: rand(0, 0.2),
          life: rand(0.55, 0.8),
          sc0: rand(0.9, 1.3),
          sc1: rand(2.4, 3.4),
          a0: 0.45,
          a1: 0,
          fadeIn: 0.18,
          rot: rand(0, Math.PI * 2),
          spin: rand(-1.4, 1.4),
          tint: pick(SMOKE_TINTS),
        });
      }
      for (let i = 0; i < 14; i++) {
        spawn({
          parent: fx,
          tex: softTexture('#ffb054'),
          x: tx + rand(-26, 26),
          y: ty + rand(-10, 12),
          vx: rand(-30, 30),
          vy: rand(-70, -20),
          g: -20,
          drag: 0.8,
          delay: rand(0, 0.35),
          life: rand(0.45, 0.7),
          sc0: rand(0.12, 0.3),
          sc1: 0.02,
          a0: 0.9,
          additive: true,
          tint: pick(EMBER_TINTS),
        });
      }
    },
    [],
    2.0,
  );

  // 占位到 END_AT，保证时间轴总长约 3.05s
  tl.to({}, { duration: 0.001 }, END_AT);
  return tl;
}
