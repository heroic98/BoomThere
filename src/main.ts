import './style.css';
import type { Application } from 'pixi.js';
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { initPixi, installRenderWatchdog } from './engine/pixi';
import { bindParticles, prewarmEffectTextures } from './effects/particles';
import { playAirstrike, isAirstrikeRunning, preloadAirstrikeAssets } from './effects/airstrike';
import { isStampedeRunning, playStampede, prewarmStampedeAssets } from './effects/stampede';
import { isUfoRunning, playUfo, prewarmUfoAssets, setCaptureProvider } from './effects/ufo';
import { bindRadialMenu, registerEffect, openMenu, updateHover, menuPick, menuHoverInfo, isMenuAnimating, cancelMenu, isMenuOpen, bindAirstrikeRunningCheck } from './effects/menu';
import { initAudio } from './effects/audio';

interface ScreenPoint {
  screenX: number;
  screenY: number;
}

/** 物理屏幕坐标 → 覆盖层本地坐标：先扣窗口左上角偏移，再按 DPI 缩放换算。
 *  几何只在首次获取并缓存（覆盖层固定不动），避免每个移动事件都走 IPC。 */
let overlayGeo: { ox: number; oy: number; scale: number } | null = null;

async function toLocal(p: ScreenPoint): Promise<{ x: number; y: number }> {
  if (!overlayGeo) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const outer = await win.outerPosition();
    const scale = await win.scaleFactor();
    overlayGeo = { ox: outer.x, oy: outer.y, scale };
  }
  return { x: (p.screenX - overlayGeo.ox) / overlayGeo.scale, y: (p.screenY - overlayGeo.oy) / overlayGeo.scale };
}

/** 技能注册表：往这里加新特效，轮盘自动多一片 */
function registerSkills(app: Application): void {
  registerEffect({
    id: 'airstrike',
    title: '给我炸',
    description: '呼叫战机空袭此处',
    icon: 'burst',
    enabled: true,
    run: (x, y) => playAirstrike(app, x, y),
  });
  registerEffect({
    id: 'stampede',
    title: '牛马踩踏',
    description: '召唤牛马大军冲锋',
    icon: 'herd',
    enabled: true,
    run: (x, y) => playStampede(app, x, y),
  });
  registerEffect({
    id: 'ufo',
    title: '飞碟绑架',
    description: '把头像吸走带回母星',
    icon: 'ufo',
    enabled: true,
    run: (x, y) => playUfo(app, x, y),
  });
  registerEffect({ id: 'meteor', title: '陨石坠落', description: '天外来物轰炸', icon: 'meteor', enabled: false, run: async () => {} });
}

/** Tauri 覆盖层模式：订阅 Rust 转发来的输入事件。 */
async function setupTauriMode(app: Application): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');

  // 轮盘：唤出后常驻（屏蔽模式），左键点选结算，右键/超时取消。
  // 移动事件 30Hz 且几何已缓存，处理路径内无任何 IPC，保证跟手。
  let moveLogged = false;
  await listen<ScreenPoint>('menu-open', async (e) => {
    moveLogged = false;
    void invoke('log_line', { line: `got menu-open ${e.payload.screenX},${e.payload.screenY}` });
    let l = await toLocal(e.payload);
    // 偶发坐标异常防御：换算落 (0,0) 而原始坐标非 (0,0) 时重取一次窗口几何
    if (l.x === 0 && l.y === 0 && (e.payload.screenX !== 0 || e.payload.screenY !== 0)) {
      overlayGeo = null;
      l = await toLocal(e.payload);
      void invoke('log_line', { line: `geo refetch -> ${Math.round(l.x)},${Math.round(l.y)}` });
    }
    try {
      openMenu(l.x, l.y);
      void invoke('log_line', { line: `menu opened at ${Math.round(l.x)},${Math.round(l.y)}` });
    } catch (err) {
      void invoke('log_line', { line: `OPEN FAILED: ${String(err)}` });
    }
  });
  await listen<ScreenPoint>('menu-move', (e) => {
    if (!overlayGeo || !isMenuOpen()) return;
    if (!moveLogged) {
      moveLogged = true;
      void invoke('log_line', { line: `first move ${e.payload.screenX},${e.payload.screenY}` });
    }
    updateHover((e.payload.screenX - overlayGeo.ox) / overlayGeo.scale, (e.payload.screenY - overlayGeo.oy) / overlayGeo.scale);
  });
  await listen('menu-pick', () => {
    const hover = menuHoverInfo();
    void invoke('log_line', { line: `got menu-pick hover=${hover.hovered} center=${hover.centerHover}` });
    const r = menuPick();
    void invoke('log_line', { line: `pick closed=${r.closed} def=${r.def?.id ?? '-'}` });
    if (r.closed) void invoke('menu_finish'); // 仅在轮盘真正关闭时解除输入屏蔽
    if (r.def) void r.def.run(r.x, r.y);
  });
  await listen('menu-cancel', () => {
    void invoke('log_line', { line: 'got menu-cancel' });
    cancelMenu();
  });

  // 飞碟取样：Rust 在轮盘唤出瞬间截好光标附近的屏幕，这里取回并换算到覆盖层坐标
  setCaptureProvider(async () => {
    const buf = await invoke<ArrayBuffer>('take_capture');
    if (!overlayGeo || !buf || buf.byteLength < 16) return null;
    const head = new DataView(buf, 0, 16);
    const [sx, sy, w, h] = [0, 4, 8, 12].map((o) => head.getInt32(o, true));
    if (buf.byteLength < 16 + w * h * 4) return null;
    return {
      image: { width: w, height: h, data: new Uint8ClampedArray(buf, 16, w * h * 4) },
      x: (sx - overlayGeo.ox) / overlayGeo.scale,
      y: (sy - overlayGeo.oy) / overlayGeo.scale,
      scale: overlayGeo.scale,
    };
  });

  // Pixi 画布就绪后再显示覆盖层，避免出现白闪
  await invoke('overlay_ready');
}

