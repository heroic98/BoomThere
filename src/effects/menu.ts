import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import gsap from 'gsap';
import { softTexture } from './particles';

/** 技能注册表条目：轮盘的每一片对应一个特效。 */
export interface EffectDef {
  id: string;
  name: string;
  icon: string; // 矢量图标种类（burst / orbit / missiles / meteor）
  color: number; // 主题色（保留字段）
  enabled: boolean;
  run: (x: number, y: number) => Promise<void>;
}

const R_OUTER = 150; // 轮盘外半径
const R_INNER = 46; // 中央取消区半径
const HOVER_TOL = 44; // 悬停判定外圈容差

// 高达风 Light 主题：白盘 + 高达蓝单主色 + 精密仪表细节
const T = {
  accent: 0x2456e6, // 高达蓝（白底 5.9:1，AA）
  text: 0x27272a, // zinc-800
  icon: 0x52525b, // zinc-600
  textDisabled: 0xa1a1aa, // zinc-400
  iconDisabled: 0xd4d4d8, // zinc-300
  wedgeNormal: 0x1b1f27, // 楔形 tint 基色（白填充 → 极淡灰阶）
  border: 0xe4e4e7, // zinc-200
  tick: 0xc8ccd4, // 刻度灰
  centerText: 0x71717a, // zinc-500
  warn: 0xe5484d, // 警示红（高达红点缀）
};

const registry: EffectDef[] = [];

export function registerEffect(def: EffectDef): void {
  registry.push(def);
}

let appRef: Application | null = null;
let root: Container | null = null;
let sliceGfx: Graphics[] = [];
let sliceIcons: Graphics[] = [];
let sliceLabels: Text[] = [];
let bracketAnchors: Array<{ x: number; y: number }> = [];
let bracket: Graphics | null = null;
let centerRing: Graphics | null = null;
let hovered = -1;
let hoveredRaw = -1;
let centerX = 0;
let centerY = 0;
let openTl: gsap.core.Timeline | null = null;
let hudTweens: gsap.core.Tween[] = [];

export function bindRadialMenu(app: Application): void {
  appRef = app;
}

export function isMenuOpen(): boolean {
  return root !== null;
}

export function lastMenuCenter(): { x: number; y: number } {
  return { x: centerX, y: centerY };
}

/** 矢量图标：直接用 Graphics 以 3px 圆头线绘制，换色即重画（风格统一、零贴图依赖）。 */
function drawIcon(g: Graphics, kind: string, color: number): void {
  g.clear();
  const S = { width: 3, color, cap: 'round', join: 'round' } as const;
  if (kind === 'burst') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      g.moveTo(Math.cos(a) * 7, Math.sin(a) * 7).lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
    }
    g.stroke(S);
    g.circle(0, 0, 3.6).fill({ color });
  } else if (kind === 'orbit') {
    g.circle(0, 0, 7).stroke(S);
    g.ellipse(0, 0, 15, 5.5).stroke(S);
    g.circle(Math.cos(-0.5) * 15, Math.sin(-0.5) * 5.5, 2.6).fill({ color });
  } else if (kind === 'missiles') {
    for (const [mx, my] of [
      [-10, -4],
      [1, 2],
      [11, -6],
    ] as Array<[number, number]>) {
      g.moveTo(mx, my + 7).lineTo(mx - 3.6, my - 3).lineTo(mx + 3.6, my - 3).closePath().fill({ color });
      g.moveTo(mx - 5, my - 8).lineTo(mx - 3, my - 6);
      g.moveTo(mx + 5, my - 8).lineTo(mx + 3, my - 6);
      g.stroke({ ...S, width: 2.2 });
    }
  } else if (kind === 'meteor') {
    g.circle(4.5, 4.5, 7.5).stroke(S);
    g.moveTo(-12, -12).lineTo(-3, -3);
    g.moveTo(-14, -3).lineTo(-7, 0);
    g.moveTo(-3, -14).lineTo(0, -7);
    g.stroke(S);
  }
}

/** 悬停瞄准框：四角括号（高达锁定框），点在图标质心上。 */
function drawBracket(g: Graphics, color: number): void {
  g.clear();
  const w = 66;
  const h = 46;
  const arm = 12;
  const x = w / 2;
  const y = h / 2;
  g.moveTo(-x + arm, -y).lineTo(-x, -y).lineTo(-x, -y + arm);
  g.moveTo(x - arm, -y).lineTo(x, -y).lineTo(x, -y + arm);
  g.moveTo(-x + arm, y).lineTo(-x, y).lineTo(-x, y - arm);
  g.moveTo(x - arm, y).lineTo(x, y).lineTo(x, y - arm);
  g.stroke({ width: 2, color, cap: 'round', join: 'round' });
}

