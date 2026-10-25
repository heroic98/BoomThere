import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { softTexture, ringTexture, flameTexture, smokePuffTexture, streakTexture, spawn, destroyAllParticles, requestFinishWhenDrained } from './particles';
import { initAudio, sfxJet, sfxBoom, stopAllAudio } from './audio';

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

const JET_DRAW_SCALE = 0.16; // 精灵画布(1024宽) → 世界约160px
const JET_LEN = 70; // 机头到机身原点的世界距离（激光原点用）

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

// ---- 高分辨率程序化战机贴图（电影质感：渐变蒙皮/镜面高光/座舱玻璃/蒙皮线） ----
let jetTexCache: Texture | null = null;

function jetTexture(): Texture {
  if (jetTexCache) return jetTexCache;
  const W = 1024;
  const H = 448;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;

  // 机身轮廓（供填充/描边/裁剪复用）
  const traceFuselage = (): void => {
    c.beginPath();
    c.moveTo(945, 224);
    c.quadraticCurveTo(860, 196, 770, 193);
    c.quadraticCurveTo(700, 186, 640, 192);
    c.quadraticCurveTo(520, 196, 420, 200);
    c.lineTo(180, 202);
    c.quadraticCurveTo(140, 204, 132, 210);
    c.lineTo(132, 238);
    c.quadraticCurveTo(150, 250, 220, 252);
    c.quadraticCurveTo(420, 262, 620, 254);
    c.quadraticCurveTo(820, 248, 945, 224);
    c.closePath();
  };

  // 远侧垂尾（暗色）
  let g = c.createLinearGradient(240, 210, 150, 115);
  g.addColorStop(0, '#6b7688');
  g.addColorStop(1, '#39445a');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(250, 208);
  c.lineTo(172, 120);
  c.lineTo(140, 118);
  c.lineTo(196, 206);
  c.closePath();
  c.fill();

  // 远侧翼影
  c.fillStyle = 'rgba(58,68,88,.9)';
  c.beginPath();
  c.moveTo(600, 250);
  c.lineTo(430, 315);
  c.lineTo(360, 315);
  c.lineTo(520, 250);
  c.closePath();
  c.fill();

  // 机身主体：珍珠白装甲渐变
  g = c.createLinearGradient(0, 188, 0, 260);
  g.addColorStop(0, '#f7f9fd');
  g.addColorStop(0.35, '#e8eef7');
  g.addColorStop(0.7, '#c4cddf');
  g.addColorStop(1, '#8e9cb5');
  traceFuselage();
  c.fillStyle = g;
  c.fill();

  // 腹部环境光遮蔽 + 脊线镜面高光（裁剪进机身内绘制）
  c.save();
  traceFuselage();
  c.clip();
  g = c.createRadialGradient(620, 300, 10, 620, 300, 130);
  g.addColorStop(0, 'rgba(30,42,66,.30)');
  g.addColorStop(1, 'rgba(30,42,66,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'screen';
  g = c.createLinearGradient(0, 192, 0, 214);
  g.addColorStop(0, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(160, 190, 780, 26);
  c.globalCompositeOperation = 'source-over';
  // 金属颗粒质感
  c.fillStyle = 'rgba(40,52,74,.05)';
  for (let i = 0; i < 240; i++) {
    c.fillRect(140 + Math.random() * 800, 190 + Math.random() * 66, 2, 2);
  }
  c.restore();

  // 红色鼻锥
  g = c.createLinearGradient(830, 200, 945, 224);
  g.addColorStop(0, '#b52c2c');
  g.addColorStop(0.6, '#e84545');
  g.addColorStop(1, '#f06a5a');
  c.beginPath();
  c.moveTo(945, 224);
  c.quadraticCurveTo(882, 200, 848, 202);
  c.lineTo(848, 246);
  c.quadraticCurveTo(884, 248, 945, 224);
  c.closePath();
  c.fillStyle = g;
  c.fill();

  // 座舱玻璃（深蓝渐变 + 青色底光 + 强反光）
  const traceCanopy = (): void => {
    c.beginPath();
    c.moveTo(772, 197);
    c.quadraticCurveTo(700, 181, 636, 189);
    c.quadraticCurveTo(640, 207, 662, 210);
    c.lineTo(744, 208);
    c.quadraticCurveTo(768, 205, 772, 197);
    c.closePath();
  };
  traceCanopy();
  g = c.createLinearGradient(0, 182, 0, 210);
  g.addColorStop(0, '#bfeaff');
  g.addColorStop(0.45, '#2f6f9c');
  g.addColorStop(1, '#0c1c2e');
  c.fillStyle = g;
  c.fill();
  c.save();
  traceCanopy();
  c.clip();
  c.globalAlpha = 0.75;
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.ellipse(700, 193, 52, 5, -0.06, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = 0.5;
  c.beginPath();
  c.ellipse(660, 203, 14, 2.6, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  traceCanopy();
  c.strokeStyle = '#1a2536';
  c.lineWidth = 2.5;
  c.stroke();

  // 进气口（暗腔 + 红唇口）
  c.beginPath();
  c.moveTo(610, 238);
  c.lineTo(560, 252);
  c.lineTo(610, 254);
  c.closePath();
  c.fillStyle = '#2b3550';
  c.fill();
  c.strokeStyle = '#e23c3c';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(610, 238);
  c.lineTo(560, 252);
  c.stroke();

  // 尾部发动机舱 + 双喷口（暗腔 + 青色芯）
  c.fillStyle = '#39445a';
  c.fillRect(132, 202, 74, 50);
  c.strokeStyle = '#20293c';
  c.lineWidth = 2;
  c.strokeRect(132, 202, 74, 50);
  for (const ny of [216, 240]) {
    c.beginPath();
    c.arc(148, ny, 13, 0, Math.PI * 2);
    g = c.createRadialGradient(148, ny, 1, 148, ny, 13);
    g.addColorStop(0, '#bff4ff');
    g.addColorStop(0.35, '#2f7f8f');
    g.addColorStop(0.75, '#141821');
    g.addColorStop(1, '#0a0d14');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = '#0b0f18';
    c.lineWidth = 2.5;
    c.stroke();
  }

  // 近侧主翼（后掠 + 红前缘）
  c.beginPath();
  c.moveTo(600, 240);
  c.lineTo(420, 318);
  c.lineTo(330, 322);
  c.lineTo(300, 310);
  c.lineTo(470, 236);
  c.closePath();
  g = c.createLinearGradient(600, 240, 330, 322);
  g.addColorStop(0, '#f2f5fa');
  g.addColorStop(1, '#a9b5c9');
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = '#2a3242';
  c.lineWidth = 3;
  c.stroke();
  c.strokeStyle = '#e23c3c';
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(600, 242);
  c.lineTo(420, 318);
  c.lineTo(332, 322);
  c.stroke();

  // 翼下挂弹
  c.fillStyle = '#e8edf5';
  c.strokeStyle = '#3a4356';
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(430, 298, 128, 16, 8);
  c.fill();
  c.stroke();
  c.fillStyle = '#e23c3c';
  c.beginPath();
  c.moveTo(558, 306);
  c.lineTo(576, 306);
  c.lineTo(558, 298);
  c.lineTo(558, 314);
  c.closePath();
  c.fill();

  // 近侧垂尾（白装甲 + 红前缘 + 黄 V 鳍尖）
  c.beginPath();
  c.moveTo(240, 206);
  c.lineTo(160, 108);
  c.lineTo(126, 106);
  c.lineTo(178, 204);
  c.closePath();
  g = c.createLinearGradient(240, 206, 150, 110);
  g.addColorStop(0, '#f4f7fb');
  g.addColorStop(1, '#b7c2d4');
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = '#2a3242';
  c.lineWidth = 3;
  c.stroke();
  c.strokeStyle = '#e23c3c';
  c.lineWidth = 8;
  c.beginPath();
  c.moveTo(238, 204);
  c.lineTo(162, 110);
  c.stroke();
  c.fillStyle = '#f5b90f';
  c.beginPath();
  c.moveTo(148, 122);
  c.lineTo(160, 108);
  c.lineTo(170, 124);
  c.lineTo(158, 128);
  c.closePath();
  c.fill();

  // 背鳍天线
  c.strokeStyle = '#39445a';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(500, 196);
  c.lineTo(472, 166);
  c.stroke();

  // 蒙皮拼接线（低透明度弧线）
  c.strokeStyle = 'rgba(30,40,60,.18)';
  c.lineWidth = 2;
  for (const px of [760, 660, 560, 460, 360, 260]) {
    c.beginPath();
    c.moveTo(px + 8, 193);
    c.quadraticCurveTo(px - 6, 226, px + 8, 256);
    c.stroke();
  }
  c.beginPath();
  c.moveTo(200, 220);
  c.quadraticCurveTo(560, 230, 860, 222);
  c.strokeStyle = 'rgba(30,40,60,.12)';
  c.stroke();

  // 编队灯
  c.fillStyle = 'rgba(111,232,255,.95)';
  c.fillRect(698, 212, 26, 4);
  c.fillRect(252, 208, 20, 4);
  c.fillStyle = 'rgba(226,60,60,.9)';
  c.fillRect(856, 232, 14, 4);

  // 整体外轮廓 + 顶部轮廓光
  traceFuselage();
  c.strokeStyle = 'rgba(38,46,64,.9)';
  c.lineWidth = 3.5;
  c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.7)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(938, 222);
  c.quadraticCurveTo(860, 196, 770, 193);
  c.quadraticCurveTo(700, 186, 640, 192);
  c.quadraticCurveTo(520, 196, 420, 200);
  c.lineTo(182, 202);
  c.stroke();

  jetTexCache = Texture.from(cv);
  return jetTexCache;
}

/**
 * 机甲战机（侧视，朝 +x 方向）：高分辨率程序化贴图 +
 * 双喷口加力焰 / 尾焰锥 / 翼尖航行灯（动态元素挂世界坐标，不随贴图缩放）。
 */
function drawJet(): { node: Container; exhausts: Sprite[]; navLight: Sprite } {
  const node = new Container();

  const art = new Sprite(jetTexture());
  art.anchor.set(0.5);
  art.scale.set(JET_DRAW_SCALE);
  node.addChild(art);

  // 双喷口加力焰（画布喷口 x=148 → 世界偏移 -58）
  const exhausts: Sprite[] = [];
  for (const [ex, ey, es, col] of [
    [-58, -2.6, 1.35, '#ff9a3c'],
    [-58, 2.6, 1.0, '#ffe2b0'],
  ] as Array<[number, number, number, string]>) {
    const s = new Sprite(softTexture(col));
    s.anchor.set(0.5);
    s.position.set(ex, ey);
    s.scale.set(es);
    s.blendMode = 'add';
    s.alpha = 0.8;
    node.addChild(s);
    exhausts.push(s);
  }

  // 尾焰拉长锥（马赫环感）：头部贴喷口，向后渐隐
  const cone = new Sprite(streakTexture());
  cone.anchor.set(1, 0.5);
  cone.position.set(-62, 0);
  cone.scale.set(1.0, 0.8);
  cone.blendMode = 'add';
  cone.alpha = 0.65;
  cone.tint = 0xffb46a;
  node.addChild(cone);
  exhausts.push(cone);

  // 翼尖航行灯（青色，闪烁）——近翼翼尖画布(330,318) → 世界(-29,15)
  const navLight = new Sprite(softTexture('#6fe8ff'));
  navLight.anchor.set(0.5);
  navLight.position.set(-29, 15);
  navLight.scale.set(0.35);
  navLight.blendMode = 'add';
  node.addChild(navLight);

  return { node, exhausts, navLight };
}

/** 机甲风智能炸弹：白装甲弹体 + 红鼻锥 + 红黄尾翼 + 青色能量芯 + 等离子光环。 */
function drawBomb(): { node: Container; core: Sprite; aura: Sprite } {
  const node = new Container();
  const g = new Graphics();
  g.ellipse(0, 2, 5.5, 10).fill({ color: HULL_MID }); // 弹体，尖头朝下
  g.ellipse(0, -1.5, 5.2, 6).fill({ color: ARMOR }); // 上段白装甲
  g.circle(0, 10.5, 3.2).fill({ color: ACCENT_RED }); // 引信帽
  g.moveTo(-2, -6).lineTo(-9, -14).lineTo(-3.5, -12).closePath().fill({ color: ACCENT_RED }); // 尾翼
  g.moveTo(2, -6).lineTo(9, -14).lineTo(3.5, -12).closePath().fill({ color: ACCENT_RED });
  g.moveTo(-1, -7).lineTo(0, -15).lineTo(1, -7).closePath().fill({ color: ACCENT_YELLOW }); // 中央小翼
  g.ellipse(-2.2, 0, 1.3, 5.5).fill({ color: 0xffffff, alpha: 0.3 }); // 侧高光
  node.addChild(g);

  const core = new Sprite(softTexture('#6fe8ff'));
  core.anchor.set(0.5);
  core.position.set(0, 1);
  core.scale.set(0.28, 0.8);
  core.blendMode = 'add';
  core.alpha = 0.95;
  node.addChild(core);

  // 弹头等离子光环（起爆前最亮的目标点）
  const aura = new Sprite(softTexture('#7fe7ff'));
  aura.anchor.set(0.5);
  aura.position.set(0, 8);
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
  // 贴图已按 JET_DRAW_SCALE 内部缩放，这里只做方向镜像（座舱朝上）
  jetBody.scale.x = dir;
  jet.addChild(jetBody);

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
  bomb.scale.set(1.45);
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
    // 镜像机身：机头始终对齐航向且座舱朝上
    jet.rotation = dir === 1 ? ang : ang + Math.PI;
    const len = Math.hypot(vx, vy) || 1;
    const nx = vx / len;
    const ny = vy / len;
    const sc = jet.scale.x;
    // 发动机尾焰（喷口沿反航向）
    const tailX = jet.x - nx * 58 * sc;
    const tailY = jet.y - ny * 58 * sc;
    spawn({
      parent: fx,
      tex: softTexture('#ff9a3c'),
      x: tailX + rand(-3, 3),
      y: tailY + rand(-3, 3),
      vx: -nx * rand(90, 160),
      vy: -ny * rand(90, 160),
      life: rand(0.22, 0.38),
      sc0: 0.7,
      sc1: 0.05,
      a0: 0.85,
      additive: true,
      tint: 0xffa64d,
    });
    // 白热核心
    spawn({
      parent: fx,
      tex: softTexture('#ffe9c8'),
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
    const tail = 19 * bomb.scale.x; // 弹体放大后的尾部世界偏移
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
