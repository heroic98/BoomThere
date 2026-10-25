import { Application, Container, Sprite, Texture, Ticker } from 'pixi.js';

type TexKind = 'glow' | 'puff';

const texCache = new Map<string, Texture>();

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 程序化生成柔和粒子贴图（径向渐变），零外部素材。
 * glow: 白色高光核心，适合火花/火焰（additive）。
 * puff: 无高光的弥散雾团，适合烟雾。
 */
export function softTexture(hex: string, kind: TexKind = 'glow'): Texture {
  const key = `${kind}:${hex}`;
  const cached = texCache.get(key);
  if (cached) return cached;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  if (kind === 'glow') {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, rgba(hex, 0.95));
    grad.addColorStop(0.72, rgba(hex, 0.32));
    grad.addColorStop(1, rgba(hex, 0));
  } else {
    grad.addColorStop(0, rgba(hex, 0.6));
    grad.addColorStop(0.55, rgba(hex, 0.35));
    grad.addColorStop(1, rgba(hex, 0));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = Texture.from(canvas);
  texCache.set(key, tex);
  return tex;
}

/** 程序化生成扩散圆环贴图（冲击波用）。 */
export function ringTexture(hex: string): Texture {
  const key = `ring:${hex}`;
  const cached = texCache.get(key);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = rgba(hex, 1);
  ctx.lineWidth = 6;
  ctx.shadowColor = rgba(hex, 0.9);
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 10, 0, Math.PI * 2);
  ctx.stroke();

  const tex = Texture.from(canvas);
  texCache.set(key, tex);
  return tex;
}

/**
 * 不规则火球贴图：多个扰动圆叠加出火舌轮廓再径向渐隐。
 * 比纯径向渐变多出真实火焰的湍流感，避免"软圆点"廉价感。
 */