/** 打开轮盘（位置为屏幕本地坐标，自动收进屏幕边界内）。 */
export function openMenu(x: number, y: number): void {
  if (!appRef || root || registry.length === 0) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  centerX = Math.min(Math.max(x, R_OUTER + 12), W - R_OUTER - 12);
  centerY = Math.min(Math.max(y, R_OUTER + 12), H - R_OUTER - 12);
  hovered = -1;
  hoveredRaw = -1;

  root = new Container();
  root.position.set(centerX, centerY);
  root.alpha = 0;
  appRef.stage.addChild(root);
  appRef.ticker.start();
  appRef.ticker.maxFPS = 30;

  // 背景投影
  const shadow = new Sprite(softTexture('#04070d'));
  shadow.anchor.set(0.5);
  shadow.scale.set((R_OUTER * 3.0) / 64);
  shadow.alpha = 0.18;
  root.addChild(shadow);

  // 白色磨砂主盘 + 细边
  const disc = new Graphics();
  disc.circle(0, 0, R_OUTER + 4).fill({ color: 0xffffff, alpha: 0.97 });
  disc.circle(0, 0, R_OUTER + 4).stroke({ width: 1, color: T.border });
  root.addChild(disc);

  // 精密仪表外环：双环 + 36 格刻度
  const bezel = new Graphics();
  bezel.circle(0, 0, R_OUTER + 4).stroke({ width: 1, color: T.tick, alpha: 0.7 });
  bezel.circle(0, 0, R_OUTER + 10).stroke({ width: 1, color: T.tick, alpha: 0.45 });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r0 = R_OUTER + 5;
    const r1 = r0 + (i % 3 === 0 ? 6 : 3);
    bezel.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
  }
  bezel.stroke({ width: 1, color: T.tick, alpha: 0.8 });
  root.addChild(bezel);
  // 表盘快门式转正入场
  gsap.fromTo(bezel, { rotation: -0.7 }, { rotation: 0, duration: 0.55, ease: 'expo.out' });

  // 顶部红色基准标记（高达红点缀）
  const marker = new Graphics();
  marker.moveTo(0, -(R_OUTER + 20)).lineTo(-4, -(R_OUTER + 13)).lineTo(4, -(R_OUTER + 13)).closePath().fill({ color: T.warn });
  root.addChild(marker);

  // 两段高达蓝弧线缓慢旋转（克制的动态）
  const sweep = new Graphics();
  for (const [r, a0, a1] of [
    [R_OUTER + 10, 0, Math.PI * 0.3],
    [R_OUTER + 10, Math.PI * 1.15, Math.PI * 1.5],
  ] as Array<[number, number, number]>) {
    sweep.arc(0, 0, r, a0, a1).stroke({ width: 2, color: T.accent, alpha: 0.65 });
  }
  root.addChild(sweep);
  hudTweens.push(gsap.to(sweep, { rotation: Math.PI * 2, duration: 12, repeat: -1, ease: 'none' }));

  // 连续楔形分片（无空白）：极淡灰阶 + 细棱线，悬停染高达蓝
  const n = registry.length;
  const seg = (Math.PI * 2) / n;
  const start = -Math.PI / 2 - seg / 2; // 第一片正上方居中
  registry.forEach((def, i) => {
    const a0 = start + i * seg;
    const a1 = a0 + seg;
    const g = new Graphics();
    g.moveTo(0, 0).arc(0, 0, R_OUTER, a0, a1).closePath().fill({ color: 0xffffff, alpha: 0.12 });
    g.moveTo(Math.cos(a0) * R_INNER, Math.sin(a0) * R_INNER).lineTo(Math.cos(a0) * R_OUTER, Math.sin(a0) * R_OUTER);
    g.moveTo(Math.cos(a1) * R_INNER, Math.sin(a1) * R_INNER).lineTo(Math.cos(a1) * R_OUTER, Math.sin(a1) * R_OUTER);
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.55 });
    g.tint = T.wedgeNormal;
    root!.addChild(g);
    sliceGfx.push(g);

    const mid = a0 + seg / 2;
    const lr = (R_INNER + R_OUTER) / 2;
    const icon = new Graphics();
    drawIcon(icon, def.icon, def.enabled ? T.icon : T.iconDisabled);
    icon.scale.set(0.92);
    const label = new Text({
      text: def.name,
      style: {
        fontFamily: '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif',
        fontSize: 14.5,
        fontWeight: '600',
        fill: 0xffffff,
      },
    });
    label.anchor.set(0.5);
    label.tint = def.enabled ? T.text : T.textDisabled;
    // 左右分片：图标在上文字在下垂直堆叠；上下分片：沿半径内外排布
    if (Math.abs(Math.sin(mid)) < 0.5) {
      icon.position.set(Math.cos(mid) * (lr + 4), Math.sin(mid) * lr - 21);
      label.position.set(Math.cos(mid) * (lr + 4), Math.sin(mid) * lr + 17);
    } else {
      icon.position.set(Math.cos(mid) * (lr + 30), Math.sin(mid) * (lr + 30));
      label.position.set(Math.cos(mid) * (lr - 20), Math.sin(mid) * (lr - 20));
    }
    root!.addChild(icon);
    root!.addChild(label);
    sliceIcons.push(icon);
    sliceLabels.push(label);
    bracketAnchors.push({ x: icon.x, y: icon.y });

    if (!def.enabled) {
      const sub = new Text({
        text: '敬请期待',
        style: { fontSize: 10, fill: 0xffffff },
      });
      sub.anchor.set(0.5);
      sub.tint = T.textDisabled;
      sub.position.set(label.x, label.y + 16);
      root!.addChild(sub);
    }
  });

  // 悬停瞄准框（默认隐藏，悬停时弹跳锁定到图标）
  bracket = new Graphics();
  drawBracket(bracket, T.accent);
  bracket.visible = false;
  root.addChild(bracket);

  // 分片逐片展开入场
  sliceGfx.forEach((g, i) => {
    g.alpha = 0;
    gsap.to(g, { alpha: 1, duration: 0.24, delay: 0.06 + i * 0.045 });
  });
  sliceIcons.forEach((t) => {
    t.alpha = 0;
    gsap.to(t, { alpha: 1, duration: 0.24, delay: 0.1 });
  });
  sliceLabels.forEach((t, i) => {
    t.alpha = 0;
    gsap.to(t, { alpha: 1, duration: 0.24, delay: 0.1 + i * 0.04 });
  });

  // 中央取消区
  centerRing = new Graphics();
  centerRing.circle(0, 0, R_INNER).fill({ color: 0xffffff, alpha: 0.98 });
  centerRing.circle(0, 0, R_INNER).stroke({ width: 1.2, color: 0xffffff, alpha: 0.9 });
  centerRing.moveTo(-8, 0).lineTo(-4, 0).moveTo(4, 0).lineTo(8, 0);
  centerRing.moveTo(0, -8).lineTo(0, -4).moveTo(0, 4).lineTo(0, 8);
  centerRing.stroke({ width: 1.5, color: 0xffffff, alpha: 0.4 });
  centerRing.tint = 0xc0c0c8;
  root.addChild(centerRing);
  const cancel = new Text({
    text: '取消',
    style: { fontSize: 13, fill: 0xffffff, letterSpacing: 2 },
  });
  cancel.anchor.set(0.5);
  cancel.tint = T.centerText;
  root.addChild(cancel);

  // 入场动画
  root.scale.set(0.72);
  openTl = gsap.timeline();
  openTl.to(root, { alpha: 1, duration: 0.13 }, 0);
  openTl.to(root.scale, { x: 1, y: 1, duration: 0.22, ease: 'back.out(1.7)' }, 0);
}

