// 飞碟矢量绘制（纯 Canvas 2D，便于离线出图预览）。
// 机甲风：与战机同一套高达涂装（白装甲 + 高达蓝骨架 + 红色部件 + 金色 V 鳍 + 青色发光）。
// 碟身与舷灯分开烘焙：舷灯单独做成精灵，运行时逐个闪烁。

export const UFO_W = 260;
export const UFO_H = 150;
/** 碟身中心（贴图锚点） */
export const UFO_CX = 130;
export const UFO_CY = 92;
/** 牵引光束发射口（相对碟身中心） */
export const UFO_EMITTER_Y = 30;
/** 舷灯位置（相对碟身中心），嵌在蓝色裙甲带上 */
export const UFO_LIGHTS: Array<[number, number]> = Array.from({ length: 7 }, (_, i) => {
  const x = -90 + i * 30;
  return [x, 7 + (1 - (x / 120) ** 2) * 3];
});

const OUTLINE = '#172239';

type Ctx = CanvasRenderingContext2D;

/** 左右镜像（碟身左右对称，只描左半边） */
const mir = (pts: number[]): number[] => pts.map((v, i) => (i % 2 === 0 ? UFO_W - v : v));

function poly(ctx: Ctx, pts: number[], fill: string | CanvasGradient, stroke = OUTLINE, width = 2): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (width) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function seam(ctx: Ctx, pts: number[], color = '#66758b', width = 1.2): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** 左右各一份：左半边用正向渐变，右半边用反向渐变，光源统一在左上 */
function pair(ctx: Ctx, pts: number[], fillL: string | CanvasGradient, fillR: string | CanvasGradient, stroke = OUTLINE, width = 2): void {
  poly(ctx, pts, fillL, stroke, width);
  poly(ctx, mir(pts), fillR, stroke, width);
}

interface Palette {
  white: CanvasGradient;
  whiteR: CanvasGradient;
  blue: CanvasGradient;
  red: CanvasGradient;
  glass: CanvasGradient;
  metal: CanvasGradient;
}

