import { Application, Container, Graphics, Sprite, Text, Texture, Ticker } from 'pixi.js';
import gsap from 'gsap';
import { isAirstrikeRunning } from './airstrike';
import { isMenuAnimating, isMenuOpen } from './menu';
import { initAudio, sfxChomp, sfxHooves, sfxStomp } from './audio';
import { destroyAllParticles, requestFinishWhenDrained, ringTexture, smokePuffTexture, softTexture, spawn } from './particles';
import { ALL_FRAMES, ART_CX, ART_GROUND, ART_H, ART_W, RUN_FRAMES, RUN_NAMES, VARIANTS, drawAnimal, type AnimalKind, type FrameName } from './stampedeArt';

/** 牛马显示尺寸（相对逻辑画布）。 */
const SIZE = 0.62;
/**
 * 烘焙倍率：按「显示尺寸 × 设备像素比」反推，既保证高分屏下描边清晰，
 * 又不会像固定 2x 那样为 10 头牛马 × 多帧多花色浪费显存。
 */
const BAKE = Math.min(2, Math.max(1, SIZE * Math.min(window.devicePixelRatio || 1, 2) * 1.15));
const textureCache = new Map<string, Texture>();
let running = false;
const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function animalTexture(kind: AnimalKind, frame: FrameName, variant: number): Texture {
  const key = `${kind}:${variant}:${frame}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(ART_W * BAKE);
  cv.height = Math.ceil(ART_H * BAKE);
  const ctx = cv.getContext('2d')!;
  ctx.scale(BAKE, BAKE);
  drawAnimal(ctx, kind, frame, variant);
  const tex = Texture.from(cv);
  textureCache.set(key, tex);
  return tex;
}

/** 碎土块贴图：不规则多边形。 */
function chipTexture(): Texture {
  const cached = textureCache.get('chip');
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const ctx = cv.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(3, 5); ctx.lineTo(9, 2); ctx.lineTo(14, 6); ctx.lineTo(12, 13); ctx.lineTo(5, 14); ctx.closePath();
  ctx.fillStyle = '#5c4532';
  ctx.fill();
  ctx.fillStyle = '#8a6b4c';
  ctx.beginPath(); ctx.moveTo(4, 5); ctx.lineTo(9, 3); ctx.lineTo(10, 7); ctx.closePath(); ctx.fill();
  const tex = Texture.from(cv);
  textureCache.set('chip', tex);
  return tex;
}

/** 草屑：嚼草时飞出的小绿片。 */
function leafTexture(): Texture {
  const cached = textureCache.get('leaf');
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 12;
  const ctx = cv.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(2, 10);
  ctx.quadraticCurveTo(6, 1, 11, 3);
  ctx.quadraticCurveTo(7, 8, 2, 10);
  ctx.closePath();
  ctx.fillStyle = '#6aa83e';
  ctx.fill();
  ctx.strokeStyle = '#2f4a1d';
  ctx.lineWidth = 1;
  ctx.stroke();
  const tex = Texture.from(cv);
  textureCache.set('leaf', tex);
  return tex;
}

const shadowTexture = (): Texture => softTexture('#1e1612', 'puff');

export function prewarmStampedeAssets(): Texture[] {
  const textures: Texture[] = [];
  for (const kind of ['cow', 'horse'] as AnimalKind[]) {
    for (let v = 0; v < VARIANTS; v++) {
      for (const f of ALL_FRAMES) textures.push(animalTexture(kind, f, v));
    }
  }
  textures.push(chipTexture(), leafTexture(), shadowTexture(), ringTexture('#d8b98e'), smokePuffTexture());
  return textures;
}

/** 地裂纹：从中心放射的锯齿线，按进度逐步延伸（透视压扁）。 */
function makeCracks(): Array<Array<[number, number]>> {
  const rays: Array<Array<[number, number]>> = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.25, 0.25);
    const len = rand(48, 92);
    const pts: Array<[number, number]> = [[0, 0]];
    let ang = a;
    for (let s = 1; s <= 5; s++) {
      ang += rand(-0.35, 0.35);
      const r = (len * s) / 5;
      pts.push([Math.cos(ang) * r, Math.sin(ang) * r * 0.4]);
    }
    rays.push(pts);
  }
  return rays;
}

function drawCracks(g: Graphics, rays: Array<Array<[number, number]>>, progress: number): void {
  g.clear();
  for (const width of [3.2, 1.4]) {
    for (const pts of rays) {
      const segs = (pts.length - 1) * progress;
      g.moveTo(pts[0][0], pts[0][1]);
      for (let s = 1; s < pts.length; s++) {
        const k = Math.min(1, segs - (s - 1));
        if (k <= 0) break;
        const [x0, y0] = pts[s - 1];
        const [x1, y1] = pts[s];
        g.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
      }
    }
    g.stroke(width > 2
      ? { width, color: 0x3b2a1e, alpha: 0.72, cap: 'round', join: 'round' }
      : { width, color: 0xc9a77c, alpha: 0.5, cap: 'round', join: 'round' });
  }
}

/** 一次蹄击的落点特效：压扁尘环 + 贴地扬尘 + 飞溅碎土。 */
function impactFx(parent: Container, x: number, y: number, heavy: boolean): void {
  const puff = smokePuffTexture();
  const ring = ringTexture('#d8b98e');
  spawn({ parent, tex: ring, x, y, life: heavy ? 0.7 : 0.45, sc0: 0.15, sc1: heavy ? 2.1 : 1.05, sy0: 0.05, sy1: heavy ? 0.66 : 0.32, a0: heavy ? 0.85 : 0.6, easeOut: true });
  if (heavy) {
    spawn({ parent, tex: ring, x, y, delay: 0.08, life: 0.9, sc0: 0.2, sc1: 3, sy0: 0.06, sy1: 0.9, a0: 0.45, easeOut: true });
    spawn({ parent, tex: softTexture('#ffe2b0'), x, y: y - 6, life: 0.35, sc0: 1.4, sc1: 2.6, sy0: 0.5, sy1: 0.9, a0: 0.55, additive: true });
  }
  const dustN = heavy ? 18 : 7;
  for (let i = 0; i < dustN; i++) {
    const a = (i / dustN) * Math.PI * 2 + rand(-0.2, 0.2);
    const sp = rand(80, heavy ? 260 : 170);
    spawn({
      parent, tex: puff, x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 4,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.3 - rand(10, 40), g: -12, drag: 2.6,
      life: rand(0.7, heavy ? 1.5 : 1.05), sc0: rand(0.18, 0.3), sc1: rand(0.8, heavy ? 1.7 : 1.2),
      a0: 0.6, tint: 0xc8a77e, rot: rand(0, 6), spin: rand(-1, 1), fadeIn: 0.06,
    });
  }
  const chipN = heavy ? 14 : 5;
  for (let i = 0; i < chipN; i++) {
    spawn({
      parent, tex: chipTexture(), x: x + rand(-14, 14), y: y - 2,
      vx: rand(-150, 150), vy: -rand(120, heavy ? 330 : 240), g: 950,
      life: rand(0.45, 0.7), sc0: rand(0.5, 0.95), sc1: rand(0.4, 0.8), a0: 1, a1: 0.6,
      rot: rand(0, 6), spin: rand(-12, 12),
    });
  }
}

// ---------------- 草丛 ----------------

interface GrassBlade {
  bx: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  w: number;
  color: number;
}

interface Grass {
  node: Graphics;
  count: number;
  /** 画出前 n 根草（n 递减表示被吃掉） */
  redraw(n: number): void;
}

const GRASS_COLORS = [0x5f9d3a, 0x7dbb47, 0x4c8a2e, 0x8fce55, 0x6cb03f];

/** 一小撮草：泥土 + 十几根带弧度的叶片 + 两朵小花。 */
function buildGrass(): Grass {
  const node = new Graphics();
  const blades: GrassBlade[] = [];
  // 后排先画（更高、更暗），模拟层次
  for (let i = 0; i < 18; i++) {
    const bx = rand(-26, 26);
    const back = i < 8;
    const h = rand(back ? 26 : 16, back ? 46 : 34);
    const lean = rand(-16, 16);
    blades.push({
      bx,
      cx: bx + lean * 0.35 + rand(-3, 3),
      cy: -h * 0.55,
      tx: bx + lean,
      ty: -h,
      w: rand(3.4, 5),
      color: GRASS_COLORS[i % GRASS_COLORS.length],
    });
  }
  blades.sort((a, b) => a.bx - b.bx);

  const redraw = (n: number): void => {
    node.clear();
    // 土墩
    node.ellipse(0, 1, 30, 8).fill({ color: 0x584028, alpha: 0.5 });
    node.ellipse(0, 0, 24, 6).fill({ color: 0x6b5236, alpha: 0.45 });
    const shown = Math.max(0, Math.min(n, blades.length));
    // 先用统一描边画出全部叶片的轮廓，再叠彩色，保证重叠处干净
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < shown; i++) {
        const b = blades[i];
        node.moveTo(b.bx, 0).quadraticCurveTo(b.cx, b.cy, b.tx, b.ty);
        if (pass === 0) node.stroke({ width: b.w + 2.4, color: 0x24401a, cap: 'round' });
        else node.stroke({ width: b.w, color: b.color, cap: 'round' });
      }
    }
    if (shown > blades.length - 4) {
      // 小花：黄花 + 白花
      for (const [fx, fy, col] of [[-16, -22, 0xffd24a], [18, -18, 0xfff3e0]] as Array<[number, number, number]>) {
        node.circle(fx, fy, 2.6).fill({ color: col }).stroke({ width: 1.4, color: 0x24401a });
      }
    }
  };
  redraw(blades.length);
  return { node, count: blades.length, redraw };
}

/** 白底说话气泡（"！"），带小尾巴。 */
function speechBubble(text: string): Container {
  const c = new Container();
  const t = new Text({
    text,
    style: { fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif', fontSize: 20, fontWeight: '900', fill: 0x3a2a1c },
  });
  t.anchor.set(0.5);
  const w = Math.max(26, t.width + 16);
  const h = t.height + 8;
  const bg = new Graphics();
  bg.roundRect(-w / 2, -h / 2, w, h, 9).fill({ color: 0xfffdf3 }).stroke({ width: 2.4, color: 0x5c412d });
  bg.moveTo(-5, h / 2 - 1).lineTo(1, h / 2 + 10).lineTo(7, h / 2 - 1).closePath()
    .fill({ color: 0xfffdf3 }).stroke({ width: 2.4, color: 0x5c412d });
  c.addChild(bg, t);
  t.position.set(0, -1);
  return c;
}

interface Beast {
  sp: Sprite;
  shadow: Sprite;
  kind: AnimalKind;
  variant: number;
  side: -1 | 1;
  baseY: number;
  running: boolean;
  /** 步频倍率：1 = 奔跑，0.5 = 小跑，0 = 停 */
  speed: number;
  gaitAcc: number;
  frame: number;
  dust: boolean;
}

// 时间轴关键点（秒）
const T_ENTER = 0.3;
const T_BEAT0 = 1.55;
const BEAT_GAP = 0.3;
const BEATS = 7;
const T_FINAL = T_BEAT0 + BEATS * BEAT_GAP + 0.18;
const T_LEAVE = T_FINAL + 0.45;

// —— 彩蛋：一头牛半路拐去吃草 ——
const T_GRASS = T_FINAL + 0.4; // 草丛冒出来
const T_COW_GO = T_LEAVE + 0.2; // 这头牛脱离队伍，小跑过去
const T_COW_NOTICE = T_COW_GO + 1.0; // 站定，愣一下
const T_COW_GRAZE = T_COW_NOTICE + 0.4; // 低头啃
const T_COW_CHEW = T_COW_GRAZE + 0.8; // 抬头嚼
const T_COW_DONE = T_COW_CHEW + 1.25; // 嚼完
const T_COW_RUN = T_COW_DONE + 0.35; // 心满意足接着跑
const T_COW_GONE = T_COW_RUN + 0.95;
const T_END = T_COW_GONE + 0.55;

/**
 * 左右两组各 5 头，头朝目标，前蹄都砸在目标 ±45px 内。
 * 后排（y 小）贴近中心，前排向外让开，避免身体挡住落点。偏移为「左组」坐标，右组镜像。
 */
const SLOTS: Array<[number, number]> = [[-72, -18], [-84, 6], [-124, -30], [-128, 30], [-150, 2]];

function runEffect(app: Application, x: number, y: number): Promise<void> {
  return new Promise((resolve) => {
    const wrap = new Container();
    const ground = new Container();
    const herd = new Container();
    const fx = new Container();
    herd.sortableChildren = true;
    wrap.addChild(ground, herd, fx);
    app.stage.addChild(wrap);
    app.ticker.start();

    // 贴地锁定圈（透视椭圆）+ 向内收拢的四角括号
    const reticle = new Graphics();
    reticle.position.set(x, y);
    reticle.ellipse(0, 0, 92, 32).stroke({ width: 2, color: 0xe9b66f, alpha: 0.8 });
    reticle.ellipse(0, 0, 44, 15).stroke({ width: 1.5, color: 0xffdf9e, alpha: 0.6 });
    reticle.ellipse(0, 0, 8, 3).fill({ color: 0xffdf9e, alpha: 0.8 });
    ground.addChild(reticle);
    const brackets = new Graphics();
    brackets.position.set(x, y);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const bx = sx * 112;
      const by = sy * 44;
      brackets.moveTo(bx, by - sy * 14).lineTo(bx, by).lineTo(bx - sx * 22, by);
    }
    brackets.stroke({ width: 3, color: 0xffd28a, alpha: 0.9, cap: 'round', join: 'round' });
    ground.addChild(brackets);

    const cracks = new Graphics();
    cracks.position.set(x, y);
    const crater = new Graphics();
    crater.position.set(x, y);
    crater.ellipse(0, 0, 40, 14).fill({ color: 0x3b2a1e, alpha: 0.32 });
    crater.ellipse(0, 0, 22, 8).fill({ color: 0x2a1d14, alpha: 0.3 });
    crater.alpha = 0;
    ground.addChild(crater, cracks);
    const rays = makeCracks();
    const crackState = { p: 0 };

    const label = new Text({
      text: '牛马大军 · 踩它！',
      style: { fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif', fontSize: 18, fontWeight: '700', letterSpacing: 3, fill: 0xfff1cf, stroke: { color: 0x5c412d, width: 4 } },
    });
    label.anchor.set(0.5);
    label.position.set(x, y - 150);
    ground.addChild(label);

    const tl = gsap.timeline();
    const extraTweens: gsap.core.Tween[] = [];
    const beasts: Beast[] = [];
    let finished = false;

    // 影子跟随 + 深度排序：牛马走位时脚下影子同步，遮挡关系按 y 排
    const follow = (): void => {
      for (const b of beasts) {
        b.shadow.x = b.sp.x + b.side * -6;
        b.shadow.alpha = b.sp.alpha * (0.5 - (b.baseY - b.sp.y) * 0.012);
        b.sp.zIndex = b.sp.y;
      }
    };
    app.ticker.add(follow);

    const finish = (aborted = false): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(safety);
      app.ticker.remove(follow as (t: Ticker) => void);
      tl.kill();
      extraTweens.forEach((t) => t.kill());
      if (aborted) destroyAllParticles();
      try { wrap.destroy({ children: true, texture: false, textureSource: false }); } catch { /* 已销毁 */ }
      app.render();
      resolve();
    };
    const safety = window.setTimeout(() => finish(true), 16000);

    // —— 锁定 ——
    tl.fromTo(reticle, { alpha: 0 }, { alpha: 1, duration: 0.2 }, 0);
    tl.fromTo(reticle.scale, { x: 1.6, y: 1.6 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(1.6)' }, 0);
    tl.fromTo(brackets, { alpha: 0 }, { alpha: 1, duration: 0.15 }, 0.05);
    tl.fromTo(brackets.scale, { x: 2, y: 2 }, { x: 1, y: 1, duration: 0.5, ease: 'power3.out' }, 0.05);
    tl.fromTo(label, { alpha: 0, y: y - 132 }, { alpha: 1, y: y - 150, duration: 0.35 }, 0.15);
    tl.to(label, { alpha: 0, y: y - 166, duration: 0.4 }, T_FINAL - 0.2);
    tl.to(brackets, { alpha: 0, duration: 0.3 }, T_BEAT0 - 0.1);

    // —— 入场：左右两组相向冲锋 ——
    const W = app.screen.width;
    const H = app.screen.height;
    for (let i = 0; i < SLOTS.length * 2; i++) {
      const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
      const order = Math.floor(i / 2);
      const kind: AnimalKind = (order + (side < 0 ? 0 : 1)) % 2 === 0 ? 'horse' : 'cow';
      const variant = (order + (side > 0 ? 1 : 0)) % VARIANTS;
      const [ox, oy] = SLOTS[order];
      const spotX = x + (side < 0 ? ox : -ox) + rand(-5, 5);
      const spotY = y + oy + rand(-3, 3);
      const startX = side < 0 ? -180 - order * 70 : W + 180 + order * 70;
      const startY = spotY + rand(-26, 26);
      const s = (SIZE / BAKE) * (kind === 'horse' ? 1 : 0.98) * rand(0.94, 1.06);

      const shadow = new Sprite(shadowTexture());
      shadow.anchor.set(0.5);
      shadow.width = 150 * SIZE * 1.1;
      shadow.height = 26;
      shadow.position.set(startX, spotY + 2);
      ground.addChild(shadow);

      const sp = new Sprite(animalTexture(kind, 'run0', variant));
      sp.anchor.set(ART_CX / ART_W, ART_GROUND / ART_H);
      // 左组朝右（正向），右组镜像朝左
      sp.scale.set(side < 0 ? s : -s, s);
      sp.position.set(startX, startY);
      sp.zIndex = spotY;
      herd.addChild(sp);
      const b: Beast = { sp, shadow, kind, variant, side, baseY: spotY, running: true, speed: 1, gaitAcc: 0, frame: Math.floor(rand(0, RUN_FRAMES)), dust: true };
      beasts.push(b);

      // 8 帧飞奔，步频由 speed 控制（小跑/停步时不必重建 tween）
      const gait = gsap.to({}, { duration: 0.062, repeat: -1, onRepeat: () => {
        if (b.speed <= 0) return;
        b.gaitAcc += b.speed;
        if (b.gaitAcc < 1) return;
        b.gaitAcc -= 1;
        b.frame = (b.frame + 1) % RUN_FRAMES;
        sp.texture = animalTexture(kind, RUN_NAMES[b.frame], variant);
        if (b.dust && sp.x > -60 && sp.x < W + 60 && Math.random() < 0.4) {
          spawn({
            parent: fx, tex: smokePuffTexture(), x: sp.x + side * 40, y: sp.y + rand(-2, 3),
            vx: side * 60 + rand(-20, 20), vy: rand(-30, -10), g: -8, drag: 2,
            life: rand(0.5, 0.8), sc0: 0.14, sc1: rand(0.5, 0.75), a0: 0.45, tint: 0xc5a681, rot: rand(0, 6),
          });
        }
      } });
      extraTweens.push(gait);

      const enterAt = T_ENTER + order * 0.08 + (side > 0 ? 0.04 : 0);
      const runDur = 0.95;
      tl.to(sp.position, { x: spotX, y: spotY, duration: runDur, ease: 'power2.out' }, enterAt);
      tl.call(() => { b.speed = 0; b.running = false; sp.texture = animalTexture(kind, 'stand', variant); }, undefined, enterAt + runDur - 0.08);

      // 站定后偶尔眨眼，队伍看起来是活的
      for (const at of [T_BEAT0 + 0.55 + order * 0.12, T_FINAL - 0.75]) {
        tl.call(() => {
          if (b.running) return;
          sp.texture = animalTexture(kind, 'blink', variant);
          window.setTimeout(() => {
            if (!b.running && sp.texture === animalTexture(kind, 'blink', variant)) sp.texture = animalTexture(kind, 'stand', variant);
          }, 110);
        }, undefined, at + rand(0, 0.1));
      }

      // —— 踩踏：两组交替砸向中心，抖动很小以保持节奏齐整 ——
      const jitter = rand(0, 0.035);
      const stomp = (at: number, heavy: boolean): void => {
        const lift = heavy ? 18 : 10;
        const windup = heavy ? 0.32 : 0.2;
        tl.call(() => { sp.texture = animalTexture(kind, 'rear', variant); }, undefined, at - windup + jitter);
        tl.to(sp.position, { y: spotY - lift, duration: windup - 0.06, ease: 'power2.out' }, at - windup + jitter);
        tl.call(() => { sp.texture = animalTexture(kind, 'slam', variant); }, undefined, at - 0.05 + jitter);
        tl.to(sp.position, { y: spotY, duration: 0.05, ease: 'power3.in' }, at - 0.05 + jitter);
        tl.call(() => { if (!b.running) sp.texture = animalTexture(kind, 'stand', variant); }, undefined, at + 0.14);
      };
      for (let k = 0; k < BEATS; k++) {
        if ((k % 2 === 0) === (side < 0)) stomp(T_BEAT0 + k * BEAT_GAP, false);
      }
      stomp(T_FINAL, true);

      // —— 撤离：沿各自方向冲过目标点离场 ——
      const leaveAt = T_LEAVE + order * 0.06 + (side > 0 ? 0.03 : 0);
      tl.call(() => { b.speed = 1; b.running = true; }, undefined, leaveAt);
      tl.to(sp.position, { x: side < 0 ? W + 220 : -220, y: spotY + rand(-30, 30), duration: 1.0, ease: 'power2.in' }, leaveAt);
      tl.to(sp, { alpha: 0, duration: 0.15 }, leaveAt + 0.9);
    }

    // —— 每拍落点特效：集中在目标中心，偏向本拍那一组 ——
    const beatFx = (at: number, side: number, crackTo: number, heavy: boolean): void => {
      tl.call(() => {
        impactFx(fx, x + side * (heavy ? 0 : 14) + rand(-4, 4), y + rand(-3, 3), heavy);
        try { void sfxStomp(heavy); } catch { /* 音频失败不影响视觉 */ }
      }, undefined, at + 0.02);
      tl.to(crackState, { p: crackTo, duration: 0.12, ease: 'power2.out', onUpdate: () => drawCracks(cracks, rays, crackState.p) }, at);
      const amp = heavy ? 9 : 3.5;
      tl.to(wrap, { x: rand(-amp, amp), y: amp * 0.8, duration: 0.04 }, at);
      tl.to(wrap, { x: rand(-amp, amp) * 0.5, y: -amp * 0.3, duration: 0.05 }, at + 0.04);
      tl.to(wrap, { x: 0, y: 0, duration: heavy ? 0.25 : 0.1, ease: 'power2.out' }, at + 0.09);
      tl.fromTo(reticle.scale, { x: heavy ? 1.3 : 1.1, y: heavy ? 1.3 : 1.1 }, { x: 1, y: 1, duration: 0.2, ease: 'power2.out' }, at);
    };
    // 裂纹随拍数逐步延伸，齐踏时一次裂满
    for (let k = 0; k < BEATS; k++) {
      beatFx(T_BEAT0 + k * BEAT_GAP, k % 2 === 0 ? -1 : 1, ((k + 1) / BEATS) * 0.7, false);
    }
    beatFx(T_FINAL, 0, 1, true);
    tl.to(crater, { alpha: 1, duration: 0.12 }, T_FINAL);
    tl.to(reticle, { alpha: 0, duration: 0.35 }, T_FINAL + 0.05);
    tl.to([cracks, crater], { alpha: 0, duration: 0.9 }, T_LEAVE + 0.5);

    // —— 彩蛋：挑一头牛，半路看见草，吃完再跑 ——
    const cowIdx = (() => {
      let best = -1;
      for (let i = 0; i < beasts.length; i++) {
        if (beasts[i].kind !== 'cow') continue;
        if (best < 0 || beasts[i].sp.y > beasts[best].sp.y) best = i;
      }
      return best;
    })();
    if (cowIdx >= 0) {
      const cow = beasts[cowIdx];
      const cowSp = cow.sp;
      // 草长在它撤离方向的前方，屏幕内、不与踩踏中心重叠
      const grassX = Math.min(W - 90, Math.max(90, x - cow.side * rand(210, 280)));
      const grassY = Math.min(H - 60, Math.max(y + 70, y + rand(90, 130)));

      const grass = buildGrass();
      grass.node.position.set(grassX, grassY);
      grass.node.alpha = 0;
      ground.addChild(grass.node);
      const grassShadow = new Sprite(shadowTexture());
      grassShadow.anchor.set(0.5);
      grassShadow.width = 62;
      grassShadow.height = 14;
      grassShadow.position.set(grassX, grassY + 2);
      grassShadow.alpha = 0.35;
      grassShadow.renderable = false;
      ground.addChild(grassShadow);

      // 冒出来：先抽长再回弹，配一圈小土星
      tl.call(() => {
        grassShadow.renderable = true;
        grass.node.scale.set(0.4);
        for (let i = 0; i < 5; i++) {
          spawn({
            parent: fx, tex: softTexture('#fff3b0'), x: grassX + rand(-16, 16), y: grassY - rand(4, 18),
            vx: rand(-30, 30), vy: -rand(30, 70), g: 40, life: rand(0.35, 0.6), sc0: 0.16, sc1: 0.02, a0: 1, additive: true,
          });
        }
      }, undefined, T_GRASS);
      tl.to(grass.node, { alpha: 1, duration: 0.2 }, T_GRASS);
      tl.to(grass.node.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.4)' }, T_GRASS);

      // 拐弯：不再直冲屏幕外，而是小跑到草边（自动镜像朝向草）
      const walkX = grassX - cow.side * 34;
      tl.call(() => {
        cow.speed = 0.55;
        cow.dust = false;
        cowSp.scale.x = Math.abs(cowSp.scale.x) * (grassX > cowSp.x ? 1 : -1);
      }, undefined, T_COW_GO);
      tl.to(cowSp.position, { x: walkX, y: grassY, duration: 0.95, ease: 'power2.out' }, T_COW_GO);
      tl.call(() => { cow.speed = 0; cowSp.texture = animalTexture('cow', 'stand', cow.variant); }, undefined, T_COW_GO + 0.95);

      // 愣一下：头顶冒个「！」
      const bubble = speechBubble('！');
      bubble.position.set(walkX, grassY - 118);
      bubble.alpha = 0;
      herd.addChild(bubble);
      tl.call(() => { cowSp.texture = animalTexture('cow', 'shock', cow.variant); }, undefined, T_COW_NOTICE);
      tl.fromTo(bubble, { alpha: 0, y: grassY - 100 }, { alpha: 1, y: grassY - 118, duration: 0.22, ease: 'back.out(3)' }, T_COW_NOTICE);
      tl.to(bubble, { rotation: 0.12, duration: 0.12, yoyo: true, repeat: 5, ease: 'sine.inOut' }, T_COW_NOTICE + 0.2);

      // 低头开吃
      tl.call(() => {
        cowSp.texture = animalTexture('cow', 'graze', cow.variant);
        cowSp.scale.x = Math.abs(cowSp.scale.x) * (grassX > cowSp.x ? 1 : -1);
      }, undefined, T_COW_GRAZE);
      tl.call(() => {
        spawn({ parent: fx, tex: softTexture('#c8e6a0'), x: grassX, y: grassY - 16, life: 0.3, sc0: 0.5, sc1: 1.1, a0: 0.6 });
      }, undefined, T_COW_GRAZE + 0.1);

      // 边嚼边把草吃光：草叶一根根消失，绿屑乱飞
      const eatAt = T_COW_CHEW;
      const eatDur = T_COW_DONE - T_COW_CHEW;
      tl.call(() => { cowSp.texture = animalTexture('cow', 'chew0', cow.variant); }, undefined, eatAt);
      const bites = 9;
      for (let i = 1; i <= bites; i++) {
        const at = eatAt + (i / bites) * eatDur;
        tl.call(() => {
          cowSp.texture = animalTexture('cow', i % 2 ? 'chew1' : 'chew0', cow.variant);
          grass.redraw(Math.round(grass.count * (1 - i / bites)));
          try { void sfxChomp(); } catch { /* 音频失败不影响视觉 */ }
          for (let k = 0; k < 3; k++) {
            spawn({
              parent: fx, tex: leafTexture(), x: grassX + rand(-12, 12), y: grassY - rand(8, 24),
              vx: rand(-60, 60), vy: -rand(40, 120), g: 520, life: rand(0.3, 0.6),
              sc0: rand(0.6, 1), sc1: rand(0.5, 0.8), a0: 1, a1: 0.4, rot: rand(0, 6), spin: rand(-8, 8),
            });
          }
        }, undefined, at);
      }
      tl.to(bubble, { alpha: 0, duration: 0.2 }, T_COW_CHEW + 0.3);

      // 吃完：满足地抬头、拍个嗝，草只剩根茬
      tl.call(() => { cowSp.texture = animalTexture('cow', 'chew1', cow.variant); }, undefined, T_COW_DONE);
      tl.call(() => {
        for (let i = 0; i < 4; i++) {
          spawn({
            parent: fx, tex: softTexture('#e5f6d8'), x: grassX + rand(-6, 6), y: grassY - 40,
            vx: rand(-14, 14), vy: -rand(20, 40), life: rand(0.6, 1), sc0: 0.18, sc1: 0.5, a0: 0.5,
          });
        }
      }, undefined, T_COW_DONE + 0.05);
      tl.to(grass.node, { alpha: 0.55, duration: 0.4 }, T_COW_DONE);

      // 心满意足接着跑：先转身，再冲出画面
      tl.call(() => { cow.speed = 1; cow.dust = true; }, undefined, T_COW_RUN);
      tl.to(cowSp.position, { x: grassX + (grassX > x ? 260 : -260), y: grassY - rand(10, 40), duration: 0.9, ease: 'power2.in' }, T_COW_RUN);
      tl.to(cowSp, { alpha: 0, duration: 0.2 }, T_COW_RUN + 0.75);
      tl.to([grass.node, grassShadow], { alpha: 0, duration: 0.5 }, T_COW_RUN + 0.35);
    }

    tl.call(() => requestFinishWhenDrained(() => finish()), undefined, T_END);

    try {
      initAudio();
      tl.call(() => { void sfxHooves(1.25); }, undefined, T_ENTER);
      tl.call(() => { void sfxHooves(1.0); }, undefined, T_LEAVE);
    } catch { /* 音频失败不影响视觉 */ }
  });
}

export function playStampede(app: Application, x: number, y: number): Promise<void> {
  if (running) return Promise.resolve();
  running = true;
  app.ticker.maxFPS = 0;
  return runEffect(app, x, y).finally(() => {
    running = false;
    if (!isAirstrikeRunning() && !isMenuOpen() && !isMenuAnimating()) {
      app.ticker.maxFPS = 0;
      app.ticker.stop();
    }
  });
}

export function isStampedeRunning(): boolean {
  return running;
}