/** 光标位置 → 悬停分片（中央取消区/盘外返回 -1，禁用片返回 -2）。 */
export function updateHover(x: number, y: number): void {
  if (!root) return;
  const dx = x - centerX;
  const dy = y - centerY;
  const d = Math.hypot(dx, dy);
  let idx = -1;
  if (d >= R_INNER + 6 && d <= R_OUTER + HOVER_TOL) {
    const n = registry.length;
    const seg = (Math.PI * 2) / n;
    let a = Math.atan2(dy, dx) - (-Math.PI / 2 - seg / 2);
    while (a < 0) a += Math.PI * 2;
    const raw = Math.floor(a / seg) % n;
    idx = registry[raw].enabled ? raw : -2;
    hoveredRaw = idx === -2 ? raw : -1;
  } else {
    hoveredRaw = -1;
  }
  if (idx === hovered) return;
  hovered = idx;
  applyHoverState();
}

function applyHoverState(): void {
  // 即时高亮：悬停楔形染高达蓝，图标/文字同步，瞄准框弹跳锁定
  sliceGfx.forEach((g, i) => {
    g.tint = i === hovered ? T.accent : T.wedgeNormal;
  });
  sliceIcons.forEach((t, i) => {
    drawIcon(t, registry[i].icon, i === hovered ? T.accent : registry[i].enabled ? T.icon : T.iconDisabled);
    t.scale.set(i === hovered ? 1.02 : 0.92);
  });
  sliceLabels.forEach((t, i) => {
    t.tint = i === hovered ? T.accent : registry[i].enabled ? T.text : T.textDisabled;
  });
  if (bracket) {
    if (hovered >= 0) {
      const anchor = bracketAnchors[hovered];
      bracket.position.set(anchor.x, anchor.y);
      bracket.visible = true;
      gsap.killTweensOf(bracket.scale);
      gsap.fromTo(bracket.scale, { x: 0.8, y: 0.8 }, { x: 1, y: 1, duration: 0.14, ease: 'back.out(2.2)' });
    } else {
      bracket.visible = false;
    }
  }
  if (centerRing) {
    centerRing.tint = hovered === -1 ? T.accent : 0xc0c0c8;
  }
}

