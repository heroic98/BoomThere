import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import gsap from 'gsap';
import { isAirstrikeRunning } from './airstrike';
import { isMenuAnimating, isMenuOpen } from './menu';
import { initAudio, sfxBeam, sfxUfoHum, sfxZip } from './audio';
import { destroyAllParticles, requestFinishWhenDrained, ringTexture, softTexture, spawn } from './particles';
import { detectAvatar, type PixelImage } from './avatarDetect';
import { UFO_CX, UFO_CY, UFO_EMITTER_Y, UFO_H, UFO_LIGHTS, UFO_W, drawLight, drawUfo } from './ufoArt';

/**
 * 屏幕取样：点击点附近的一块屏幕像素。
 * (x, y) 为取样左上角、scale 为取样像素 / 覆盖层逻辑像素（即 DPI 缩放），
 * 均为覆盖层本地坐标系，便于把识别结果放回原位。
 */
export interface ScreenSample {
  image: PixelImage;
  x: number;
  y: number;
  scale: number;
}
export type CaptureProvider = (x: number, y: number) => Promise<ScreenSample | null>;

let capture: CaptureProvider = async () => null;
/** Tauri 模式接 Rust 截图；浏览器预览模式可接模拟画面。 */
export function setCaptureProvider(p: CaptureProvider): void {
  capture = p;
}

const BAKE = 2;
/** 飞碟显示尺寸（相对逻辑画布） */
const UFO_SCALE = 0.62;
const textureCache = new Map<string, Texture>();
let running = false;
const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function bake(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = w * BAKE;
  cv.height = h * BAKE;
  const ctx = cv.getContext('2d')!;
  ctx.scale(BAKE, BAKE);
  draw(ctx);
  const tex = Texture.from(cv);
  textureCache.set(key, tex);
  return tex;
}

const ufoTexture = (): Texture => bake('ufo', UFO_W, UFO_H, drawUfo);
const lightTexture = (hex: string): Texture => bake(`light:${hex}`, 32, 32, (ctx) => drawLight(ctx, 32, hex));

