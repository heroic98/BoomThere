import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import gsap from 'gsap';
import { softTexture } from './particles';

/**
 * POLARIS // 极简浅色能量轮盘
 *
 * 白色玻璃装甲 + 青蓝/淡紫能量描边 + 独立旋转仪表环。
 * 静态装甲只在状态变化时重绘；扫描、粒子和呼吸光由 ticker 驱动。
 */

// ---- 主题常量（全部颜色集中配置，禁止散落硬编码） ----
const THEME = {
  bg: {
    main: 0xf6f9fc,
    alt: 0xeaf0f6,
    pure: 0xffffff,
  },
  sector: {
    normal: 0xffffff,
    normalAlt: 0xf4f8fb,
    hover: 0xeef9fc,
    pressed: 0xdff4fa,
    selected: 0xe2f4ff,
    disabled: 0xf0f3f6,
    centerFill: 0xffffff,
    centerHover: 0xfff4f6,
    centerPressed: 0xffe7ec,
  },
  border: {
    wheel: 0xc7d4e1,
    divider: 0xdbe4ec,
    center: 0xe5b4c0,
    centerHover: 0xf06a81,
    centerPressed: 0xd94862,
    sectorHover: 0x41b8dd,
    sectorPressed: 0x168fb9,
    emphasis: 0x2bb3dd,
  },
  decoration: {
    ring1: 0x78cfe3,
    ring2: 0xb7c7d5,
    tick: 0x94aabb,
    auxArc: 0xa29aee,
    pointer: 0x31a9c9,
  },
  text: {
    title: 0x2c3d52,
    titleHover: 0x14283d,
    titleSelected: 0x14283d,
    desc: 0x76889b,
    titleDisabled: 0xaeb9c5,
    descDisabled: 0xc0c8d0,
    center: 0xd84d64,
  },
  icon: {
    normal: 0x3ba7c7,
    hover: 0x147ea8,
    disabled: 0xa8b5c1,
  },
  shadow: {
    color: 0x34516b,
    alpha: 0.18,
  },
  energy: {
    cyan: 0x35b8e4,
    violet: 0x9187ed,
    mint: 0x3cc8ae,
    danger: 0xf05b74,
  },
};

// ---- 几何参数（600 基准坐标系） ----
const GEO = {
  base: 600,
  cx: 300,
  cy: 300,
  wheelOuter: 240, // 轮盘主体外半径
  sectorOuter: 238, // 扇区外半径
  sectorInner: 83, // 扇区内半径
  gapDeg: 3.2, // 悬浮装甲之间的能量隔断
  centerBtn: 72, // 中心按钮半径
  centerHit: 80, // 中心命中区（最外细环）
  centerRing1: 80,
  centerRing3: 65,
  ring1: 249, // 装饰环 1
  ring2: 258, // 装饰环 2
  tickInner: 258, // 刻度环内沿
  auxArc: 270, // 最外辅助圆弧
  pointerY: -272, // 顶部指示三角
};

// 四扇区角度定义（度，屏幕 Y 轴向下、顺时针为正；0° 指向右）
const SECTORS: Array<{ a0: number; a1: number }> = [
  { a0: -135, a1: -45 }, // 顶
  { a0: -45, a1: 45 }, // 右
  { a0: 45, a1: 135 }, // 底
  { a0: 135, a1: 225 }, // 左
];

// 扇区内容锚点（图标中心，相对圆心；标题 +41、描述 +64 垂直排布）
const CONTENT_ANCHORS: Array<{ x: number; y: number }> = [
  { x: 0, y: -165 }, // 顶：icon(300,135) title(300,176) desc(300,199)
  { x: 158, y: -36 }, // 右：(458,264)
  { x: 0, y: 121 }, // 底：(300,421)
  { x: -158, y: -36 }, // 左：(142,264)
];

/** 轮盘选项（数据驱动，不与绘制逻辑耦合）。 */
export interface EffectDef {
  id: string;
  title: string;
  description: string;
  icon: string; // 线性图标种类（burst / herd / ufo / missiles / meteor）
  enabled: boolean;
  run: (x: number, y: number) => Promise<void>;
}

type SectorState = 'normal' | 'hover' | 'pressed' | 'disabled' | 'selected';

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** 环形扇区闭合路径（内圆→外圆→外弧→内圆→反向内弧→闭合）。 */
function ringSectorPath(g: Graphics, r0: number, r1: number, a0: number, a1: number): void {
  g.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0);
  g.lineTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
  g.arc(0, 0, r1, a0, a1, false);
  g.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
  g.arc(0, 0, r0, a1, a0, true);
  g.closePath();
}