export function flameTexture(): Texture {
  const key = 'flame';
  const cached = texCache.get(key);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 26;
    const r = 14 + Math.random() * 24;
    ctx.beginPath();
    ctx.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d * 0.8, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.5})`;
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size / 2 - 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.65, 'rgba(0,0,0,0.9)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';

  const tex = Texture.from(canvas);
  texCache.set(key, tex);
  return tex;
}

/** 分瓣烟雾团贴图：多团柔和圆错位叠加，带旋转使用时呈真实翻卷感。 */
export function smokePuffTexture(): Texture {
  const key = 'smokepuff';
  const cached = texCache.get(key);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 11; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * 24;
    const r = 14 + Math.random() * 20;
    const cx = size / 2 + Math.cos(a) * d;
    const cy = size / 2 + Math.sin(a) * d;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = Texture.from(canvas);
  texCache.set(key, tex);
  return tex;
}

/** 火花运动模糊条：头部亮、尾部渐隐的拉长光斑（旋转对齐速度方向使用）。 */
export function streakTexture(): Texture {
  const key = 'streak';
  const cached = texCache.get(key);
  if (cached) return cached;

  const w = 128;
  const h = 32;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(3.4, 1);
  const g = ctx.createRadialGradient(0, 0, 1, 0, 0, 18);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 右亮左淡：+x 方向为运动头部
  ctx.globalCompositeOperation = 'destination-out';
  const lg = ctx.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, 'rgba(0,0,0,0.85)');
  lg.addColorStop(0.45, 'rgba(0,0,0,0.2)');
  lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = Texture.from(canvas);
  texCache.set(key, tex);
  return tex;
}

export interface SpawnOptions {
  parent: Container;
  tex: Texture;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** 重力加速度 px/s²，可为负（上浮） */
  g?: number;
  /** 速度阻尼系数 */
  drag?: number;
  /** 延迟出生秒数（用于错峰发射） */
  delay?: number;
  life: number;
  sc0: number;
  sc1: number;
  /** y 轴独立缩放（光柱/等离子流用），缺省与 x 轴一致 */
  sy0?: number;
  sy1?: number;
  a0?: number;
  a1?: number;
  tint?: number;
  additive?: boolean;
  rot?: number;
  spin?: number;
  /** 生命前 fadeIn 比例内淡入 */
  fadeIn?: number;
  /** 缩放/透明度按三次方缓出（冲击波等需要"先快后慢"的元素） */
  easeOut?: boolean;
}

interface Particle {
  sp: Sprite;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  delay: number;
  t: number;
  life: number;
  sx0: number;
  sx1: number;
  sy0: number;
  sy1: number;
  a0: number;
  a1: number;
  spin: number;
  fadeIn: number;
  eo: number;
}

const active: Particle[] = [];
let tickBound = false;
let finishRequested = false;
let finishCallback: (() => void) | null = null;

function tick(ticker: Ticker): void {
  const dt = Math.min(ticker.deltaMS, 50) / 1000;
  for (let i = active.length - 1; i >= 0; i--) {
    const p = active[i];
    if (p.delay > 0) {
      p.delay -= dt;
      if (p.delay <= 0) {
        p.sp.visible = true;
        p.sp.alpha = p.a0;
      }
      continue;
    }
    p.t += dt;
    const kRaw = p.t / p.life;
    if (kRaw >= 1) {
      p.sp.destroy();
      active.splice(i, 1);
      continue;
    }
    const k = p.eo ? 1 - (1 - kRaw) * (1 - kRaw) * (1 - kRaw) : kRaw;
    p.vy += p.g * dt;
    if (p.drag > 0) {
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy *= d;
    }
    p.sp.x += p.vx * dt;
    p.sp.y += p.vy * dt;
    p.sp.rotation += p.spin * dt;
    p.sp.scale.set(p.sx0 + (p.sx1 - p.sx0) * k, p.sy0 + (p.sy1 - p.sy0) * k);
    let a = p.a0 + (p.a1 - p.a0) * k;
    if (p.fadeIn > 0 && k < p.fadeIn) a *= k / p.fadeIn;
    p.sp.alpha = a;
  }
  if (finishRequested && active.length === 0) {
    finishRequested = false;
    const cb = finishCallback;
    finishCallback = null;
    cb?.();
  }
}

export function bindParticles(app: Application): void {
  if (tickBound) return;
  tickBound = true;
  app.ticker.add(tick);
}

export function spawn(o: SpawnOptions): void {
  const sp = new Sprite(o.tex);
  sp.anchor.set(0.5);
  sp.position.set(o.x, o.y);
  sp.tint = o.tint ?? 0xffffff;
  sp.blendMode = o.additive ? 'add' : 'normal';
  sp.scale.set(o.sc0, o.sy0 ?? o.sc0);
  sp.rotation = o.rot ?? 0;
  if ((o.delay ?? 0) > 0) {
    sp.visible = false;
  } else {
    sp.alpha = o.a0 ?? 1;
  }
  o.parent.addChild(sp);
  active.push({
    sp,
    vx: o.vx ?? 0,
    vy: o.vy ?? 0,
    g: o.g ?? 0,
    drag: o.drag ?? 0,
    delay: o.delay ?? 0,
    t: 0,
    life: o.life,
    sx0: o.sc0,
    sx1: o.sc1,
    sy0: o.sy0 ?? o.sc0,
    sy1: o.sy1 ?? o.sc1,
    a0: o.a0 ?? 1,
    a1: o.a1 ?? 0,
    spin: o.spin ?? 0,
    fadeIn: o.fadeIn ?? 0,
    eo: o.easeOut ? 1 : 0,
  });
}

/** 立即销毁所有存活粒子（提前中止时使用）。 */
export function destroyAllParticles(): void {
  for (const p of active) {
    try {
      p.sp.destroy();
    } catch {
      /* 已销毁，忽略 */
    }
  }
  active.length = 0;
}

/**
 * 启动时预热全部特效贴图：现场生成会造成首次点击特效时的卡顿，
 * 提前生成并缓存后，点击时所有贴图都已就绪。
 */
const PREWARM_SOFT = [
  '#ff3b30', '#ff9a3c', '#ffe9c8', '#ffffff', '#ffd9a0', '#fff6e0',
  '#bff4ff', '#6fe8ff', '#7fe7ff', '#ffb054', '#ffe2b0', '#9ff2ff',
];

export function prewarmEffectTextures(): Texture[] {
  const list: Texture[] = [];
  for (const hex of PREWARM_SOFT) {
    list.push(softTexture(hex));
  }
  list.push(softTexture('#9aa2ad', 'puff'));
  list.push(softTexture('#55585e', 'puff'));
  list.push(ringTexture('#fff3e0'), ringTexture('#7fe7ff'));
  list.push(flameTexture(), smokePuffTexture(), streakTexture());
  return list;
}

/**
 * 时间轴播完后调用：等所有粒子自然耗散后回调 finish，
 * 保证结束时既无残留精灵，也无持续 GPU 渲染。
 */
export function requestFinishWhenDrained(cb: () => void): void {
  finishCallback = cb;
  finishRequested = true;
}