function palette(ctx: Ctx): Palette {
  const white = ctx.createLinearGradient(20, 40, 200, 120);
  white.addColorStop(0, '#ffffff');
  white.addColorStop(0.45, '#e9eef5');
  white.addColorStop(1, '#aebbd0');
  const whiteR = ctx.createLinearGradient(240, 40, 60, 120);
  whiteR.addColorStop(0, '#f4f7fb');
  whiteR.addColorStop(0.45, '#dfe5ee');
  whiteR.addColorStop(1, '#a3b0c6');
  const blue = ctx.createLinearGradient(0, 90, 0, 114);
  blue.addColorStop(0, '#3a68b8');
  blue.addColorStop(1, '#14294f');
  const red = ctx.createLinearGradient(0, 70, 0, 110);
  red.addColorStop(0, '#ff6258');
  red.addColorStop(0.45, '#d9323c');
  red.addColorStop(1, '#851f30');
  const glass = ctx.createLinearGradient(110, 44, 150, 66);
  glass.addColorStop(0, '#d9fbff');
  glass.addColorStop(0.28, '#58d9f1');
  glass.addColorStop(0.65, '#167b9f');
  glass.addColorStop(1, '#092c4b');
  const metal = ctx.createLinearGradient(0, 104, 0, 124);
  metal.addColorStop(0, '#4a566c');
  metal.addColorStop(1, '#1b2436');
  return { white, whiteR, blue, red, glass, metal };
}
/** 碟腹：深色机械底盘、两侧推进舱、中央牵引光束发射口。 */
function belly(ctx: Ctx, p: Palette): void {
  // 推进舱：深色外壳 + 青色喷口
  pair(ctx, [30, 102, 62, 108, 60, 120, 38, 116], '#14233a', '#14233a', '#080f1d', 2);
  for (const x of [48, UFO_W - 48]) {
    ctx.save();
    ctx.shadowColor = '#5deaff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(x, 117, 8, 2.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7ff6ff';
    ctx.fill();
    ctx.restore();
  }
  // 底盘
  poly(ctx, [22, 104, 60, 110, 130, 112, 200, 110, 238, 104, 200, 117, 164, 121, 96, 121, 60, 117], p.metal, '#080f1d', 2);
  seam(ctx, [62, 112, 96, 117, 164, 117, 198, 112], '#5e6b80', 1);
  // 发射口外壳
  poly(ctx, [90, 112, 170, 112, 158, 128, 102, 128], '#14233a', '#080f1d', 2);
  seam(ctx, [98, 116, 162, 116], '#8b9aaf', 1);
  // 发射口：发光环 + 涡轮叶片（与战机引擎同款）
  ctx.save();
  ctx.shadowColor = '#5deaff';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.ellipse(130, 122, 22, 5.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#38dff5';
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(130, 122, 19, 4.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#10263e';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = '#a5f7ff';
  ctx.stroke();
  ctx.strokeStyle = '#70d9e9';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(130 + Math.cos(a) * 5, 122 + Math.sin(a) * 1.2);
    ctx.lineTo(130 + Math.cos(a + 0.3) * 17, 122 + Math.sin(a + 0.3) * 3.7);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(130, 122, 5, 1.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#efffff';
  ctx.fill();
}

/** 主碟盘：深色骨架 + 白色上甲 + 蓝色裙甲带 + 红色翼端。 */
function hull(ctx: Ctx, p: Palette): void {
  // 一体式深色骨架，比装甲略大一圈，露出机械缝隙
  poly(ctx, [4, 95, 24, 82, 60, 71, 98, 66, 162, 66, 200, 71, 236, 82, 256, 95, 240, 108, 200, 113, 130, 115, 60, 113, 20, 108], '#111a2c', '#080d18', 3);

  // 上甲：左右两块白色复合装甲，中线留缝
  poly(ctx, [10, 93, 28, 83, 62, 73, 98, 68, 129, 68, 129, 96, 60, 95], p.white, '#1a2940', 2);
  poly(ctx, mir([10, 93, 28, 83, 62, 73, 98, 68, 129, 68, 129, 96, 60, 95]), p.whiteR, '#1a2940', 2);
  // 顶沿高光
  seam(ctx, [30, 84, 62, 75, 98, 70, 126, 70], 'rgba(255,255,255,0.95)', 1.6);
  // 装甲分片缝与灰色内衬
  for (const s of [[62, 74, 54, 94], [98, 69, 94, 95]]) {
    seam(ctx, s);
    seam(ctx, mir(s));
  }
  pair(ctx, [68, 78, 90, 74, 88, 90, 64, 91], '#c4cede', '#b8c3d5', '#65748b', 1);
  // 红色散热口
  pair(ctx, [36, 87, 48, 84, 46, 91, 34, 92], p.red, p.red, '#762435', 1);
  for (const y of [86.5, 89]) {
    seam(ctx, [37, y + 1, 46, y - 1.5], '#5a1626', 0.8);
    seam(ctx, mir([37, y + 1, 46, y - 1.5]), '#5a1626', 0.8);
  }

  // 蓝色裙甲带（舷灯嵌在这里）
  poly(ctx, [10, 93, 60, 95, 130, 96, 200, 95, 250, 93, 238, 104, 200, 110, 130, 112, 60, 110, 22, 104], p.blue, '#101a2e', 2);
  seam(ctx, [26, 101, 60, 106, 130, 108, 200, 106, 234, 101], '#5f86c9', 1);
  for (const x of [76, 104]) {
    seam(ctx, [x, 96, x, 110], '#0d1830', 1.2);
    seam(ctx, mir([x, 96, x, 110]), '#0d1830', 1.2);
  }
  // 灯座
  for (const [lx, ly] of UFO_LIGHTS) {
    ctx.beginPath();
    ctx.roundRect(UFO_CX + lx - 5, UFO_CY + ly - 2.5, 10, 5, 1.5);
    ctx.fillStyle = '#0a1222';
    ctx.fill();
  }

  // 红色翼端
  pair(ctx, [4, 95, 22, 83, 32, 86, 26, 97, 18, 106], p.red, p.red, '#561c2b', 2);
  seam(ctx, [12, 94, 25, 87], '#ff9a90', 1);
  seam(ctx, mir([12, 94, 25, 87]), '#ff9a90', 1);
}
/** 舰桥：肩甲、白色头部、青色护目镜、红色传感冠与金色 V 鳍。 */
function bridge(ctx: Ctx, p: Palette): void {
  // 肩甲
  pair(ctx, [64, 74, 74, 61, 94, 57, 100, 69], p.white, p.whiteR, OUTLINE, 2);
  pair(ctx, [72, 66, 76, 61, 93, 58, 94, 62], p.red, p.red, '#762435', 1);
  seam(ctx, [70, 72, 98, 68], '#66758b', 1);
  seam(ctx, mir([70, 72, 98, 68]), '#66758b', 1);

  // 头部底座（蓝）+ 白色面甲
  poly(ctx, [96, 71, 102, 62, 158, 62, 164, 71], p.blue, '#101a2e', 2);
  poly(ctx, [100, 64, 106, 50, 120, 41, 130, 40, 130, 64], p.white, OUTLINE, 2);
  poly(ctx, mir([100, 64, 106, 50, 120, 41, 130, 40, 130, 64]), p.whiteR, OUTLINE, 2);

  // 护目镜：深青玻璃 + 高光 + 双眼发光线
  poly(ctx, [107, 57, 117, 48, 143, 48, 153, 57, 148, 63, 112, 63], p.glass, '#0b253e', 1.6);
  poly(ctx, [114, 52, 119, 49.5, 134, 49.5, 130, 52.5], 'rgba(233,253,255,0.9)', 'transparent', 0);
  ctx.save();
  ctx.shadowColor = '#5deaff';
  ctx.shadowBlur = 6;
  seam(ctx, [114, 59, 124, 57], '#bdfbff', 1.8);
  seam(ctx, mir([114, 59, 124, 57]), '#bdfbff', 1.8);
  ctx.restore();

  // 红色传感冠 + 金色 V 鳍
  poly(ctx, [124, 42, 130, 26, 136, 42], p.red, '#812536', 1.4);
  poly(ctx, [129, 43, 106, 17, 111, 16, 133, 38], '#ffd84b', '#8b6420', 1.4);
  poly(ctx, mir([129, 43, 106, 17, 111, 16, 133, 38]), '#f0c63a', '#8b6420', 1.4);
  seam(ctx, [112, 20, 126, 37], '#fff1b0', 0.8);

  // 涂装标识与铆钉
  ctx.fillStyle = '#24344d';
  ctx.font = '700 6px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(112, 82);
  ctx.rotate(-0.04);
  ctx.fillText('RX-0U', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(148, 82);
  ctx.rotate(0.04);
  ctx.fillText('E.F.S.F.', 0, 0);
  ctx.restore();
  ctx.fillStyle = '#e9b928';
  for (const [x, y] of [[58, 90], [UFO_W - 58, 90], [102, 66], [UFO_W - 102, 66]]) {
    ctx.beginPath();
    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 碟身：碟腹 + 主碟盘 + 舰桥。 */
export function drawUfo(ctx: CanvasRenderingContext2D): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const p = palette(ctx);
  belly(ctx, p);
  hull(ctx, p);
  bridge(ctx, p);
}

/** 舷灯：小灯 + 外发光，运行时单独闪烁。 */
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