/** 极简线性图标（统一 1.6px 描边、30px 视框，颜色随状态重绘）。 */
function drawIcon(g: Graphics, kind: string, color: number): void {
  g.clear();
  const S = { width: 2, color, cap: 'round' as const, join: 'round' as const };
  if (kind === 'burst') {
    g.circle(0, 0, 4.2).stroke(S);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      g.moveTo(Math.cos(a) * 7.5, Math.sin(a) * 7.5).lineTo(Math.cos(a) * 13.5, Math.sin(a) * 13.5);
    }
    g.stroke(S);
  } else if (kind === 'orbit') {
    g.circle(0, 0, 6.5).stroke(S);
    g.ellipse(0, 0, 14, 5).stroke(S);
    g.circle(13, -2.5, 1.8).fill({ color });
  } else if (kind === 'herd') {
    g.moveTo(-8, -8).lineTo(-14, -13).lineTo(-12, -5);
    g.moveTo(8, -8).lineTo(14, -13).lineTo(12, -5);
    g.moveTo(-10, -3).lineTo(-16, 0).lineTo(-10, 4);
    g.moveTo(10, -3).lineTo(16, 0).lineTo(10, 4);
    g.stroke(S);
    g.roundRect(-10, -9, 20, 22, 6).stroke(S);
    g.circle(-4, -1, 1.4).fill({ color });
    g.circle(4, -1, 1.4).fill({ color });
    g.ellipse(0, 7, 6, 4).stroke(S);
    g.circle(-2.5, 7, 0.8).fill({ color });
    g.circle(2.5, 7, 0.8).fill({ color });
  } else if (kind === 'ufo') {
    g.ellipse(0, 1, 14, 4.5).stroke(S);
    g.moveTo(-6.5, -1).bezierCurveTo(-6.5, -9, 6.5, -9, 6.5, -1).stroke(S);
    g.moveTo(-5, 7).lineTo(-9, 14).moveTo(5, 7).lineTo(9, 14).stroke({ ...S, width: 1.6 });
    g.circle(-8, 1, 1.1).fill({ color });
    g.circle(0, 2.5, 1.1).fill({ color });
    g.circle(8, 1, 1.1).fill({ color });
  } else if (kind === 'missiles') {
    for (const [mx, my] of [
      [-9, -4],
      [0, 2],
      [10, -6],
    ] as Array<[number, number]>) {
      g.moveTo(mx - 3.2, my + 6).lineTo(mx, my - 5).lineTo(mx + 3.2, my + 6).closePath().stroke(S);
    }
  } else if (kind === 'meteor') {
    g.circle(4, 4, 7).stroke(S);
    g.moveTo(-11, -11).lineTo(-3, -3);
    g.moveTo(-13, -3).lineTo(-7, 0);
    g.moveTo(-3, -13).lineTo(0, -7);
    g.stroke(S);
  }
}

class RadialMenu {
  private app: Application;
  private view: Container | null = null; // 600 基准容器（整体缩放）
  private scale = 1;
  private centerX = 0;
  private centerY = 0;

  private items: EffectDef[] = [];
  private sectorGfx: Graphics[] = [];
  private icons: Graphics[] = [];
  private titles: Text[] = [];
  private descs: Text[] = [];
  private emphasis: Graphics | null = null; // 悬停/选中强调弧
  private centerG: Graphics | null = null;
  private centerC: Container | null = null;
  private centerText: Text | null = null;
  private centerAura: Graphics | null = null;
  private spinner: Container | null = null;
  private reverseRing: Container | null = null;
  private scanner: Graphics | null = null;
  private orbiters: Array<{ g: Graphics; r: number; a: number; speed: number }> = [];
  private dust: Array<{ g: Graphics; r: number; a: number; speed: number; phase: number }> = [];

  private hovered = -1;
  private centerHover = false;
  private pressedIdx = -1;
  private closing = false;
  private animatingUntil = 0;
  private tweens: gsap.core.Tween[] = [];

