// 飞碟矢量绘制（纯 Canvas 2D，便于离线出图预览）。
// 碟身与舷灯分开烘焙：舷灯单独做成精灵，运行时逐个闪烁。

export const UFO_W = 260;
export const UFO_H = 150;
/** 碟身中心（贴图锚点） */
export const UFO_CX = 130;
export const UFO_CY = 92;
/** 牵引光束发射口（相对碟身中心） */
export const UFO_EMITTER_Y = 30;
/** 舷灯位置（相对碟身中心），沿碟沿椭圆分布 */
export const UFO_LIGHTS: Array<[number, number]> = Array.from({ length: 7 }, (_, i) => {
  const a = Math.PI * (0.12 + (i / 6) * 0.76);
  return [Math.cos(a) * -104, Math.sin(a) * 15 + 4];
});

const OUTLINE = '#1c2230';

function domeGlass(ctx: CanvasRenderingContext2D): void {
  // 玻璃罩
  ctx.beginPath();
  ctx.moveTo(78, 76);
  ctx.bezierCurveTo(78, 8, 182, 8, 182, 76);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 30, 0, 78);
  g.addColorStop(0, 'rgba(190,250,255,0.95)');
  g.addColorStop(0.6, 'rgba(110,220,245,0.75)');
  g.addColorStop(1, 'rgba(60,160,210,0.85)');
  ctx.fillStyle = g;
  ctx.fill();
}

function alien(ctx: CanvasRenderingContext2D): void {
  // 绿色小外星人：大脑袋、黑色杏仁眼、触角
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(78, 76);
  ctx.bezierCurveTo(78, 8, 182, 8, 182, 76);
  ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = '#3f8f3a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(130 + s * 8, 46);
    ctx.quadraticCurveTo(130 + s * 16, 34, 130 + s * 20, 32);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(130 + s * 20, 32, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#c8ff6a';
    ctx.fill();
  }
  // 身体
  ctx.beginPath();
  ctx.ellipse(130, 82, 22, 16, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#5fbf4a';
  ctx.fill();
  // 头
  ctx.beginPath();
  ctx.moveTo(130, 42);
  ctx.bezierCurveTo(152, 42, 156, 58, 150, 68);
  ctx.bezierCurveTo(144, 78, 136, 80, 130, 80);
  ctx.bezierCurveTo(124, 80, 116, 78, 110, 68);
  ctx.bezierCurveTo(104, 58, 108, 42, 130, 42);
  const hg = ctx.createRadialGradient(124, 52, 2, 130, 60, 26);
  hg.addColorStop(0, '#b6f07e');
  hg.addColorStop(1, '#58b845');
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#2f6e2b';
  ctx.stroke();
  // 眼睛
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(130 + s * 9, 61);
    ctx.rotate(s * 0.45);
    ctx.beginPath();
    ctx.ellipse(0, 0, 6.5, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#111418';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-s * 1.8, -1.2, 1.4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }
  // 小嘴
  ctx.beginPath();
  ctx.arc(130, 70, 3, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.strokeStyle = '#2f6e2b';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

function domeShine(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(78, 76);
  ctx.bezierCurveTo(78, 8, 182, 8, 182, 76);
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 高光弧
  ctx.beginPath();
  ctx.moveTo(92, 60);
  ctx.bezierCurveTo(92, 38, 104, 28, 120, 26);
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(96, 68, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fill();
}

function saucer(ctx: CanvasRenderingContext2D): void {
  // 下碟腹（发射口所在）
  ctx.beginPath();
  ctx.ellipse(130, 104, 66, 20, 0, 0, Math.PI);
  const bg = ctx.createLinearGradient(0, 96, 0, 124);
  bg.addColorStop(0, '#5d6a80');
  bg.addColorStop(1, '#2c3445');
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 发射口
  ctx.beginPath();
  ctx.ellipse(130, 120, 22, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#9ff7ff';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(130, 119, 12, 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // 主碟盘：金属渐变
  ctx.beginPath();
  ctx.ellipse(130, 92, 120, 28, 0, 0, Math.PI * 2);
  const mg = ctx.createLinearGradient(0, 64, 0, 120);
  mg.addColorStop(0, '#f4f7fb');
  mg.addColorStop(0.35, '#c9d2de');
  mg.addColorStop(0.62, '#8e9bb0');
  mg.addColorStop(1, '#56627a');
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 碟沿装饰带
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(130, 92, 120, 28, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(130, 98, 120, 16, 0, 0, Math.PI);
  ctx.fillStyle = '#ff6b5a';
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(130, 104, 120, 14, 0, 0, Math.PI);
  ctx.fillStyle = '#a63a33';
  ctx.fill();
  ctx.restore();
  // 面板分割线
  ctx.strokeStyle = 'rgba(40,48,64,0.45)';
  ctx.lineWidth = 1.5;
  for (const t of [-0.75, -0.4, 0, 0.4, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(130 + t * 80, 74 + Math.abs(t) * 4);
    ctx.lineTo(130 + t * 118, 92);
    ctx.stroke();
  }
  // 顶面高光
  ctx.beginPath();
  ctx.ellipse(118, 76, 70, 7, -0.03, Math.PI * 1.05, Math.PI * 1.95);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // 玻璃罩底座环
  ctx.beginPath();
  ctx.ellipse(130, 76, 56, 10, 0, 0, Math.PI * 2);
  const rg = ctx.createLinearGradient(0, 66, 0, 86);
  rg.addColorStop(0, '#e8edf4');
  rg.addColorStop(1, '#7d8aa0');
  ctx.fillStyle = rg;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 灯座（灯本身单独做成精灵）
  for (const [lx, ly] of UFO_LIGHTS) {
    ctx.beginPath();
    ctx.ellipse(UFO_CX + lx, UFO_CY + ly, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3a2a30';
    ctx.fill();
  }
}

/** 碟身：碟盘 + 玻璃罩 + 外星人驾驶员。 */
export function drawUfo(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  saucer(ctx);
  domeGlass(ctx);
  alien(ctx);
  domeShine(ctx);
}

/** 舷灯：暖黄小灯 + 外发光，运行时单独闪烁。 */
export function drawLight(ctx: CanvasRenderingContext2D, size: number, hex: string): void {
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.25, hex);
  g.addColorStop(0.5, hex + '88');
  g.addColorStop(1, hex + '00');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}
