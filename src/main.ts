import './style.css';
import type { Application } from 'pixi.js';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { initPixi, installRenderWatchdog } from './engine/pixi';
import { bindParticles, prewarmEffectTextures } from './effects/particles';
import { playAirstrike, isAirstrikeRunning } from './effects/airstrike';
import { bindRadialMenu, registerEffect, openMenu, updateHover, menuPick, cancelMenu, isMenuOpen, bindAirstrikeRunningCheck } from './effects/menu';
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
    name: '给我炸',
    icon: 'burst',
    color: 0xff5a3c,
    enabled: true,
    run: (x, y) => playAirstrike(app, x, y),
  });
  registerEffect({ id: 'orbital', name: '轨道打击', icon: 'orbit', color: 0x4f8cff, enabled: false, run: async () => {} });
  registerEffect({ id: 'missiles', name: '导弹雨', icon: 'missiles', color: 0x9a6bff, enabled: false, run: async () => {} });
  registerEffect({ id: 'meteor', name: '陨石坠落', icon: 'meteor', color: 0xffb054, enabled: false, run: async () => {} });
}

/** Tauri 覆盖层模式：订阅 Rust 转发来的输入事件。 */
async function setupTauriMode(app: Application): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');

  // 修饰键+右键：直接触发技能
  await listen<ScreenPoint>('airstrike-trigger', async (e) => {
    try {
      const l = await toLocal(e.payload);
      void playAirstrike(app, l.x, l.y);
    } catch (err) {
      console.error('[boomthere] trigger handling failed', err);
    }
  });

  // 轮盘：唤出后常驻（屏蔽模式），左键点选结算，右键/超时取消。
  // 移动事件 30Hz 且几何已缓存，处理路径内无任何 IPC，保证跟手。
  await listen<ScreenPoint>('menu-open', async (e) => {
    const l = await toLocal(e.payload);
    openMenu(l.x, l.y);
  });
  await listen<ScreenPoint>('menu-move', (e) => {
    if (!overlayGeo || !isMenuOpen()) return;
    updateHover((e.payload.screenX - overlayGeo.ox) / overlayGeo.scale, (e.payload.screenY - overlayGeo.oy) / overlayGeo.scale);
  });
  await listen('menu-pick', () => {
    const sel = menuPick();
    void invoke('menu_finish');
    if (sel) void sel.def.run(sel.x, sel.y);
  });
  await listen('menu-cancel', () => cancelMenu());

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
        const sel = menuPick();
        if (sel) void sel.def.run(sel.x, sel.y);
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

/** 渲染器预热：启动时离屏渲染一帧全部特效贴图 + Sprite/Graphics 着色器，
 *  把 GPU 纹理上传和着色器编译都提前到启动阶段，点击特效时零冷启动。 */
function prewarmRenderer(app: Application): void {
  const warm = new Container();
  const quad = new Sprite(Texture.WHITE);
  quad.tint = 0xff0000;
  warm.addChild(quad);
  const shape = new Graphics();
  shape.circle(0, 0, 12).fill({ color: 0xff0000 });
  shape.blendMode = 'add';
  warm.addChild(shape);
  prewarmEffectTextures().forEach((tex, i) => {
    const s = new Sprite(tex);
    s.position.set(-260, -320 + (i % 6) * 90 + Math.floor(i / 6) * 140);
    warm.addChild(s);
  });
  warm.position.set(-300, -300);
  app.stage.addChild(warm);
  app.render();
  warm.destroy({ children: true });
}

async function boot(): Promise<void> {
  const app = await initPixi();
  bindParticles(app);
  bindRadialMenu(app);
  bindAirstrikeRunningCheck(isAirstrikeRunning);
  registerSkills(app);
  prewarmRenderer(app);
  installRenderWatchdog(app, () => isAirstrikeRunning() || isMenuOpen());

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
