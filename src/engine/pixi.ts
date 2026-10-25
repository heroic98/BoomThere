import { Application } from 'pixi.js';
import gsap from 'gsap';

/**
 * 初始化透明 WebGL 画布。
 * backgroundAlpha: 0 + body 透明，保证覆盖层下方的桌面内容可见。
 */
export async function initPixi(): Promise<Application> {
  const app = new Application();
  await app.init({
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    resizeTo: window,
  });

  const canvas = app.canvas;
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.zIndex = '2147483647';
  document.body.appendChild(canvas);

  // 立即完成一次布局与渲染，再停掉 ticker：空闲时不产生任何 GPU 动画
  app.resize();
  app.render();
  app.ticker.stop();

  return app;
}

/**
 * 渲染看门狗：窗口被遮挡或省电模式下 rAF 会被节流到近 0，特效随之停摆。
 * 检测到 rAF 停滞时改用 setInterval 按真实时间手动驱动 GSAP 与 Pixi 的帧循环。
 */
export function installRenderWatchdog(app: Application, isBusy: () => boolean): void {
  let lastRaf = performance.now();
  const rafLoop = (t: number) => {
    lastRaf = t;
    requestAnimationFrame(rafLoop);
  };
  requestAnimationFrame(rafLoop);

  let lastDrive = 0;
  window.setInterval(() => {
    if (!isBusy()) return; // 空闲时不驱动，维持零 GPU 占用
    const now = performance.now();
    if (now - lastRaf < 250) return; // rAF 健康，交给原生帧循环
    const dt = lastDrive ? Math.min((now - lastDrive) / 1000, 0.1) : 0;
    lastDrive = now;
    if (dt <= 0) return;
    // updateRoot 是绝对时间：按增量推进，避免把时间轴推到未来
    gsap.updateRoot(gsap.globalTimeline.time() + dt);
    app.ticker.update(now);
  }, 16);
}