/** 牵引光束：上窄下宽的梯形，竖向渐变 + 两侧羽化；运行时按高度拉伸。 */
function beamTexture(): Texture {
  return bake('beam', 128, 256, (ctx) => {
    const W = 128;
    const H = 256;
    ctx.beginPath();
    ctx.moveTo(W * 0.38, 0);
    ctx.lineTo(W * 0.62, 0);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.clip();
    const v = ctx.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(220,255,255,0.95)');
    v.addColorStop(0.5, 'rgba(120,235,255,0.55)');
    v.addColorStop(1, 'rgba(90,220,255,0.35)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    // 两侧羽化：中心亮、边缘淡
    ctx.globalCompositeOperation = 'destination-in';
    const h = ctx.createLinearGradient(0, 0, W, 0);
    h.addColorStop(0, 'rgba(0,0,0,0.15)');
    h.addColorStop(0.3, 'rgba(0,0,0,0.85)');
    h.addColorStop(0.5, 'rgba(0,0,0,1)');
    h.addColorStop(0.7, 'rgba(0,0,0,0.85)');
    h.addColorStop(1, 'rgba(0,0,0,0.15)');
    ctx.fillStyle = h;
    ctx.fillRect(0, 0, W, H);
  });
}

export function prewarmUfoAssets(): Texture[] {
  return [ufoTexture(), lightTexture('#7ff6ff'), beamTexture(), ringTexture('#7fe7ff'), softTexture('#9ff2ff')];
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface Target {
  /** 覆盖层逻辑坐标下的目标框 */
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  /** 切下来的头像（无取样时为 null） */
  piece: Texture | null;
  /** 被吸走后留下的黑色空洞 */
  hole: Texture | null;
  found: boolean;
}

/** 从取样中识别并切出目标；均按取样分辨率烘焙，显示时再按 scale 缩回逻辑尺寸。 */
function cutTarget(sample: ScreenSample | null, x: number, y: number): Target {
  if (!sample) {
    const s = 44;
    return { x: x - s / 2, y: y - s / 2, w: s, h: s, radius: 8, piece: null, hole: null, found: false };
  }
  const { image, scale } = sample;
  const px = (x - sample.x) * scale;
  const py = (y - sample.y) * scale;
  const r = detectAvatar(image, px, py);
  // 外扩 1 个物理像素，吃掉抗锯齿边缘
  const pad = 1;
  const bx = Math.max(0, r.x - pad);
  const by = Math.max(0, r.y - pad);
  const bw = Math.min(image.width - bx, r.w + pad * 2);
  const bh = Math.min(image.height - by, r.h + pad * 2);
  const radius = r.radius + pad;

  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);

  const pieceCv = document.createElement('canvas');
  pieceCv.width = bw;
  pieceCv.height = bh;
  const pc = pieceCv.getContext('2d')!;
  roundRectPath(pc, 0, 0, bw, bh, radius);
  pc.clip();
  pc.drawImage(src, bx, by, bw, bh, 0, 0, bw, bh);

  const holeCv = document.createElement('canvas');
  holeCv.width = bw;
  holeCv.height = bh;
  const hc = holeCv.getContext('2d')!;
  // 黑洞：纯黑底，边缘一圈极淡的青色切口余光
  roundRectPath(hc, 0, 0, bw, bh, radius);
  hc.fillStyle = '#000000';
  hc.fill();
  hc.save();
  hc.clip();
  hc.lineWidth = 2 * scale;
  roundRectPath(hc, 0, 0, bw, bh, radius);
  hc.strokeStyle = 'rgba(127,246,255,0.18)';
  hc.stroke();
  hc.restore();

  return {
    x: sample.x + bx / scale,
    y: sample.y + by / scale,
    w: bw / scale,
    h: bh / scale,
    radius: radius / scale,
    piece: Texture.from(pieceCv),
    hole: Texture.from(holeCv),
    found: r.found,
  };
}

// 时间轴关键点（秒）
const T_LOCK = 0;
const T_ARRIVE = 0.35;
const T_BEAM = 1.25;
const T_CUT = 1.6;
const T_LIFT = 2.1;
const T_ABSORB = 3.05;
const T_LEAVE = 3.45;
const T_RESTORE = 4.5;
const T_END = 5.2;

function runEffect(app: Application, x: number, y: number, sample: ScreenSample | null): Promise<void> {
  return new Promise((resolve) => {
    const target = cutTarget(sample, x, y);
    const cx = target.x + target.w / 2;
    const cy = target.y + target.h / 2;
    const side = Math.max(target.w, target.h);

    const wrap = new Container();
    const ground = new Container();
    const beamLayer = new Container();
    const lifted = new Container();
    const ship = new Container();
    const fx = new Container();
    wrap.addChild(ground, beamLayer, lifted, ship, fx);
    app.stage.addChild(wrap);
    app.ticker.start();

    // —— 空洞（初始隐藏，切割瞬间显现）——
    let hole: Sprite | null = null;
    if (target.hole) {
      hole = new Sprite(target.hole);
      hole.position.set(target.x, target.y);
      hole.width = target.w;
      hole.height = target.h;
      hole.alpha = 0;
      ground.addChild(hole);
    }

    // —— 锁定框：四角括号从外向内收拢到目标框 ——
    const brackets = new Graphics();
    brackets.position.set(cx, cy);
    const hb = side / 2 + 6;
    const arm = Math.max(8, side * 0.28);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      brackets.moveTo(sx * hb, sy * hb - sy * arm).lineTo(sx * hb, sy * hb).lineTo(sx * hb - sx * arm, sy * hb);
    }
    brackets.stroke({ width: 3, color: 0x7ff6ff, alpha: 0.95, cap: 'round', join: 'round' });
    ground.addChild(brackets);

    const label = new Text({
      text: target.found ? '目标锁定 · 准备绑架' : '飞碟出动 · 绑架此处',
      style: { fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif', fontSize: 15, fontWeight: '700', letterSpacing: 2, fill: 0xe8fdff, stroke: { color: 0x0f3a4a, width: 4 } },
    });
    label.anchor.set(0.5, 0);
    // 夹在屏幕内，贴边的头像也能看全提示
    const halfLabel = label.width / 2 + 8;
    label.position.set(Math.max(halfLabel, Math.min(app.screen.width - halfLabel, cx)), cy + hb + 10);
    ground.addChild(label);

    // —— 切割线：沿圆角框描一圈 ——
    const cutLine = new Graphics();
    cutLine.position.set(target.x, target.y);
    const cutState = { p: 0 };
    const perimeter = (): Array<[number, number]> => {
      const pts: Array<[number, number]> = [];
      const { w, h } = target;
      const r = Math.min(target.radius, w / 2, h / 2);
      const seg = (x0: number, y0: number, x1: number, y1: number): void => {
        for (let i = 0; i <= 8; i++) pts.push([x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8]);
      };
      const arc = (ax: number, ay: number, a0: number): void => {
        for (let i = 0; i <= 6; i++) {
          const a = a0 + (i / 6) * (Math.PI / 2);
          pts.push([ax + Math.cos(a) * r, ay + Math.sin(a) * r]);
        }
      };
      seg(r, 0, w - r, 0);
      arc(w - r, r, -Math.PI / 2);
      seg(w, r, w, h - r);
      arc(w - r, h - r, 0);
      seg(w - r, h, r, h);
      arc(r, h - r, Math.PI / 2);
      seg(0, h - r, 0, r);
      arc(r, r, Math.PI);
      return pts;
    };
    const path = perimeter();
    const drawCut = (): void => {
      cutLine.clear();
      const n = Math.max(1, Math.floor(path.length * cutState.p));
      cutLine.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < n; i++) cutLine.lineTo(path[i][0], path[i][1]);
      cutLine.stroke({ width: 5, color: 0x7ff6ff, alpha: 0.35, cap: 'round', join: 'round' });
      cutLine.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < n; i++) cutLine.lineTo(path[i][0], path[i][1]);
      cutLine.stroke({ width: 1.8, color: 0xffffff, alpha: 0.95, cap: 'round', join: 'round' });
    };
    fx.addChild(cutLine);

    // —— 被吸起的头像 ——
    const piece = new Container();
    piece.position.set(cx, cy);
    lifted.addChild(piece);
    if (target.piece) {
      const ps = new Sprite(target.piece);
      ps.anchor.set(0.5);
      ps.width = target.w;
      ps.height = target.h;
      piece.addChild(ps);
    } else {
      // 无取样：吸走一团能量球
      const orb = new Sprite(softTexture('#9ff2ff'));
      orb.anchor.set(0.5);
      orb.blendMode = 'add';
      orb.scale.set(side / 40);
      piece.addChild(orb);
    }
    const pieceGlow = new Sprite(softTexture('#9ff2ff'));
    pieceGlow.anchor.set(0.5);
    pieceGlow.blendMode = 'add';
    pieceGlow.scale.set((side / 64) * 2.2);
    pieceGlow.alpha = 0;
    piece.addChildAt(pieceGlow, 0);
    piece.visible = false;

    // —— 飞碟 ——
    const ufo = new Container();
    const body = new Sprite(ufoTexture());
    body.anchor.set(UFO_CX / UFO_W, UFO_CY / UFO_H);
    body.scale.set(1 / BAKE);
    ufo.addChild(body);
    const lights = UFO_LIGHTS.map(([lx, ly]) => {
      const l = new Sprite(lightTexture('#7ff6ff'));
      l.anchor.set(0.5);
      l.scale.set(0.5 / BAKE * 1.6);
      l.position.set(lx, ly);
      l.blendMode = 'add';
      ufo.addChild(l);
      return l;
    });
    ufo.scale.set(UFO_SCALE);
    ship.addChild(ufo);

    const W = app.screen.width;
    // 悬停高度：正常在目标上方约 150px；目标贴近屏幕上沿时飞碟偏到一侧，避免压住目标
    const idealY = cy - 150 - side * 0.4;
    const hoverY = Math.max(56, idealY);
    const hoverX = idealY >= 56 ? cx : cx + (cx > app.screen.width / 2 ? -1 : 1) * (side * 0.6 + 70);
    const emitterY = (): number => ufo.y + UFO_EMITTER_Y * UFO_SCALE;
    const fromLeft = cx > W / 2;
    ufo.position.set(fromLeft ? -200 : W + 200, hoverY - 120);

    // —— 牵引光束 ——
    // 光束：普通混合打底（浅色界面上也看得见）+ 加色亮芯（深色界面上发光）
    const beam = new Container();
    const beamBase = new Sprite(beamTexture());
    beamBase.anchor.set(0.5, 0);
    beamBase.alpha = 0.75;
    const beamCore = new Sprite(beamTexture());
    beamCore.anchor.set(0.5, 0);
    beamCore.blendMode = 'add';
    beamCore.alpha = 0.6;
    beam.addChild(beamBase, beamCore);
    beam.alpha = 0;
    beamLayer.addChild(beam);
    const beamState = { k: 0 };
    const layoutBeam = (): void => {
      // 光束从发射口指向目标底边；飞碟偏到一侧悬停时光束随之倾斜
      const top = emitterY();
      const dx = cx - ufo.x;
      const dy = cy + target.h / 2 + 6 - top;
      const len = Math.max(10, Math.hypot(dx, dy));
      beam.position.set(ufo.x, top);
      beam.rotation = -Math.atan2(dx, dy);
      for (const b of [beamBase, beamCore]) {
        b.height = len * beamState.k;
        b.width = Math.max(side * 1.7, 70) * (0.35 + 0.65 * beamState.k);
      }
    };

    const tl = gsap.timeline();
    const extraTweens: gsap.core.Tween[] = [];
    let finished = false;
    let tick = 0;
    const onTick = (): void => {
      tick++;
      // 舷灯跑马
      lights.forEach((l, i) => { l.alpha = (Math.floor(tick / 5) + i) % 3 === 0 ? 1 : 0.35; });
      if (beamState.k > 0) layoutBeam();
    };
    app.ticker.add(onTick);

    const finish = (aborted = false): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(safety);
      app.ticker.remove(onTick);
      tl.kill();
      extraTweens.forEach((t) => t.kill());
      if (aborted) destroyAllParticles();
      try { wrap.destroy({ children: true, texture: false, textureSource: false }); } catch { /* 已销毁 */ }
      // 切出来的贴图每次都是新的，必须释放
      target.piece?.destroy(true);
      target.hole?.destroy(true);
      app.render();
      resolve();
    };
    const safety = window.setTimeout(() => finish(true), 12000);

    // 锁定
    tl.fromTo(brackets, { alpha: 0 }, { alpha: 1, duration: 0.12 }, T_LOCK);
    tl.fromTo(brackets.scale, { x: 2.4, y: 2.4 }, { x: 1, y: 1, duration: 0.45, ease: 'power3.out' }, T_LOCK);
    tl.to(brackets, { rotation: Math.PI / 2, duration: 0.45, ease: 'power3.out' }, T_LOCK);
    tl.fromTo(label, { alpha: 0, y: label.y + 10 }, { alpha: 1, y: label.y, duration: 0.3 }, T_LOCK + 0.15);
    tl.to(brackets.scale, { x: 1.08, y: 1.08, duration: 0.25, yoyo: true, repeat: 3, ease: 'sine.inOut' }, T_LOCK + 0.45);

    // 入场：弧线俯冲到目标正上方
    tl.to(ufo, { x: hoverX, duration: 0.9, ease: 'power3.out' }, T_ARRIVE);
    tl.to(ufo, { y: hoverY, duration: 0.9, ease: 'back.out(1.4)' }, T_ARRIVE);
    tl.fromTo(ufo, { rotation: fromLeft ? 0.35 : -0.35 }, { rotation: 0, duration: 0.9, ease: 'power2.out' }, T_ARRIVE);
    // 悬停：上下浮动 + 轻微摇摆
    tl.call(() => {
      extraTweens.push(gsap.to(body, { y: 4, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
      extraTweens.push(gsap.to(body, { rotation: 0.04, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
    }, undefined, T_ARRIVE + 0.9);

    // 开光束
    tl.to(beamState, { k: 1, duration: 0.3, ease: 'power2.out', onStart: layoutBeam }, T_BEAM);
    tl.to(beam, { alpha: 1, duration: 0.2 }, T_BEAM);
    tl.to(brackets, { alpha: 0, duration: 0.3 }, T_BEAM + 0.1);
    tl.to(label, { alpha: 0, duration: 0.3 }, T_BEAM + 0.1);
    const ringTex = ringTexture('#7fe7ff');
    for (let i = 0; i < 6; i++) {
      // 光束里自下而上的扫描环
      tl.call(() => spawn({
        parent: fx, tex: ringTex, x: cx, y: cy + target.h / 2, vx: (ufo.x - cx) / 0.6, vy: -(cy + target.h / 2 - emitterY()) / 0.6,
        life: 0.6, sc0: (side * 1.6) / 128, sc1: 0.25, sy0: (side * 0.5) / 128, sy1: 0.08, a0: 0.7, a1: 0, additive: true,
      }), undefined, T_BEAM + 0.25 + i * 0.3);
    }

    // 切割：白光沿圆角框走一圈，火花飞溅
    tl.call(() => { cutState.p = 0; }, undefined, T_CUT);
    tl.to(cutState, {
      p: 1, duration: 0.42, ease: 'none',
      onUpdate: () => {
        drawCut();
        const i = Math.min(path.length - 1, Math.floor(path.length * cutState.p));
        if (tick % 2 === 0) {
          spawn({
            parent: fx, tex: softTexture('#ffffff'), x: target.x + path[i][0], y: target.y + path[i][1],
            vx: rand(-90, 90), vy: rand(-110, 10), g: 300, life: rand(0.2, 0.4), sc0: 0.12, sc1: 0.02, a0: 1, additive: true,
          });
        }
      },
    }, T_CUT);
    tl.call(() => {
      piece.visible = true;
      if (hole) hole.alpha = 1;
      spawn({ parent: fx, tex: softTexture('#e8fdff'), x: cx, y: cy, life: 0.3, sc0: side / 30, sc1: side / 14, a0: 0.9, additive: true });
    }, undefined, T_CUT + 0.42);
    tl.to(cutLine, { alpha: 0, duration: 0.25 }, T_CUT + 0.45);

    // 挣扎：原地抖几下
    tl.to(piece, { x: cx + 2, duration: 0.04, yoyo: true, repeat: 5, ease: 'none' }, T_CUT + 0.45);
    tl.to(piece, { x: cx, duration: 0.02 }, T_CUT + 0.69);

    // 吸起：旋转上升、逐渐缩小，脱离瞬间带阴影跟随
    tl.to(pieceGlow, { alpha: 0.85, duration: 0.3 }, T_LIFT);
    tl.to(piece, { y: () => emitterY() + 6, duration: 0.95, ease: 'power2.in' }, T_LIFT);
    tl.to(piece, { x: () => ufo.x, duration: 0.95, ease: 'sine.inOut' }, T_LIFT);
    tl.to(piece, { rotation: Math.PI * 2.5, duration: 0.95, ease: 'power1.in' }, T_LIFT);
    tl.to(piece.scale, { x: 0.18, y: 0.18, duration: 0.95, ease: 'power2.in' }, T_LIFT);
    for (let i = 0; i < 10; i++) {
      tl.call(() => spawn({
        parent: fx, tex: softTexture('#9ff2ff'), x: piece.x + rand(-side * 0.4, side * 0.4), y: piece.y + rand(-side * 0.3, side * 0.3),
        vy: rand(-180, -90), life: rand(0.35, 0.6), sc0: rand(0.1, 0.18), sc1: 0.02, a0: 0.9, additive: true,
      }), undefined, T_LIFT + i * 0.09);
    }

    // 收入飞碟：发射口闪光、碟身被吸收的冲击压扁回弹
    tl.call(() => {
      piece.visible = false;
      spawn({ parent: fx, tex: softTexture('#ffffff'), x: ufo.x, y: emitterY(), life: 0.35, sc0: 0.6, sc1: 2.2, sy0: 0.3, sy1: 0.8, a0: 1, additive: true });
      spawn({ parent: fx, tex: ringTex, x: ufo.x, y: emitterY(), life: 0.45, sc0: 0.2, sc1: 1.4, sy0: 0.08, sy1: 0.4, a0: 0.9, additive: true, easeOut: true });
    }, undefined, T_ABSORB);
    tl.to(ufo.scale, { x: UFO_SCALE * 1.12, y: UFO_SCALE * 0.86, duration: 0.08 }, T_ABSORB);
    tl.to(ufo.scale, { x: UFO_SCALE, y: UFO_SCALE, duration: 0.45, ease: 'elastic.out(1.2, 0.4)' }, T_ABSORB + 0.08);
    tl.to(beamState, { k: 0, duration: 0.22, ease: 'power2.in' }, T_ABSORB + 0.1);
    tl.to(beam, { alpha: 0, duration: 0.22 }, T_ABSORB + 0.1);

    // 离场：后仰蓄力 → 斜向上加速冲出屏幕，拖出尾迹
    const exitX = fromLeft ? W + 260 : -260;
    tl.to(ufo, { rotation: fromLeft ? -0.25 : 0.25, y: hoverY + 10, duration: 0.18, ease: 'power2.out' }, T_LEAVE);
    tl.to(ufo, { x: exitX, y: -160, rotation: fromLeft ? 0.3 : -0.3, duration: 0.55, ease: 'power3.in' }, T_LEAVE + 0.18);
    for (let i = 0; i < 8; i++) {
      tl.call(() => spawn({
        parent: fx, tex: softTexture('#9ff2ff'), x: ufo.x, y: ufo.y + 6, life: 0.4, sc0: 0.9, sc1: 0.2, sy0: 0.35, sy1: 0.1,
        a0: 0.55, additive: true, rot: Math.atan2(-160 - hoverY, exitX - cx),
      }), undefined, T_LEAVE + 0.3 + i * 0.05);
    }

    // 复原：空洞淡出，原内容回到眼前
    if (hole) tl.to(hole, { alpha: 0, duration: 0.6, ease: 'power1.inOut' }, T_RESTORE);
    tl.call(() => requestFinishWhenDrained(() => finish()), undefined, T_END);

    try {
      initAudio();
      tl.call(() => { void sfxUfoHum(T_LEAVE - T_ARRIVE + 0.3); }, undefined, T_ARRIVE);
      tl.call(() => { void sfxBeam(T_ABSORB - T_BEAM); }, undefined, T_BEAM);
      tl.call(() => { void sfxZip(); }, undefined, T_LEAVE + 0.18);
    } catch { /* 音频失败不影响视觉 */ }
  });
}

export async function playUfo(app: Application, x: number, y: number): Promise<void> {
  if (running) return;
  running = true;
  app.ticker.maxFPS = 0;
  try {
    let sample: ScreenSample | null = null;
    try { sample = await capture(x, y); } catch { /* 取样失败按无目标演出 */ }
    await runEffect(app, x, y, sample);
  } finally {
    running = false;
    if (!isAirstrikeRunning() && !isMenuOpen() && !isMenuAnimating()) {
      app.ticker.maxFPS = 0;
      app.ticker.stop();
    }
  }
}

export function isUfoRunning(): boolean {
  return running;
}