  // 事件回调（组件接口）
  onOpen: (() => void) | null = null;
  onClose: (() => void) | null = null;
  onHover: ((id: string | null) => void) | null = null;
  onSelect: ((id: string) => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor(app: Application) {
    this.app = app;
  }

  // ---- 组件接口 ----
  setItems(items: EffectDef[]): void {
    this.items = items;
  }

  isOpen(): boolean {
    return this.view !== null && !this.closing;
  }

  lastCenter(): { x: number; y: number } {
    return { x: this.centerX, y: this.centerY };
  }

  /** 打开轮盘：屏幕坐标定位，按屏幕尺寸整体缩放（不放大超过基准）。 */
  open(x: number, y: number): void {
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, any>;
      (w.__btTrace ??= []).push(`open-entry items=${this.items.length} view=${!!this.view}`);
    }
    if (this.view || this.items.length === 0) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.scale = clamp(Math.min(W, H) / GEO.base, 0.36, 0.667);
    const margin = 285 * this.scale;
    this.centerX = clamp(x, margin, W - margin);
    this.centerY = clamp(y, margin, H - margin);
    this.hovered = -1;
    this.centerHover = false;
    this.pressedIdx = -1;
    this.closing = false;
    // 丢弃上一会话的引用：已 destroy 的 Graphics 再 clear() 会抛
    // "Cannot read properties of null"，导致重开轮盘构建中断
    this.sectorGfx = [];
    this.icons = [];
    this.titles = [];
    this.descs = [];
    this.emphasis = null;
    this.centerG = null;
    this.centerC = null;
    this.centerText = null;
    this.centerAura = null;
    this.spinner = null;
    this.reverseRing = null;
    this.scanner = null;
    this.orbiters = [];
    this.dust = [];

    this.view = new Container();
    this.view.position.set(this.centerX, this.centerY);
    this.view.scale.set(this.scale);
    this.view.alpha = 0;
    this.app.stage.addChild(this.view);
    this.app.ticker.start();
    this.app.ticker.maxFPS = 60; // 扫描环与粒子需要更顺滑的运动
    this.app.ticker.add(this.tick);

    this.buildShadow();
    this.buildWheelBase();
    this.buildSectors();
    this.buildDecoration();
    this.buildContent();
    this.buildCenterButton();
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, any>).__btTrace?.push('open-done');
    }

    // 能量展开：轮盘弹入，仪表环反向解锁，内容逐层点亮。
    this.view.scale.set(this.scale * 0.82);
    this.view.rotation = -0.055;
    this.tweens.push(
      gsap.to(this.view, { alpha: 1, rotation: 0, duration: 0.3, ease: 'power3.out' }),
      gsap.to(this.view.scale, { x: this.scale, y: this.scale, duration: 0.38, ease: 'back.out(1.45)' }),
    );
    if (this.spinner) this.tweens.push(gsap.from(this.spinner, { rotation: -0.8, duration: 0.55, ease: 'power3.out' }));
    if (this.reverseRing) this.tweens.push(gsap.from(this.reverseRing, { rotation: 0.65, duration: 0.55, ease: 'power3.out' }));
    const content = [...this.icons, ...this.titles, ...this.descs];
    this.tweens.push(gsap.from(content, { alpha: 0, duration: 0.24, stagger: 0.025, delay: 0.08, ease: 'power2.out' }));
    this.onOpen?.();
  }

  /** 诊断快照（生产也可用）：当前悬停状态。 */
  hoverInfo(): { hovered: number; centerHover: boolean; open: boolean } {
    return { hovered: this.hovered, centerHover: this.centerHover, open: this.isOpen() };
  }

  /** 关闭淡出是否仍在进行（渲染看门狗需在此期间持续驱动，
   *  否则无焦点覆盖层的 rAF 会被系统节流，画布冻结在半透明残影上）。 */
  isAnimating(): boolean {
    return performance.now() < this.animatingUntil;
  }

  /** 指针移动（屏幕坐标）：命中检测 + 状态切换，只重绘变化的部分。 */
  updatePointer(sx: number, sy: number): void {
    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, any>;
      (w.__btPointerCalls ??= 0);
      w.__btPointerCalls++;
      (w.__btTrace ??= []).push(`up view=${!!this.view} closing=${this.closing}`);
    }
    if (!this.view || this.closing) return;
    const lx = (sx - this.centerX) / this.scale;
    const ly = (sy - this.centerY) / this.scale;
    const d = Math.hypot(lx, ly);

    let idx = -1;
    let center = false;
    if (d < GEO.centerHit) {
      center = true;
    } else if (d >= GEO.sectorInner && d <= GEO.sectorOuter) {
      const a = Math.atan2(ly, lx) / DEG; // (-180, 180]
      const half = GEO.gapDeg / 2;
      for (let i = 0; i < this.items.length && i < SECTORS.length; i++) {
        const { a0, a1 } = SECTORS[i]; // 定义域跨 ±180°（顶扇区 -135°~-45°）
        const hit = (v: number): boolean => v > a0 + half && v < a1 - half;
        // 扇区间隙（±gap/2）不算可点击区域
        if (hit(a) || hit(a + 360)) {
          idx = this.items[i].enabled ? i : -2; // -2 = 禁用扇区（无悬停效果）
          break;
        }
      }
    }

    if (center !== this.centerHover) {
      this.centerHover = center;
      this.applyCenterState();
    }
    const newHover = idx >= 0 ? idx : -1;
    if (newHover !== this.hovered) {
      const prev = this.hovered;
      this.hovered = newHover;
      if (prev >= 0) {
        this.applySectorState(prev, this.stateOf(prev));
        this.tweens.push(gsap.to(this.titles[prev], { y: CONTENT_ANCHORS[prev].y + 41, duration: 0.16, ease: 'power2.out' }));
        this.tweens.push(gsap.to(this.icons[prev].scale, { x: 1.2, y: 1.2, duration: 0.18, ease: 'power2.out' }));
      }
      if (newHover >= 0) {
        this.applySectorState(newHover, 'hover');
        this.tweens.push(gsap.to(this.titles[newHover], { y: CONTENT_ANCHORS[newHover].y + 37, duration: 0.18, ease: 'back.out(2)' }));
        this.tweens.push(gsap.fromTo(this.icons[newHover].scale, { x: 0.92, y: 0.92 }, { x: 1.36, y: 1.36, duration: 0.24, ease: 'back.out(2.2)' }));
      }
      this.updateEmphasis(newHover, 0.85);
      this.onHover?.(newHover >= 0 ? this.items[newHover].id : null);
    }
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, any>).__btMenuState = {
        open: this.isOpen(),
        hoverIdx: this.hovered,
        centerHover: this.centerHover,
      };
    }
  }

  /**
   * 左键点选：可用扇区 → 按下反馈 120ms 后选中关闭并返回选项；
   * 禁用扇区 → 不动作、保持打开；中心/盘外 → 取消关闭。
   */
  pick(): { closed: boolean; def?: EffectDef; x: number; y: number } {
    if (!this.view || this.closing) return { closed: false, x: this.centerX, y: this.centerY };
    if (this.hovered >= 0) {
      const i = this.hovered;
      const item = this.items[i];
      this.pressedIdx = i;
      this.applySectorState(i, 'pressed');
      this.updateEmphasis(i, 1, 2);
      this.onSelect?.(item.id);
      // 按下态 120ms 后关闭（选中色），特效由调用方在关闭瞬间发射
      this.closing = true;
      window.setTimeout(() => {
        this.applySectorState(i, 'selected');
        this.destroyView();
      }, 120);
      return { closed: true, def: item, x: this.centerX, y: this.centerY };
    }
    if (this.centerHover) this.onCancel?.();
    this.close();
    return { closed: true, x: this.centerX, y: this.centerY };
  }

  /** 取消关闭（右键 / 超时）：140ms easeInCubic。 */
  close(): void {
    if (!this.view || this.closing) return;
    this.closing = true;
    this.destroyView();
  }

  destroy(): void {
    this.close();
  }

  // ---- 私有实现 ----

  /** 常驻全息运动：慢速仪表、雷达扫描、轨道光点与呼吸能量。 */
  private tick = (): void => {
    if (!this.view || this.closing) return;
    const dt = Math.min(this.app.ticker.deltaMS, 50) / 1000;
    const t = performance.now() / 1000;
    if (this.spinner) this.spinner.rotation += dt * 0.085;
    if (this.reverseRing) this.reverseRing.rotation -= dt * 0.12;
    if (this.scanner) {
      this.scanner.rotation += dt * 0.34;
      this.scanner.alpha = 0.58 + Math.sin(t * 1.8) * 0.12;
    }
    for (const o of this.orbiters) {
      o.a += dt * o.speed;
      o.g.position.set(Math.cos(o.a) * o.r, Math.sin(o.a) * o.r);
      o.g.rotation = o.a + Math.PI / 2;
    }
    for (const p of this.dust) {
      p.a += dt * p.speed;
      p.g.position.set(Math.cos(p.a) * p.r, Math.sin(p.a) * p.r);
      p.g.alpha = 0.12 + (Math.sin(t * 1.7 + p.phase) + 1) * 0.17;
    }
    if (this.centerAura) {
      const pulse = 1 + Math.sin(t * 2.4) * 0.035;
      this.centerAura.scale.set(pulse);
      this.centerAura.alpha = 0.48 + Math.sin(t * 2.4) * 0.12;
    }
  };

  private stateOf(i: number): SectorState {
    if (!this.items[i].enabled) return 'disabled';
    if (this.pressedIdx === i) return 'pressed';
    if (this.hovered === i) return 'hover';
    return 'normal';
  }

  private applySectorState(i: number, state: SectorState): void {
    const g = this.sectorGfx[i];
    if (!g) return;
    const { a0, a1 } = SECTORS[i];
    const active = state === 'hover' || state === 'pressed' || state === 'selected';
    const disabled = state === 'disabled';
    const accent = i % 2 === 0 ? THEME.energy.cyan : THEME.energy.violet;
    const fill = state === 'hover' ? THEME.sector.hover
      : active ? THEME.sector.pressed
      : disabled ? THEME.sector.disabled
      : i % 2 === 0 ? THEME.sector.normal : THEME.sector.normalAlt;
    const border = state === 'hover' ? THEME.border.sectorHover
      : state === 'pressed' ? THEME.border.sectorPressed
      : state === 'selected' ? THEME.border.emphasis
      : THEME.border.divider;
    const start = (a0 + GEO.gapDeg / 2) * DEG;
    const end = (a1 - GEO.gapDeg / 2) * DEG;
    g.clear();

    // 悬浮装甲的多层边缘：暗影厚度、玻璃主体、内侧高光。
    ringSectorPath(g, GEO.sectorInner + 3, GEO.sectorOuter + 3, start, end);
    g.fill({ color: THEME.bg.alt, alpha: 0.96 });
    ringSectorPath(g, GEO.sectorInner, GEO.sectorOuter, start, end);
    g.fill({ color: fill, alpha: disabled ? 0.8 : 0.97 });
    g.stroke({ width: active ? 1.7 : 1, color: border, alpha: disabled ? 0.45 : 0.95 });
    g.arc(0, 0, GEO.sectorInner + 7, start + 0.035, end - 0.035);
    g.stroke({ width: 1, color: active ? accent : THEME.border.wheel, alpha: active ? 0.65 : 0.34 });

    // 扇区外沿能量轨：常态微亮，悬停时形成有宽度的青/紫辉光。
    if (active) {
      g.arc(0, 0, GEO.sectorOuter - 2, start + 0.035, end - 0.035);
      g.stroke({ width: 12, color: accent, alpha: 0.1, cap: 'round' });
      g.arc(0, 0, GEO.sectorOuter - 2, start + 0.035, end - 0.035);
      g.stroke({ width: 4, color: accent, alpha: 0.25, cap: 'round' });
    }
    g.arc(0, 0, GEO.sectorOuter - 2, start + 0.035, end - 0.035);
    g.stroke({ width: active ? 1.8 : 1.1, color: disabled ? THEME.border.divider : accent, alpha: disabled ? 0.25 : active ? 1 : 0.5, cap: 'round' });

    // 装甲接缝与端部刻度，避免大面积单调色块。
    for (const a of [start, end]) {
      g.moveTo(Math.cos(a) * (GEO.sectorInner + 16), Math.sin(a) * (GEO.sectorInner + 16));
      g.lineTo(Math.cos(a) * (GEO.sectorOuter - 18), Math.sin(a) * (GEO.sectorOuter - 18));
    }
    g.stroke({ width: 1, color: border, alpha: 0.35 });
    const mid = (start + end) / 2;
    for (const offset of [-0.055, 0, 0.055]) {
      const a = mid + offset;
      g.moveTo(Math.cos(a) * (GEO.sectorOuter - 12), Math.sin(a) * (GEO.sectorOuter - 12));
      g.lineTo(Math.cos(a) * (GEO.sectorOuter - (offset === 0 ? 23 : 18)), Math.sin(a) * (GEO.sectorOuter - (offset === 0 ? 23 : 18)));
    }
    g.stroke({ width: 2, color: disabled ? border : accent, alpha: disabled ? 0.25 : 0.72 });

    const iconColor = active ? THEME.icon.hover : disabled ? THEME.icon.disabled : THEME.icon.normal;
    // 构建阶段 content 尚未创建（buildContent 在 buildSectors 之后），需守卫
    if (this.icons[i]) drawIcon(this.icons[i], this.items[i].icon, iconColor);
    if (this.titles[i]) {
      this.titles[i].tint = active ? THEME.text.titleHover : disabled ? THEME.text.titleDisabled : THEME.text.title;
    }
    if (this.descs[i]) this.descs[i].tint = disabled ? THEME.text.descDisabled : active ? THEME.icon.normal : THEME.text.desc;
  }

  private applyCenterState(): void {
    if (!this.centerG || !this.centerC || !this.centerText) return;
    const pressed = false; // 按下瞬间由 pick 流程处理缩放
    const fill = this.centerHover ? THEME.sector.centerHover : THEME.sector.centerFill;
    const border = this.centerHover ? THEME.border.centerHover : THEME.border.center;
    this.centerG.clear();
    this.centerG.circle(0, 0, GEO.centerBtn).fill({ color: fill, alpha: 0.98 });
    this.centerG.circle(0, 0, GEO.centerBtn).stroke({ width: this.centerHover ? 2 : 1.2, color: border, alpha: 0.9 });
    this.centerG.circle(0, 0, 54).stroke({ width: 1, color: border, alpha: 0.28 });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      this.centerG.moveTo(Math.cos(a) * 59, Math.sin(a) * 59).lineTo(Math.cos(a) * 66, Math.sin(a) * 66);
    }
    this.centerG.stroke({ width: 2, color: border, alpha: 0.75 });
    this.centerG.moveTo(-10, -15).lineTo(10, 5);
    this.centerG.moveTo(10, -15).lineTo(-10, 5);
    this.centerG.stroke({ width: 2.2, color: this.centerHover ? THEME.energy.danger : THEME.text.center, cap: 'round' });
    this.centerText.tint = this.centerHover ? THEME.border.centerHover : THEME.text.center;
    void pressed;
  }

  /** 悬停/选中强调弧：外环对应扇区位置的浅灰弧线。 */
  private emphasisTween: gsap.core.Tween | null = null;

  private updateEmphasis(idx: number, alpha: number, width = 1.8): void {
    if (!this.emphasis) return;
    this.emphasisTween?.kill();
    if (idx < 0) {
      this.emphasis.alpha = 0;
      return;
    }
    const { a0, a1 } = SECTORS[idx];
    this.emphasis.clear();
    this.emphasis.arc(0, 0, GEO.ring1, (a0 + 2.5) * DEG, (a1 - 2.5) * DEG);
    this.emphasis.stroke({ width: width + 8, color: THEME.energy.cyan, alpha: 0.1, cap: 'round' });
    this.emphasis.arc(0, 0, GEO.ring1, (a0 + 2.5) * DEG, (a1 - 2.5) * DEG);
    this.emphasis.stroke({ width, color: THEME.border.emphasis, cap: 'round' });
    this.emphasisTween = gsap.fromTo(this.emphasis, { alpha: 0 }, { alpha, duration: 0.1 });
  }

  private buildShadow(): void {
    const v = this.view!;
    const shadow = new Sprite(softTexture('#34516b'));
    shadow.anchor.set(0.5);
    shadow.scale.set((GEO.wheelOuter * 2.6) / 64);
    shadow.alpha = THEME.shadow.alpha;
    shadow.position.set(0, 12);
    v.addChild(shadow);
    const glow = new Sprite(softTexture('#8bdcf2'));
    glow.anchor.set(0.5);
    glow.scale.set((GEO.wheelOuter * 2.5) / 64);
    glow.alpha = 0.09;
    glow.blendMode = 'add';
    v.addChild(glow);
  }

  private buildWheelBase(): void {
    const v = this.view!;
    const base = new Graphics();
    base.circle(0, 0, GEO.wheelOuter + 4).fill({ color: THEME.bg.pure, alpha: 0.9 });
    base.circle(0, 0, GEO.wheelOuter + 4).stroke({ width: 1, color: THEME.border.wheel, alpha: 0.7 });
    base.circle(0, 0, GEO.wheelOuter - 6).stroke({ width: 1, color: THEME.decoration.ring2, alpha: 0.28 });
    // 中央暗色玻璃衬底，让四个独立扇区仍有整体感。
    base.circle(0, 0, 112).fill({ color: THEME.bg.main, alpha: 0.88 });
    base.circle(0, 0, 112).stroke({ width: 1, color: THEME.border.divider, alpha: 0.45 });
    v.addChild(base);
  }

  private buildSectors(): void {
    const v = this.view!;
    this.sectorGfx = [];
    for (let i = 0; i < this.items.length && i < SECTORS.length; i++) {
      const g = new Graphics();
      v.addChild(g);
      this.sectorGfx.push(g);
      this.applySectorState(i, this.stateOf(i));
    }
  }

  private buildDecoration(): void {
    const v = this.view!;
    const d = new Container();
    v.addChild(d);

    // 雷达扫光藏在仪表环下方，以极低透明度增加空间层次。
    this.scanner = new Graphics();
    this.scanner.moveTo(0, 0).arc(0, 0, 284, -0.12, 0.12).closePath().fill({ color: THEME.energy.cyan, alpha: 0.055 });
    this.scanner.moveTo(0, 0).lineTo(284, 0).stroke({ width: 1, color: THEME.energy.cyan, alpha: 0.18 });
    this.scanner.blendMode = 'add';
    d.addChild(this.scanner);

    const r1 = new Graphics();
    r1.circle(0, 0, GEO.ring1).stroke({ width: 1, color: THEME.decoration.ring1, alpha: 0.52 });
    r1.circle(0, 0, GEO.ring2).stroke({ width: 0.7, color: THEME.decoration.ring2, alpha: 0.55 });
    d.addChild(r1);

    // 正转的能量断环。
    this.spinner = new Container();
    const spin = new Graphics();
    for (const [a0, a1, color] of [
      [-78, -18, THEME.energy.cyan], [12, 62, THEME.energy.violet],
      [102, 152, THEME.energy.cyan], [192, 242, THEME.energy.violet],
    ] as Array<[number, number, number]>) {
      spin.arc(0, 0, GEO.ring2, a0 * DEG, a1 * DEG);
      spin.stroke({ width: 2.2, color, alpha: 0.8, cap: 'round' });
      spin.arc(0, 0, GEO.ring2 + 5, (a0 + 5) * DEG, (a0 + 17) * DEG);
      spin.stroke({ width: 1, color, alpha: 0.42, cap: 'round' });
    }
    this.spinner.addChild(spin);
    d.addChild(this.spinner);

    // 反转的精密刻度环。
    this.reverseRing = new Container();
    const ticks = new Graphics();
    for (let i = 0; i < 96; i++) {
      const a = i * 3.75 * DEG;
      const major = i % 8 === 0;
      const r0 = major ? 265 : 267;
      const r1Tick = major ? 274 : 271;
      ticks.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * r1Tick, Math.sin(a) * r1Tick);
    }
    ticks.stroke({ width: 1, color: THEME.decoration.tick, alpha: 0.5 });
    for (const [a0, a1] of [[18, 52], [138, 172], [258, 292]] as Array<[number, number]>) {
      ticks.arc(0, 0, GEO.auxArc + 7, a0 * DEG, a1 * DEG);
    }
    ticks.stroke({ width: 1.5, color: THEME.decoration.auxArc, alpha: 0.5 });
    this.reverseRing.addChild(ticks);
    d.addChild(this.reverseRing);

    // 轨道光点与短尾迹，像环绕轮盘运行的能量子。
    for (let i = 0; i < 4; i++) {
      const g = new Graphics();
      const color = i % 2 ? THEME.energy.violet : THEME.energy.cyan;
      g.moveTo(0, 0).lineTo(0, 17).stroke({ width: 2, color, alpha: 0.2, cap: 'round' });
      g.moveTo(0, 0).lineTo(0, 8).stroke({ width: 1.4, color, alpha: 0.8, cap: 'round' });
      g.circle(0, 0, 2.4).fill({ color });
      g.blendMode = 'add';
      d.addChild(g);
      this.orbiters.push({ g, r: i % 2 ? 260 : 278, a: i * Math.PI / 2, speed: (i % 2 ? -1 : 1) * (0.18 + i * 0.025) });
    }

    // 稀疏星尘保持静态半径，仅缓慢公转与闪烁，不干扰文字阅读。
    for (let i = 0; i < 24; i++) {
      const g = new Graphics();
      const color = i % 3 === 0 ? THEME.energy.violet : THEME.energy.cyan;
      g.circle(0, 0, i % 5 === 0 ? 1.5 : 0.85).fill({ color });
      d.addChild(g);
      const a = i * 2.39996;
      this.dust.push({ g, r: 248 + (i % 5) * 10, a, speed: i % 2 ? 0.025 : -0.018, phase: i * 0.73 });
    }

    const pointer = new Graphics();
    pointer.moveTo(0, GEO.pointerY + 10).lineTo(-6, GEO.pointerY).lineTo(6, GEO.pointerY).closePath().fill({ color: THEME.decoration.pointer });
    pointer.moveTo(-12, GEO.pointerY + 4).lineTo(-18, GEO.pointerY + 4);
    pointer.moveTo(12, GEO.pointerY + 4).lineTo(18, GEO.pointerY + 4);
    pointer.stroke({ width: 1, color: THEME.energy.cyan, alpha: 0.65 });
    d.addChild(pointer);

    this.emphasis = new Graphics();
    this.emphasis.alpha = 0;
    d.addChild(this.emphasis);
  }

  private buildContent(): void {
    const v = this.view!;
    const family = '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';
    this.icons = [];
    this.titles = [];
    this.descs = [];
    for (let i = 0; i < this.items.length && i < SECTORS.length; i++) {
      const item = this.items[i];
      const anchor = CONTENT_ANCHORS[i];
      const accent = i % 2 === 0 ? THEME.energy.cyan : THEME.energy.violet;

      const halo = new Graphics();
      halo.circle(anchor.x, anchor.y, 25).fill({ color: accent, alpha: item.enabled ? 0.055 : 0.025 });
      halo.circle(anchor.x, anchor.y, 25).stroke({ width: 1, color: item.enabled ? accent : THEME.border.divider, alpha: item.enabled ? 0.28 : 0.2 });
      halo.arc(anchor.x, anchor.y, 30, -2.7, -1.95).stroke({ width: 1.5, color: accent, alpha: item.enabled ? 0.55 : 0.12 });
      halo.arc(anchor.x, anchor.y, 30, 0.45, 1.2).stroke({ width: 1.5, color: accent, alpha: item.enabled ? 0.55 : 0.12 });
      halo.moveTo(anchor.x - 20, anchor.y + 88).lineTo(anchor.x + 20, anchor.y + 88).stroke({ width: 1, color: accent, alpha: item.enabled ? 0.32 : 0.12 });
      halo.circle(anchor.x, anchor.y + 88, 1.5).fill({ color: accent, alpha: item.enabled ? 0.7 : 0.15 });
      v.addChild(halo);

      const code = new Text({
        text: `0${i + 1}  //  ${item.enabled ? 'READY' : 'LOCKED'}`,
        style: { fontFamily: 'Consolas, monospace', fontSize: 8, fontWeight: '400', letterSpacing: 1.5, fill: 0xffffff },
      });
      code.anchor.set(0.5);
      code.position.set(anchor.x, anchor.y - 36);
      code.tint = item.enabled ? accent : THEME.text.titleDisabled;
      code.alpha = item.enabled ? 0.7 : 0.45;
      v.addChild(code);

      const icon = new Graphics();
      drawIcon(icon, item.icon, item.enabled ? THEME.icon.normal : THEME.icon.disabled);
      icon.position.set(anchor.x, anchor.y);
      icon.scale.set(1.2);
      v.addChild(icon);
      this.icons.push(icon);

      const title = new Text({
        text: item.title,
        style: { fontFamily: family, fontSize: 19, fontWeight: '600', letterSpacing: 2, fill: 0xffffff },
      });
      title.anchor.set(0.5);
      title.position.set(anchor.x, anchor.y + 41);
      title.tint = item.enabled ? THEME.text.title : THEME.text.titleDisabled;
      v.addChild(title);
      this.titles.push(title);

      const desc = new Text({
        text: item.enabled ? item.description : '尚未解锁',
        style: { fontFamily: family, fontSize: 10, fontWeight: '400', letterSpacing: 1, fill: 0xffffff },
      });
      desc.anchor.set(0.5);
      desc.position.set(anchor.x, anchor.y + 64);
      desc.tint = item.enabled ? THEME.text.desc : THEME.text.descDisabled;
      v.addChild(desc);
      this.descs.push(desc);
    }
  }

  private buildCenterButton(): void {
    const v = this.view!;
    this.centerC = new Container();
    v.addChild(this.centerC);

    this.centerAura = new Graphics();
    this.centerAura.circle(0, 0, 83).fill({ color: THEME.energy.danger, alpha: 0.025 });
    this.centerAura.circle(0, 0, GEO.centerRing1).stroke({ width: 5, color: THEME.energy.danger, alpha: 0.06 });
    this.centerAura.circle(0, 0, GEO.centerRing1).stroke({ width: 1, color: THEME.border.center, alpha: 0.8 });
    this.centerC.addChild(this.centerAura);

    const broken = new Graphics();
    for (const [a0, a1] of [[-80, -18], [10, 72], [100, 162], [190, 252]] as Array<[number, number]>) {
      broken.arc(0, 0, GEO.centerRing1, a0 * DEG, a1 * DEG);
    }
    broken.stroke({ width: 2, color: THEME.energy.danger, alpha: 0.42, cap: 'round' });
    this.centerC.addChild(broken);

    this.centerG = new Graphics();
    this.centerC.addChild(this.centerG);

    const ring3 = new Graphics();
    ring3.circle(0, 0, GEO.centerRing3).stroke({ width: 1, color: THEME.border.center, alpha: 0.22 });
    this.centerC.addChild(ring3);

    this.centerText = new Text({
      text: '取 消',
      style: { fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif', fontSize: 10, fontWeight: '500', letterSpacing: 2, fill: 0xffffff },
    });
    this.centerText.anchor.set(0.5);
    this.centerText.position.set(0, 24);
    this.centerText.tint = THEME.text.center;
    this.centerC.addChild(this.centerText);
    this.applyCenterState();
  }

  /** 关闭动画（140ms easeInCubic）后释放全部对象。 */
  private destroyView(): void {
    const view = this.view;
    if (!view) return;
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, any>).__btTrace?.push('destroy');
    }
    this.view = null;
    this.app.ticker.remove(this.tick);
    // 淡出期间保持"忙碌"：看门狗继续驱动渲染，画布才不会冻结在残影上
    this.animatingUntil = performance.now() + 400;
    this.hovered = -1;
    this.centerHover = false;
    for (const t of this.tweens) t.kill();
    this.tweens = [];
    this.emphasisTween?.kill();
    this.emphasisTween = null;
    view.children.forEach((c) => gsap.killTweensOf(c));
    gsap.killTweensOf(view);
    gsap.killTweensOf(view.scale);
    gsap.to(view, {
      alpha: 0,
      duration: 0.14,
      ease: 'power2.in',
      onComplete: () => {
        try {
          view.destroy({ children: true, texture: false, textureSource: false });
        } catch {
          /* 已销毁 */
        }
        const app = this.app;
        if (app) {
          // 清屏：销毁后立刻渲染一帧空舞台，否则画布会冻结在淡出末尾的
          // 半透明残影上（取消路径没有后续演出冲刷画布，残影永久留存）
          app.render();
        }
        if (!this.view && app && !airstrikeRunningRef()) {
          app.ticker.maxFPS = 0;
          app.ticker.stop();
        }
      },
    });
    gsap.to(view.scale, { x: this.scale * 0.9, y: this.scale * 0.9, duration: 0.14, ease: 'power2.in' });
    gsap.to(view, { rotation: 0.035, duration: 0.14, ease: 'power2.in' });
    this.onClose?.();
  }
}

