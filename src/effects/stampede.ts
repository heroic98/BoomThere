import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import gsap from 'gsap';
import { isAirstrikeRunning } from './airstrike';
import { isMenuAnimating, isMenuOpen } from './menu';
import { initAudio, sfxHooves } from './audio';
import { destroyAllParticles, requestFinishWhenDrained, ringTexture, smokePuffTexture, softTexture, spawn } from './particles';

type AnimalKind = 'cow' | 'horse';
const textureCache = new Map<string, Texture>();
let running = false;
const rand = (min: number, max: number): number => min + Math.random() * (max - min);

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function animalTexture(kind: AnimalKind, phase: number): Texture {
  const key = `${kind}:${phase}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const cv = document.createElement('canvas');
  cv.width = 200;
  cv.height = 150;
  const ctx = cv.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const outline = '#302b2a';

  const legs = (tops: number[], y: number, color: string): void => {
    tops.forEach((x, i) => {
      const swing = (i + phase) % 2 === 0 ? 9 : -8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + swing * 0.45, y + 18);
      ctx.lineTo(x + swing, 132);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 12;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 7;
      ctx.stroke();
      rounded(ctx, x + swing - 6, 126, 15, 9, 3);
      ctx.fillStyle = '#292625';
      ctx.fill();
    });
  };

  if (kind === 'cow') {
    // 尾巴与身体
    ctx.beginPath();
    ctx.moveTo(32, 62);
    ctx.quadraticCurveTo(8, 48, 15, 29);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(15, 28, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#473c36';
    ctx.fill();
    legs([48, 72, 101, 122], 92, '#f5f0e7');
    rounded(ctx, 27, 45, 112, 61, 27);
    ctx.fillStyle = '#fffaf0';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = outline;
    ctx.stroke();
    // 不规则奶牛斑
    ctx.fillStyle = '#4b403b';
    for (const [x, y, rx, ry] of [[55, 63, 19, 13], [92, 87, 20, 12], [116, 57, 13, 10]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, -0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    // 牛角、耳朵、面部
    ctx.fillStyle = '#f4d58a';
    ctx.beginPath();
    ctx.moveTo(137, 39); ctx.lineTo(133, 19); ctx.lineTo(148, 35); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(162, 38); ctx.lineTo(174, 21); ctx.lineTo(174, 43); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d69c91';
    ctx.beginPath(); ctx.ellipse(133, 47, 14, 8, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(170, 46, 13, 8, 0.3, 0, Math.PI * 2); ctx.fill();
    rounded(ctx, 130, 35, 46, 51, 17);
    ctx.fillStyle = '#fffaf0';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.fillStyle = '#4b403b';
    ctx.beginPath(); ctx.ellipse(145, 48, 9, 11, -0.3, 0, Math.PI * 2); ctx.fill();
    rounded(ctx, 143, 63, 42, 27, 12);
    ctx.fillStyle = '#e8aaa3';
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#241f1e';
    ctx.beginPath(); ctx.arc(158, 50, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(156, 75, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(174, 75, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(159, 49, 1, 0, Math.PI * 2); ctx.fill();
  } else {
    // 马鬃与尾巴
    ctx.beginPath();
    ctx.moveTo(29, 65);
    ctx.quadraticCurveTo(3, 70, 10, 105);
    ctx.quadraticCurveTo(20, 91, 29, 91);
    ctx.strokeStyle = '#3a2924';
    ctx.lineWidth = 12;
    ctx.stroke();
    legs([47, 72, 103, 123], 94, '#a96138');
    rounded(ctx, 26, 48, 108, 57, 25);
    ctx.fillStyle = '#b96f43';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = outline;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(112, 66); ctx.lineTo(126, 31); ctx.lineTo(151, 35); ctx.lineTo(146, 75); ctx.closePath();
    ctx.fillStyle = '#c77e4e';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(119, 62); ctx.lineTo(124, 25); ctx.lineTo(137, 31); ctx.lineTo(132, 48); ctx.lineTo(143, 43); ctx.lineTo(139, 62);
    ctx.strokeStyle = '#3a2924';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.fillStyle = '#b96f43';
    ctx.beginPath(); ctx.moveTo(139, 33); ctx.lineTo(139, 16); ctx.lineTo(149, 32); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(155, 31); ctx.lineTo(164, 17); ctx.lineTo(166, 37); ctx.closePath(); ctx.fill();
    rounded(ctx, 137, 29, 49, 42, 13);
    ctx.fillStyle = '#c77e4e';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = outline;
    ctx.stroke();
    rounded(ctx, 161, 51, 30, 25, 10);
    ctx.fillStyle = '#d8996e';
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#211b19';
    ctx.beginPath(); ctx.arc(161, 42, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(179, 62, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(162, 41, 1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(145, 30); ctx.lineTo(154, 32); ctx.lineTo(150, 52); ctx.lineTo(143, 49); ctx.closePath();
    ctx.fillStyle = '#fff5df';
    ctx.fill();
  }
  const tex = Texture.from(cv);
  textureCache.set(key, tex);
  return tex;
}

export function prewarmStampedeAssets(): Texture[] {
  const textures: Texture[] = [];
  for (const kind of ['cow', 'horse'] as AnimalKind[]) {
    textures.push(animalTexture(kind, 0), animalTexture(kind, 1));
  }
  return textures;
}

function kickDust(parent: Container, x: number, y: number, amount = 2): void {
  const tex = smokePuffTexture();
  for (let i = 0; i < amount; i++) {
    spawn({
      parent, tex, x: x + rand(-26, 26), y: y + rand(-4, 5),
      vx: rand(-65, 65), vy: rand(-42, -16), g: -6, drag: 1.8,
      life: rand(0.65, 1.05), sc0: rand(0.15, 0.28), sc1: rand(0.75, 1.2),
      a0: 0.62, tint: 0xc5a681, rot: rand(0, 6), spin: rand(-0.8, 0.8), fadeIn: 0.08,
    });
  }
  spawn({
    parent, tex: ringTexture('#d8b98e'), x, y, life: 0.48,
    sc0: 0.12, sc1: 0.75, sy0: 0.04, sy1: 0.2, a0: 0.42, easeOut: true,
  });
}

function runEffect(app: Application, x: number, y: number): Promise<void> {
  return new Promise((resolve) => {
    const wrap = new Container();
    const ground = new Container();
    const herd = new Container();
    const fx = new Container();
    wrap.addChild(ground, herd, fx);
    app.stage.addChild(wrap);
    app.ticker.start();

    const sigil = new Graphics();
    sigil.position.set(x, y);
    sigil.circle(0, 0, 62).stroke({ width: 2, color: 0xe9b66f, alpha: 0.75 });
    sigil.circle(0, 0, 48).stroke({ width: 1, color: 0xffdf9e, alpha: 0.5 });
    sigil.ellipse(0, 33, 135, 32).stroke({ width: 2, color: 0xc69a68, alpha: 0.4 });
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      sigil.moveTo(Math.cos(a) * 53, Math.sin(a) * 53);
      sigil.lineTo(Math.cos(a) * 62, Math.sin(a) * 62);
    }
    sigil.stroke({ width: 2, color: 0xe9b66f, alpha: 0.7 });
    ground.addChild(sigil);

    const label = new Text({
      text: '牛马大军 · 集结！',
      style: { fontFamily: '"Noto Sans SC", "Microsoft YaHei", sans-serif', fontSize: 17, fontWeight: '700', letterSpacing: 3, fill: 0xfff1cf, stroke: { color: 0x5c412d, width: 4 } },
    });
    label.anchor.set(0.5);
    label.position.set(x, y - 188);
    ground.addChild(label);

    const tl = gsap.timeline();
    const extraTweens: gsap.core.Tween[] = [];
    let finished = false;
    const finish = (aborted = false): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(safety);
      tl.kill();
      extraTweens.forEach((t) => t.kill());
      if (aborted) destroyAllParticles();
      try { wrap.destroy({ children: true, texture: false, textureSource: false }); } catch { /* 已销毁 */ }
      app.render();
      resolve();
    };
    const safety = window.setTimeout(() => finish(true), 12000);

    tl.fromTo(sigil, { alpha: 0 }, { alpha: 1, duration: 0.18 }, 0);
    tl.fromTo(sigil.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2)' }, 0);
    tl.to(sigil, { rotation: 1.2, duration: 4.1, ease: 'none' }, 0);
    tl.fromTo(label, { alpha: 0, y: y - 170 }, { alpha: 1, y: y - 188, duration: 0.35 }, 0.2);
    tl.to(label, { alpha: 0, y: y - 204, duration: 0.45 }, 4.25);
    tl.to(sigil, { alpha: 0, duration: 0.5 }, 4.4);

    const dust = softTexture('#b99a76', 'puff');
    for (let i = 0; i < 14; i++) {
      const kind: AnimalKind = i % 2 === 0 ? 'cow' : 'horse';
      const lane = Math.floor(i / 2);
      const spotX = x + (i % 2 === 0 ? -76 : 76) + rand(-28, 28);
      const spotY = y + (lane - 3) * 43 + rand(-9, 9);
      const startX = -260 - (i % 4) * 110;
      const startY = spotY + rand(-35, 35);
      const size = (kind === 'horse' ? 0.63 : 0.59) * rand(0.9, 1.08);
      const sp = new Sprite(animalTexture(kind, 0));
      sp.anchor.set(0.5, 0.88);
      sp.scale.set(size);
      sp.position.set(startX, startY);
      herd.addChild(sp);

      let phase = 0;
      const gait = gsap.to({}, { duration: 0.105, repeat: -1, onRepeat: () => {
        phase = 1 - phase;
        sp.texture = animalTexture(kind, phase);
      } });
      extraTweens.push(gait);
      const bounce = gsap.to(sp.position, { y: '+=9', duration: 0.13, repeat: -1, yoyo: true, paused: true, ease: 'power1.inOut' });
      extraTweens.push(bounce);

      const enterAt = 0.45 + (i % 4) * 0.08;
      const stompAt = 1.65 + (i % 3) * 0.1;
      const leaveAt = 4.25 + (i % 4) * 0.09;
      tl.to(sp.position, { x: spotX, y: spotY, duration: 0.85 + (i % 3) * 0.08, ease: 'power2.out' }, enterAt);
      tl.call(() => bounce.play(), undefined, stompAt);
      tl.call(() => { bounce.pause(0); sp.position.y = spotY; }, undefined, leaveAt);
      tl.to(sp.position, { x: window.innerWidth + 260 + (i % 3) * 120, y: spotY + rand(-70, 70), duration: 0.95 + (i % 3) * 0.1, ease: 'power2.in' }, leaveAt);
      tl.to(sp, { alpha: 0, duration: 0.15 }, leaveAt + 0.9);

      // 每只牛马留下淡淡蹄印，随后随扬尘一起消散。
      const marks = new Graphics();
      for (const side of [-1, 1]) {
        marks.ellipse(spotX + side * 18, spotY + 34 + side * 7, 5, 9).fill({ color: 0x66513e, alpha: 0.42 });
        marks.circle(spotX + side * 18 - 4, spotY + 24 + side * 7, 2).fill({ color: 0x66513e, alpha: 0.32 });
        marks.circle(spotX + side * 18 + 4, spotY + 24 + side * 7, 2).fill({ color: 0x66513e, alpha: 0.32 });
      }
      marks.alpha = 0;
      ground.addChild(marks);
      tl.to(marks, { alpha: 0.48, duration: 0.25 }, stompAt + 0.2);
      tl.to(marks, { alpha: 0, duration: 1 }, leaveAt + 0.35);

      for (let step = 0; step < 6; step++) {
        const at = stompAt + step * 0.38;
        tl.call(() => kickDust(fx, spotX, spotY + 32, i % 3 === 0 ? 3 : 2), undefined, at);
        if (i % 4 === 0) {
          tl.to(wrap, { x: rand(-4, 4), y: rand(-3, 3), duration: 0.055, yoyo: true, repeat: 1 }, at);
          tl.set(wrap, { x: 0, y: 0 }, at + 0.12);
        }
      }
      // 起步与撤离时各补一团尘，让奔跑方向更清楚。
      tl.call(() => spawn({ parent: fx, tex: dust, x: startX + 50, y: startY + 35, vx: -80, vy: -18, life: 0.8, sc0: 0.25, sc1: 1.1, a0: 0.45 }), undefined, enterAt + 0.45);
      tl.call(() => kickDust(fx, spotX - 30, spotY + 32, 3), undefined, leaveAt);
    }
    tl.call(() => requestFinishWhenDrained(() => finish()), undefined, 5.65);

    try {
      initAudio();
      void sfxHooves();
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