/** 浏览器预览模式：左键直接放特效；Alt+右键唤出轮盘后左键点选、右键取消。 */
function setupBrowserTestMode(app: Application): void {
  document.body.classList.add('test-mode');
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('pointerdown', (e) => {
    if (isMenuOpen()) {
      e.preventDefault();
      if (e.button === 0) {
        const r = menuPick();
        if (r.def) void r.def.run(r.x, r.y);
      } else if (e.button === 2) {
        cancelMenu();
      }
      return;
    }
    if (e.button === 2 && e.altKey) {
      e.preventDefault();
      openMenu(e.clientX, e.clientY);
    } else if (e.button === 0) {
      void playAirstrike(app, e.clientX, e.clientY);
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (isMenuOpen()) updateHover(e.clientX, e.clientY);
  });
  // 预热一次音频上下文（浏览器自动播放策略下可能仍需首次手势）
  initAudio();
}

/** 渲染器预热：启动时离屏渲染一帧全部特效贴图 + Sprite/Graphics/Text 着色器，
 *  把 GPU 纹理上传、着色器编译和字体栅格化都提前到启动阶段，点击特效时零冷启动。 */
function prewarmRenderer(app: Application): void {
  const warm = new Container();
  const quad = new Sprite(Texture.WHITE);
  quad.tint = 0xff0000;
  warm.addChild(quad);
  const shape = new Graphics();
  shape.circle(0, 0, 12).fill({ color: 0xff0000 });
  shape.blendMode = 'add';
  warm.addChild(shape);
  // 预热轮盘用到的全部文字字形（中文首渲栅格化是首开卡顿源）
  const family = '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';
  const warmText = new Text({
    text: '给我炸牛马踩踏飞碟绑架陨石坠落取消呼叫战机空袭此处召唤牛马大军冲锋集结把头像吸走带回母星目标锁定准备出动此处饱和导弹攻击天外来物轰炸敬请期待0123456789',
    style: { fontFamily: family, fontSize: 18, fontWeight: '600', fill: 0x333333 },
  });
  warmText.position.set(-600, -600);
  warm.addChild(warmText);
  prewarmEffectTextures().forEach((tex, i) => {
    const s = new Sprite(tex);
    s.position.set(-260, -320 + (i % 6) * 90 + Math.floor(i / 6) * 140);
    warm.addChild(s);
  });
  prewarmStampedeAssets().forEach((tex, i) => {
    const s = new Sprite(tex);
    s.position.set(-400 + i * 120, -500);
    warm.addChild(s);
  });
  prewarmUfoAssets().forEach((tex, i) => {
    const s = new Sprite(tex);
    s.position.set(-400 + i * 120, -800);
    warm.addChild(s);
  });
  warm.position.set(-300, -300);
  app.stage.addChild(warm);
  app.render();
  warm.destroy({ children: true });
}

async function boot(): Promise<void> {
  const app = await initPixi();
  await preloadAirstrikeAssets(); // 预烘焙矢量机甲战机并预加载炸弹素材
  bindParticles(app);
  bindRadialMenu(app);
  bindAirstrikeRunningCheck(() => isAirstrikeRunning() || isStampedeRunning() || isUfoRunning());
  registerSkills(app);
  prewarmRenderer(app);
  installRenderWatchdog(app, () => isAirstrikeRunning() || isStampedeRunning() || isUfoRunning() || isMenuOpen() || isMenuAnimating());

  if ('__TAURI_INTERNALS__' in window) {
    await setupTauriMode(app);
  } else {
    setupBrowserTestMode(app);
  }
}

boot().catch((err) => {
  console.error('[boomthere] boot failed', err);
  document.body.innerHTML = `<pre style="color:#f66;font:13px monospace;padding:16px;">${String(err)}</pre>`;
});