/**
 * 左键点选结算（屏蔽模式下由钩子转发）：
 * 启用片 → 关闭轮盘并返回 { def, x, y }；禁用片 → 抖动警示、轮盘保持；
 * 中央/盘外 → 取消关闭。两种关闭情形都需随后调 Rust `menu_finish`。
 */
export function menuPick(): { def: EffectDef; x: number; y: number } | null {
  if (!root) return null;
  if (hovered === -2 && hoveredRaw >= 0) {
    // 禁用片：红光警示 + 水平抖动，轮盘保持打开
    const g = sliceGfx[hoveredRaw];
    const base = T.wedgeNormal;
    gsap.killTweensOf(g);
    gsap.fromTo(g, { x: -4 }, { x: 0, duration: 0.34, ease: 'elastic.out(1.2, 0.35)' });
    gsap.fromTo(g, { tint: T.warn }, { tint: base, duration: 0.4 });
    return null;
  }
  return closeMenu();
}

/** 取消并关闭轮盘（右键 / 超时）。 */
export function cancelMenu(): void {
  closeMenu();
}

/** 关闭轮盘；若悬停在可用技能上则返回 { def, x, y }（特效落在轮盘中心）。 */
function closeMenu(): { def: EffectDef; x: number; y: number } | null {
  if (!root || !appRef) return null;
  const selected = hovered >= 0 ? registry[hovered] : null;
  const closing = root;
  root = null;
  hovered = -1;
  hoveredRaw = -1;
  sliceGfx = [];
  sliceIcons = [];
  sliceLabels = [];
  bracketAnchors = [];
  bracket = null;
  centerRing = null;
  openTl?.kill();
  openTl = null;
  for (const t of hudTweens) t.kill();
  hudTweens = [];
  closing.children.forEach((c) => gsap.killTweensOf(c));
  gsap.killTweensOf(closing);
  gsap.killTweensOf(closing.scale);
  gsap.to(closing, {
    alpha: 0,
    duration: 0.12,
    onComplete: () => {
      try {
        closing.destroy({ children: true, texture: false, textureSource: false });
      } catch {
        /* 已销毁 */
      }
      // 没有别的演出在跑就停掉渲染循环
      const app = appRef;
      if (!isMenuOpen() && !isAirstrikeRunningRef() && app) {
        app.ticker.maxFPS = 0; // 恢复无限制（特效使用）
        app.ticker.stop();
      }
    },
  });
  if (selected?.enabled) {
    return { def: selected, x: centerX, y: centerY };
  }
  return null;
}

// 延迟引用，避免与 airstrike 循环依赖
let isAirstrikeRunningRef = (): boolean => false;
export function bindAirstrikeRunningCheck(fn: () => boolean): void {
  isAirstrikeRunningRef = fn;
}