// ---- 模块级单例与门面（保持 main.ts 现有调用约定） ----
let menu: RadialMenu | null = null;
const registered: EffectDef[] = [];

export function bindRadialMenu(app: Application): void {
  menu = new RadialMenu(app);
}

export function registerEffect(def: EffectDef): void {
  registered.push(def);
  menu?.setItems(registered);
}

export function isMenuOpen(): boolean {
  return menu?.isOpen() ?? false;
}

export function openMenu(x: number, y: number): void {
  menu?.open(x, y);
}

export function updateHover(x: number, y: number): void {
  menu?.updatePointer(x, y);
}

export function menuPick(): { closed: boolean; def?: EffectDef; x: number; y: number } {
  return menu ? menu.pick() : { closed: false, x: 0, y: 0 };
}

/** 诊断：轮盘当前悬停状态（生产可用，供日志排查）。 */
export function menuHoverInfo(): { hovered: number; centerHover: boolean; open: boolean } {
  return menu ? menu.hoverInfo() : { hovered: -1, centerHover: false, open: false };
}

/** 关闭淡出仍在进行（渲染看门狗用）。 */
export function isMenuAnimating(): boolean {
  return menu ? menu.isAnimating() : false;
}

export function cancelMenu(): void {
  menu?.close();
}

export function lastMenuCenter(): { x: number; y: number } {
  return menu ? menu.lastCenter() : { x: 0, y: 0 };
}

// 延迟引用，避免与 airstrike 循环依赖
let airstrikeRunningRef = (): boolean => false;
export function bindAirstrikeRunningCheck(fn: () => boolean): void {
  airstrikeRunningRef = fn;
}
