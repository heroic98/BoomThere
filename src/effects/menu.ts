import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import gsap from 'gsap';
import { softTexture } from './particles';

/**
 * Light Sci-Fi Radial Menu（极简白色科幻轮盘）
 *
 * 600 × 600 基准坐标系，整体按屏幕比例缩放。
 * 分层渲染：阴影 / 底板 / 扇区 / 装饰 / 内容 / 中心按钮。
 * 静态层只绘制一次；交互状态变化时仅重绘对应扇区。
 */

// ---- 主题常量（全部颜色集中配置，禁止散落硬编码） ----
const THEME = {
  bg: {
    main: 0xf8f9fa,
    alt: 0xfafbfc,
    pure: 0xffffff,
  },
  sector: {
    normal: 0xf7f8fa,
    normalAlt: 0xf5f6f8,
    hover: 0xeceff2,
    pressed: 0xe5e9ed,
    selected: 0xe5e9ed,
    disabled: 0xf6f7f8,
    centerFill: 0xffffff,
    centerHover: 0xf1f3f5,
    centerPressed: 0xe8ecef,
  },
  border: {
    wheel: 0xd7dce2,
    divider: 0xd9dee4,
    center: 0xc8d0d8,
    centerHover: 0xaeb8c2,
    centerPressed: 0x8995a1,
    sectorHover: 0xaeb8c2,
    sectorPressed: 0x8995a1,
    emphasis: 0x798592,
  },
  decoration: {
    ring1: 0xc7ced6,
    ring2: 0xd9dee4,
    tick: 0xb8c0c9,
    auxArc: 0xc9d0d7,
    pointer: 0x798592,
  },
  text: {
    title: 0x4a535e,
    titleHover: 0x343b44,
    titleSelected: 0x303842,
    desc: 0x939ba5,
    titleDisabled: 0xabb2ba,
    descDisabled: 0xc0c6cd,
    center: 0x3a424c,
  },
  icon: {
    normal: 0x75808c,
    hover: 0x46515d,
    disabled: 0xc2c8cf,
  },
  shadow: {
    color: 0x202b3a,
    alpha: 0.08,
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
  gapDeg: 1.2, // 扇区角间隙
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
  icon: string; // 线性图标种类（burst / orbit / missiles / meteor）
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
  const S = { width: 1.6, color, cap: 'round' as const, join: 'round' as const };
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

    this.view = new Container();
    this.view.position.set(this.centerX, this.centerY);
    this.view.scale.set(this.scale);
    this.view.alpha = 0;
    this.app.stage.addChild(this.view);
    this.app.ticker.start();
    this.app.ticker.maxFPS = 30; // 静态 UI，30fps 足够

    this.buildShadow();
    this.buildWheelBase();
    this.buildSectors();
    this.buildDecoration();
    this.buildContent();
    this.buildCenterButton();
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, any>).__btTrace?.push('open-done');
    }

    // 打开动画：180ms easeOutCubic，0.96 → 1.0
    this.view.scale.set(this.scale * 0.96);
    this.tweens.push(
      gsap.to(this.view, { alpha: 1, duration: 0.18, ease: 'power2.out' }),
      gsap.to(this.view.scale, { x: this.scale, y: this.scale, duration: 0.18, ease: 'power2.out' }),
    );
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
      if (prev >= 0) this.applySectorState(prev, this.stateOf(prev));
      if (newHover >= 0) this.applySectorState(newHover, 'hover');
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
    const fill =
      state === 'hover' ? THEME.sector.hover
      : state === 'pressed' || state === 'selected' ? THEME.sector.pressed
      : state === 'disabled' ? THEME.sector.disabled
      : THEME.sector.normal;
    const border =
      state === 'hover' ? THEME.border.sectorHover
      : state === 'pressed' ? THEME.border.sectorPressed
      : state === 'selected' ? THEME.border.emphasis
      : THEME.border.divider;
    g.clear();
    ringSectorPath(g, GEO.sectorInner, GEO.sectorOuter, (a0 + GEO.gapDeg / 2) * DEG, (a1 - GEO.gapDeg / 2) * DEG);
    g.fill({ color: fill });
    g.stroke({ width: 1, color: border });

    const iconColor =
      state === 'hover' || state === 'selected' ? THEME.icon.hover
      : state === 'disabled' ? THEME.icon.disabled
      : THEME.icon.normal;
    // 构建阶段 content 尚未创建（buildContent 在 buildSectors 之后），需守卫
    if (this.icons[i]) drawIcon(this.icons[i], this.items[i].icon, iconColor);
    if (this.titles[i]) {
      this.titles[i].tint =
        state === 'hover' ? THEME.text.titleHover
        : state === 'selected' ? THEME.text.titleSelected
        : state === 'disabled' ? THEME.text.titleDisabled
        : THEME.text.title;
    }
    if (this.descs[i]) {
      this.descs[i].tint = state === 'disabled' ? THEME.text.descDisabled : THEME.text.desc;
    }
  }

  private applyCenterState(): void {
    if (!this.centerG || !this.centerC || !this.centerText) return;
    const pressed = false; // 按下瞬间由 pick 流程处理缩放
    const fill = this.centerHover ? THEME.sector.centerHover : THEME.sector.centerFill;
    const border = this.centerHover ? THEME.border.centerHover : THEME.border.center;
    this.centerG.clear();
    this.centerG.circle(0, 0, GEO.centerBtn).fill({ color: fill });
    this.centerG.circle(0, 0, GEO.centerBtn).stroke({ width: 1.5, color: border });
    this.centerText.tint = THEME.text.center;
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
    this.emphasis.stroke({ width, color: THEME.border.emphasis, cap: 'round' });
    this.emphasisTween = gsap.fromTo(this.emphasis, { alpha: 0 }, { alpha, duration: 0.1 });
  }

  private buildShadow(): void {
    const v = this.view!;
    const shadow = new Sprite(softTexture('#202b3a'));
    shadow.anchor.set(0.5);
    shadow.scale.set((GEO.wheelOuter * 2.2) / 64);
    shadow.alpha = THEME.shadow.alpha;
    shadow.position.set(0, 6); // offsetY 6px 的极轻投影
    v.addChild(shadow);
  }

  private buildWheelBase(): void {
    const v = this.view!;
    const base = new Graphics();
    base.circle(0, 0, GEO.wheelOuter).fill({ color: THEME.bg.pure });
    base.circle(0, 0, GEO.wheelOuter).stroke({ width: 1, color: THEME.border.wheel });
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

    // 第一层装饰环 249
    const r1 = new Graphics();
    r1.circle(0, 0, GEO.ring1).stroke({ width: 1, color: THEME.decoration.ring1, alpha: 0.75 });
    d.addChild(r1);

    // 第二层装饰环 258
    const r2 = new Graphics();
    r2.circle(0, 0, GEO.ring2).stroke({ width: 0.7, color: THEME.decoration.ring2, alpha: 0.45 });
    d.addChild(r2);

    // 刻度环：72 格、每 6 格一条主刻度
    const ticks = new Graphics();
    for (let i = 0; i < 72; i++) {
      const a = (i * 5) * DEG;
      const major = i % 6 === 0;
      const len = major ? 7 : 3;
      const r0 = GEO.tickInner;
      ticks.moveTo(Math.cos(a) * r0, Math.sin(a) * r0).lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
    }
    ticks.stroke({ width: 1, color: THEME.decoration.tick, alpha: 0.5 });
    d.addChild(ticks);

    // 极细辅助圆弧（3 段，最外层，透明度极低）
    const aux = new Graphics();
    for (const [a0, a1] of [[18, 52], [138, 172], [258, 292]] as Array<[number, number]>) {
      aux.arc(0, 0, GEO.auxArc, a0 * DEG, a1 * DEG);
    }
    aux.stroke({ width: 1.5, color: THEME.decoration.auxArc, alpha: 0.2 });
    d.addChild(aux);

    // 顶部指示三角（中性灰，无发光）
    const pointer = new Graphics();
    pointer
      .moveTo(0, GEO.pointerY + 8)
      .lineTo(-5, GEO.pointerY)
      .lineTo(5, GEO.pointerY)
      .closePath()
      .fill({ color: THEME.decoration.pointer });
    d.addChild(pointer);

    // 强调弧（初始隐藏）
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

      const icon = new Graphics();
      drawIcon(icon, item.icon, item.enabled ? THEME.icon.normal : THEME.icon.disabled);
      icon.position.set(anchor.x, anchor.y);
      v.addChild(icon);
      this.icons.push(icon);

      const title = new Text({
        text: item.title,
        style: { fontFamily: family, fontSize: 18, fontWeight: '600', fill: 0xffffff },
      });
      title.anchor.set(0.5);
      title.position.set(anchor.x, anchor.y + 41);
      title.tint = item.enabled ? THEME.text.title : THEME.text.titleDisabled;
      v.addChild(title);
      this.titles.push(title);

      const desc = new Text({
        text: item.description,
        style: { fontFamily: family, fontSize: 12, fontWeight: '400', fill: 0xffffff },
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

    // 第一层：最外细环 80
    const ring1 = new Graphics();
    ring1.circle(0, 0, GEO.centerRing1).stroke({ width: 1, color: 0xdce1e6 });
    this.centerC.addChild(ring1);

    // 第二层：按钮主体 72
    this.centerG = new Graphics();
    this.centerG.circle(0, 0, GEO.centerBtn).fill({ color: THEME.sector.centerFill });
    this.centerG.circle(0, 0, GEO.centerBtn).stroke({ width: 1.5, color: THEME.border.center });
    this.centerC.addChild(this.centerG);

    // 第三层：内部辅助细环 65
    const ring3 = new Graphics();
    ring3.circle(0, 0, GEO.centerRing3).stroke({ width: 1, color: 0xebeef1 });
    this.centerC.addChild(ring3);

    this.centerText = new Text({
      text: '取消',
      style: { fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif', fontSize: 24, fontWeight: '600', fill: 0xffffff },
    });
    this.centerText.anchor.set(0.5);
    this.centerText.tint = THEME.text.center;
    this.centerC.addChild(this.centerText);
  }

  /** 关闭动画（140ms easeInCubic）后释放全部对象。 */
  private destroyView(): void {
    const view = this.view;
    if (!view) return;
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, any>).__btTrace?.push('destroy');
    }
    this.view = null;
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
    gsap.to(view.scale, { x: this.scale * 0.97, y: this.scale * 0.97, duration: 0.14, ease: 'power2.in' });
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
