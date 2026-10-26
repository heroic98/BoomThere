// 牛马矢量绘制（纯 Canvas 2D，不依赖 Pixi，便于离线出图预览）。
// 侧视、朝右；腿为两段关节式，按姿势参数烘焙成多帧步态。

export type AnimalKind = 'cow' | 'horse';
export type FrameName =
  | `run${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}`
  | 'stand' | 'blink' | 'rear' | 'slam'
  | 'graze' | 'chew0' | 'chew1' | 'shock';

/** 逻辑画布尺寸、地面线与身体中心（贴图锚点）。 */
export const ART_W = 240;
export const ART_H = 212;
export const ART_GROUND = 202;
/** 绘制坐标内的地面线（画布顶部留 32px 给人立的马头） */
const GROUND = 170;
const TOP_PAD = ART_GROUND - GROUND;
export const ART_CX = 118;
export const RUN_FRAMES = 8;
/** 每种牛马的花色数 */
export const VARIANTS = 2;

/** 腿：[上段角度, 关节弯曲]，角度以竖直向下为 0，正值朝前。 */
type Leg = [number, number];
type Eye = 'open' | 'shut' | 'happy' | 'wide';
type Mouth = 'line' | 'open' | 'chew0' | 'chew1';
interface Pose {
  pitch: number;
  /** 远后、远前、近后、近前 */
  legs: [Leg, Leg, Leg, Leg];
  tail: number;
  /** 头颈绕颈根旋转，正值低头 */
  head: number;
  /** 耳朵：正值竖起/前倾，负值后贴/耷拉 */
  ear: number;
  eye: Eye;
  mouth: Mouth;
}

interface Spec {
  hindHip: [number, number];
  frontHip: [number, number];
  /** 头颈旋转支点（藏在躯干内） */
  neck: [number, number];
  /** 口鼻中心（用于定位吃草点） */
  muzzle: [number, number];
  l1: number;
  l2: number;
  w1: number;
  w2: number;
  rearPitch: number;
}

const OUTLINE = '#2a201c';
const SPECS: Record<AnimalKind, Spec> = {
  horse: { hindHip: [84, 94], frontHip: [150, 94], neck: [160, 84], muzzle: [226, 62], l1: 37, l2: 39, w1: 12, w2: 7, rearPitch: -0.42 },
  cow: { hindHip: [74, 114], frontHip: [158, 116], neck: [172, 88], muzzle: [218, 96], l1: 27, l2: 29, w1: 14, w2: 10, rearPitch: -0.28 },
};
type Ramp = [string, string, string];
interface HorsePalette {
  coat: Ramp; neck: Ramp; head: Ramp;
  rimHi: string; rimLo: string; fur: string;
  mane: string; maneHi: string;
  legFar: string; legNear: string; lowerFar: string; lowerNear: string; hoof: string;
  earFar: string; earNear: string; earInner: string; blaze: string;
}
interface CowPalette {
  hide: Ramp; spot: string; spotHi: string; legFar: string; legNear: string; lowerNear: string;
  hoof: string; muzzle: string; nostril: string; udder: string;
}

const HORSES: HorsePalette[] = [
  { // 枣红马
    coat: ['#d48a54', '#ad6034', '#7a3c1e'], neck: ['#d98f5a', '#b1653a', '#87462a'], head: ['#dd9562', '#b86c3e', '#93502c'],
    rimHi: 'rgba(255,224,186,0.75)', rimLo: 'rgba(72,30,12,0.55)', fur: 'rgba(110,52,24,0.35)',
    mane: '#2b1d18', maneHi: '#5a4034',
    legFar: '#7a3d1f', legNear: '#b36839', lowerFar: '#1f1714', lowerNear: '#2e2320', hoof: '#1a1412',
    earFar: '#8a4826', earNear: '#c27443', earInner: '#6b3a24', blaze: '#fbf1df',
  },
  { // 黑马白袜
    coat: ['#6c5a50', '#3e322d', '#231b18'], neck: ['#71605a', '#433630', '#2a201c'], head: ['#7a685e', '#4a3c36', '#30262a'],
    rimHi: 'rgba(214,196,184,0.6)', rimLo: 'rgba(10,6,4,0.55)', fur: 'rgba(14,10,8,0.4)',
    mane: '#141010', maneHi: '#463a35',
    legFar: '#2c221e', legNear: '#45372f', lowerFar: '#bdb4a8', lowerNear: '#f1ebe1', hoof: '#3a302b',
    earFar: '#2c221e', earNear: '#4c3d36', earInner: '#1c1512', blaze: '#f4ede2',
  },
];
const COWS: CowPalette[] = [
  { // 黑白花
    hide: ['#ffffff', '#f5f0e7', '#d3c8b9'], spot: '#2a2422', spotHi: 'rgba(120,110,104,0.55)',
    legFar: '#d1c6b7', legNear: '#f8f3ea', lowerNear: '#f1ebe0', hoof: '#2f2724',
    muzzle: '#f4aca3', nostril: '#7a3a36', udder: '#f2aaa2',
  },
  { // 黄褐花
    hide: ['#fffaf1', '#f6ecdc', '#d8c6ad'], spot: '#9a5a32', spotHi: 'rgba(214,150,100,0.6)',
    legFar: '#d6c6b0', legNear: '#faf2e6', lowerNear: '#f3e8d8', hoof: '#4a362a',
    muzzle: '#f1b49c', nostril: '#7d3e2c', udder: '#f0b0a0',
  },
];
const STAND_LEGS: Pose['legs'] = [[-0.12, 0.12], [0.1, -0.05], [-0.04, 0.06], [0.02, 0]];

function poseOf(kind: AnimalKind, name: FrameName): Pose {
  const base: Pose = { pitch: 0, legs: STAND_LEGS, tail: 0.2, head: 0, ear: 0, eye: 'open', mouth: 'line' };
  switch (name) {
    case 'stand': return base;
    case 'blink': return { ...base, eye: 'shut', ear: -0.15 };
    case 'rear':
      return { ...base, legs: [[0.3, 0.05], [1.0, -1.7], [0.18, 0.02], [0.7, -1.9]], tail: 0.9, head: -0.12, ear: -0.35, mouth: 'open' };
    case 'slam':
      return { ...base, pitch: 0.06, legs: [[-0.42, 0.25], [0.42, -0.08], [-0.3, 0.2], [0.26, -0.02]], tail: 0.6, head: 0.14, ear: 0.35, eye: 'shut' };
    case 'graze':
      // 前腿外撑、低头啃草
      return { ...base, pitch: kind === 'horse' ? 0.14 : 0.1, legs: [[-0.1, 0.1], [0.22, -0.12], [-0.02, 0.05], [0.3, -0.16]], tail: 0.35, head: kind === 'horse' ? 1.3 : 0.95, ear: -0.35, eye: 'happy' };
    case 'chew0':
    case 'chew1':
      return { ...base, tail: name === 'chew0' ? 0.25 : 0.45, head: -0.06, ear: name === 'chew0' ? -0.2 : -0.28, eye: 'happy', mouth: name };
    case 'shock':
      return { ...base, legs: [[-0.2, 0.3], [0.2, -0.2], [-0.12, 0.25], [0.12, -0.15]], tail: 1.1, head: -0.18, ear: 0.45, eye: 'wide', mouth: 'open' };
    default: break;
  }
  // 飞奔：前后肢反相（收拢 ↔ 伸展），近远侧错开相位；头随步点点头，耳朵后贴
  const f = Number(name.slice(3));
  const p = (f / RUN_FRAMES) * Math.PI * 2;
  const front = (o: number): Leg => [0.62 * Math.sin(p + o), -1.5 * Math.max(0, Math.cos(p + o))];
  const hind = (o: number): Leg => [-0.12 - 0.55 * Math.sin(p + o), 0.15 + 1.25 * Math.max(0, -Math.cos(p + o))];
  return {
    pitch: 0.07 * Math.sin(p),
    legs: [hind(0.7), front(0.7), hind(0), front(0)],
    tail: 0.7 + 0.25 * Math.sin(p * 2),
    head: 0.04 + 0.08 * Math.sin(p - 0.8),
    ear: kind === 'horse' ? -0.45 : -0.25 + 0.3 * Math.sin(p + 1.2),
    eye: 'open',
    mouth: 'line',
  };
}
type Pt = [number, number];
const dir = (a: number): Pt => [Math.sin(a), Math.cos(a)];

function rotAround(pt: Pt, piv: Pt, a: number): Pt {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = pt[0] - piv[0];
  const dy = pt[1] - piv[1];
  return [piv[0] + dx * c - dy * s, piv[1] + dx * s + dy * c];
}

interface LegGeo {
  hip: Pt;
  knee: Pt;
  hoof: Pt;
  lowerAngle: number;
}

function legGeo(spec: Spec, hip: Pt, leg: Leg): LegGeo {
  const [u, b] = leg;
  const d1 = dir(u);
  const knee: Pt = [hip[0] + d1[0] * spec.l1, hip[1] + d1[1] * spec.l1];
  const d2 = dir(u + b);
  const hoof: Pt = [knee[0] + d2[0] * spec.l2, knee[1] + d2[1] * spec.l2];
  return { hip, knee, hoof, lowerAngle: u + b };
}

function seg(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
}

function drawLeg(ctx: CanvasRenderingContext2D, spec: Spec, g: LegGeo, upper: string, lower: string, hoofColor: string, near: boolean): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 先整条描边，再分段填色，关节处不出现描边断缝
  // 大腿/肩部肌肉：靠近髋部的一段加粗，避免火柴腿
  const thighTop: Pt = [g.hip[0], g.hip[1] - 4];
  const thigh: Pt = [g.hip[0] + (g.knee[0] - g.hip[0]) * 0.42, g.hip[1] + (g.knee[1] - g.hip[1]) * 0.42];
  // 小腿下端略细，靠蹄处有个球节
  const fetlock: Pt = [g.knee[0] + (g.hoof[0] - g.knee[0]) * 0.82, g.knee[1] + (g.hoof[1] - g.knee[1]) * 0.82];
  seg(ctx, thighTop, thigh, OUTLINE, spec.w1 * 1.75 + 5);
  seg(ctx, g.hip, g.knee, OUTLINE, spec.w1 + 5);
  seg(ctx, g.knee, g.hoof, OUTLINE, spec.w2 + 5);
  ctx.fillStyle = OUTLINE;
  ctx.beginPath(); ctx.arc(fetlock[0], fetlock[1], spec.w2 * 0.62 + 2.5, 0, Math.PI * 2); ctx.fill();
  seg(ctx, thighTop, thigh, upper, spec.w1 * 1.75);
  seg(ctx, g.hip, g.knee, upper, spec.w1);
  seg(ctx, g.knee, g.hoof, lower, spec.w2);
  ctx.fillStyle = lower;
  ctx.beginPath(); ctx.arc(g.knee[0], g.knee[1], spec.w2 * 0.58, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(fetlock[0], fetlock[1], spec.w2 * 0.62, 0, Math.PI * 2); ctx.fill();
  // 体积：前缘一道高光，后缘一道暗面
  if (near) {
    const off = (p: Pt, k: number): Pt => [p[0] + k, p[1]];
    seg(ctx, off(thighTop, spec.w1 * 0.45), off(g.knee, spec.w1 * 0.2), 'rgba(255,255,255,0.22)', spec.w1 * 0.32);
    seg(ctx, off(thighTop, -spec.w1 * 0.55), off(thigh, -spec.w1 * 0.4), 'rgba(0,0,0,0.16)', spec.w1 * 0.45);
    seg(ctx, off(g.knee, spec.w2 * 0.2), off(fetlock, spec.w2 * 0.2), 'rgba(255,255,255,0.2)', spec.w2 * 0.28);
  }
  // 蹄子：沿小腿方向的梯形
  ctx.save();
  ctx.translate(...g.hoof);
  ctx.rotate(-g.lowerAngle);
  const hw = spec.w2 * 0.62;
  ctx.beginPath();
  ctx.moveTo(-hw, -5);
  ctx.lineTo(hw, -5);
  ctx.lineTo(hw + 3, 1);
  ctx.quadraticCurveTo(0, 3, -hw - 1, 1);
  ctx.closePath();
  ctx.fillStyle = hoofColor;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-hw + 1.5, -3.6, hw * 0.7, 1.4);
  ctx.restore();
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, width = 3): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function bodyGradient(ctx: CanvasRenderingContext2D, top: number, bottom: number, [light, mid, dark]: Ramp): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, light);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, dark);
  return g;
}

/**
 * 在当前路径内部加体积光：上沿亮边 + 下沿环境遮蔽。
 * 用「平移后的同一路径」做反向裁切得到贴边的月牙形，比直接渐变更像圆柱体。
 */
function rimLight(ctx: CanvasRenderingContext2D, path: () => void, hi: string, lo: string, dy = 5): void {
  ctx.save();
  path();
  ctx.clip();
  for (const [color, off] of [[hi, dy], [lo, -dy * 1.4]] as Array<[string, number]>) {
    // path() 自带 beginPath，所以先画平移后的形状，再追加外框子路径
    ctx.save();
    ctx.translate(off * 0.25, off);
    path();
    ctx.restore();
    ctx.rect(-50, -50, ART_W + 100, ART_H + 100);
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  }
  ctx.restore();
}

/** 毛发短笔触：沿给定点列画一组小弧线。 */
function furStrokes(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, len = 6, ang = 0.5): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - len * 0.4, y + len * Math.sin(ang) * 0.4, x - len * Math.cos(ang), y + len * Math.sin(ang));
    ctx.stroke();
  }
}

/** 眼睛：睁眼/闭眼/眯眼笑/瞪眼，带眼皮与高光。 */
function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, eye: Eye, lidTilt: number): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  if (eye === 'shut') {
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(x - r, y - 0.5); ctx.quadraticCurveTo(x, y + r * 0.7, x + r, y - 0.5); ctx.stroke();
    // 睫毛
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x - r * 0.4, y + r * 0.35); ctx.lineTo(x - r * 0.7, y + r * 0.9); ctx.stroke();
    return;
  }
  if (eye === 'happy') {
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.3); ctx.quadraticCurveTo(x, y - r * 0.9, x + r, y + r * 0.3); ctx.stroke();
    return;
  }
  const rr = eye === 'wide' ? r * 1.45 : r;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(x, y, rr * 1.15, rr * 1.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.stroke();
  const pr = eye === 'wide' ? rr * 0.42 : rr * 0.72;
  ctx.fillStyle = '#16110f';
  ctx.beginPath(); ctx.arc(x + rr * 0.25, y + 0.3, pr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x + rr * 0.25 + pr * 0.35, y - pr * 0.4, Math.max(0.9, pr * 0.38), 0, Math.PI * 2); ctx.fill();
  if (eye === 'open') {
    // 半垂眼皮：牛马特有的「上班脸」
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y, rr * 1.15, rr * 1.05, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(60,40,30,0.9)';
    ctx.beginPath();
    ctx.moveTo(x - rr * 1.3, y - rr * 1.2);
    ctx.lineTo(x + rr * 1.3, y - rr * 1.2);
    ctx.lineTo(x + rr * 1.3, y - rr * 0.15 + lidTilt);
    ctx.lineTo(x - rr * 1.3, y - rr * 0.15 - lidTilt);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x - rr * 1.1, y - rr * 0.15 - lidTilt); ctx.lineTo(x + rr * 1.15, y - rr * 0.15 + lidTilt); ctx.stroke();
  }
}

function rotated(ctx: CanvasRenderingContext2D, piv: Pt, a: number, draw: () => void): void {
  ctx.save();
  ctx.translate(...piv); ctx.rotate(a); ctx.translate(-piv[0], -piv[1]);
  draw();
  ctx.restore();
}

/** 头颈变换：绕颈根旋转。 */
const withHead = (ctx: CanvasRenderingContext2D, spec: Spec, a: number, draw: () => void): void => rotated(ctx, spec.neck, a, draw);
// ---------------- 马 ----------------

function horseTail(ctx: CanvasRenderingContext2D, c: HorsePalette, lift: number): void {
  const tipY = 112 - lift * 44;
  const tipX = 22 - lift * 6;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(66, 66);
    ctx.bezierCurveTo(46, 60 - lift * 10, 34, 70 - lift * 20, tipX, tipY);
    ctx.bezierCurveTo(30, tipY - 4, 34, tipY + 10, 42, tipY + 6);
    ctx.bezierCurveTo(48, 92 - lift * 18, 56, 82, 68, 78);
    ctx.closePath();
  };
  path();
  fillStroke(ctx, c.mane, 2.5);
  // 几缕发丝分叉
  ctx.strokeStyle = c.maneHi;
  ctx.lineWidth = 1.5;
  for (const k of [0, 6, 12]) {
    ctx.beginPath();
    ctx.moveTo(62 - k * 0.3, 70 + k * 0.4);
    ctx.quadraticCurveTo(44 - k * 0.2, 72 - lift * 14 + k, tipX + 8 + k * 0.6, tipY + 2 - k * 0.3);
    ctx.stroke();
  }
}

function horseNeck(ctx: CanvasRenderingContext2D, c: HorsePalette): void {
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(138, 64);
    ctx.bezierCurveTo(152, 42, 172, 24, 194, 20);
    ctx.lineTo(206, 38);
    ctx.bezierCurveTo(194, 52, 184, 70, 178, 94);
    ctx.lineTo(156, 98);
    ctx.closePath();
  };
  path();
  fillStroke(ctx, bodyGradient(ctx, 20, 98, c.neck));
  rimLight(ctx, path, c.rimHi, c.rimLo, 4);
  // 颈部肌肉沟
  ctx.strokeStyle = c.fur;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(176, 40); ctx.quadraticCurveTo(172, 62, 166, 82); ctx.stroke();
}

function horseBodyPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(62, 72);
  ctx.bezierCurveTo(60, 58, 76, 52, 94, 56);
  ctx.bezierCurveTo(112, 61, 130, 62, 146, 56);
  ctx.bezierCurveTo(166, 52, 182, 68, 180, 86);
  ctx.bezierCurveTo(178, 100, 168, 106, 156, 106);
  ctx.bezierCurveTo(132, 110, 110, 108, 92, 104);
  ctx.bezierCurveTo(70, 102, 58, 90, 62, 72);
  ctx.closePath();
}

function horseBody(ctx: CanvasRenderingContext2D, c: HorsePalette): void {
  const path = (): void => horseBodyPath(ctx);
  path();
  fillStroke(ctx, bodyGradient(ctx, 54, 108, c.coat));
  rimLight(ctx, path, c.rimHi, c.rimLo, 5);
  // 后臀与肩部的高光弧，肋部暗沟
  ctx.save();
  path();
  ctx.clip();
  const glow = (x: number, y: number, r: number): void => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,230,200,0.38)');
    g.addColorStop(1, 'rgba(255,230,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  glow(84, 70, 20);
  glow(162, 72, 15);
  ctx.restore();
  ctx.strokeStyle = c.fur;
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(86, 78, 17, -2.7, -0.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(150, 66); ctx.quadraticCurveTo(156, 82, 152, 98); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(108, 98); ctx.quadraticCurveTo(128, 104, 146, 98); ctx.stroke();
  furStrokes(ctx, [[120, 72], [128, 78], [114, 84], [134, 88]], c.fur, 5, 0.6);
}

function horseHead(ctx: CanvasRenderingContext2D, c: HorsePalette, pose: Pose): void {
  // 远侧耳
  rotated(ctx, [192, 20], pose.ear * 0.8, () => {
    ctx.beginPath();
    ctx.moveTo(188, 22); ctx.lineTo(185, 6); ctx.lineTo(196, 18); ctx.closePath();
    fillStroke(ctx, c.earFar, 2);
  });
  // 头：额 → 鼻梁 → 圆口鼻 → 下颌圆腮
  const jaw = pose.mouth === 'open' ? 5 : pose.mouth === 'chew0' ? 2 : pose.mouth === 'chew1' ? 3.5 : 0;
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(190, 22);
    ctx.bezierCurveTo(198, 14, 210, 16, 214, 24);
    ctx.lineTo(232, 52);
    ctx.bezierCurveTo(237, 61, 232, 70, 223, 69);
    ctx.bezierCurveTo(216, 68 + jaw * 0.5, 211, 64 + jaw * 0.3, 206, 58);
    ctx.bezierCurveTo(198, 54, 190, 48, 188, 38);
    ctx.bezierCurveTo(186, 31, 186, 26, 190, 22);
    ctx.closePath();
  };
  if (jaw > 0) {
    // 张开的下巴：先画口腔与下颌
    ctx.beginPath();
    ctx.moveTo(207, 58); ctx.quadraticCurveTo(222, 72 + jaw, 228, 66 + jaw * 0.6); ctx.lineTo(230, 62); ctx.closePath();
    fillStroke(ctx, '#5a2a24', 2);
    ctx.beginPath(); ctx.ellipse(222, 66 + jaw * 0.4, 4, 2, 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#e47f86'; ctx.fill();
  }
  path();
  fillStroke(ctx, bodyGradient(ctx, 16, 70, c.head));
  rimLight(ctx, path, c.rimHi, c.rimLo, 3);
  // 白色流星
  ctx.beginPath();
  ctx.moveTo(207, 21);
  ctx.quadraticCurveTo(213, 22, 214, 28);
  ctx.lineTo(229, 54);
  ctx.quadraticCurveTo(226, 58, 222, 55);
  ctx.lineTo(206, 28);
  ctx.closePath();
  ctx.fillStyle = c.blaze;
  ctx.fill();
  // 口鼻暗色与鼻孔、嘴线
  ctx.beginPath();
  ctx.ellipse(225, 61, 9, 7, 0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,28,16,0.35)';
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  const flare = pose.mouth === 'open' || pose.eye === 'wide' ? 1.5 : 1;
  ctx.beginPath(); ctx.ellipse(228, 58, 2.6 * flare, 1.6 * flare, 0.8, 0, Math.PI * 2); ctx.fill();
  if (jaw === 0) {
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath(); ctx.moveTo(218, 66); ctx.quadraticCurveTo(222, 64, 226, 67); ctx.stroke();
  }
  // 腮部轮廓
  ctx.strokeStyle = c.fur;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(198, 40, 9, 0.2, 2.2); ctx.stroke();
  drawEye(ctx, 204, 31, 3.2, pose.eye, 0.8);
  // 近侧耳
  rotated(ctx, [198, 21], pose.ear, () => {
    ctx.beginPath();
    ctx.moveTo(195, 22); ctx.bezierCurveTo(192, 12, 194, 6, 198, 2); ctx.bezierCurveTo(202, 8, 204, 14, 203, 20); ctx.closePath();
    fillStroke(ctx, c.earNear, 2);
    ctx.beginPath();
    ctx.moveTo(197, 18); ctx.quadraticCurveTo(197, 10, 198.5, 7); ctx.quadraticCurveTo(201, 12, 200.5, 18); ctx.closePath();
    ctx.fillStyle = c.earInner;
    ctx.fill();
  });
}
function horseMane(ctx: CanvasRenderingContext2D, c: HorsePalette, blow: number): void {
  // 沿颈脊一排向后飘的鬃束，每束长度/弯度错开，避免整齐得像梳子
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  const crest: Pt[] = [[140, 62], [149, 50], [158, 40], [168, 32], [178, 26], [188, 21]];
  const lens = [17, 22, 18, 21, 16, 14];
  for (let i = 0; i < crest.length; i++) {
    const [cx, cy] = crest[i];
    const len = lens[i];
    const curl = (i % 2 ? 5 : -2) - blow * 6;
    ctx.beginPath();
    ctx.moveTo(cx + 9, cy - 4);
    ctx.quadraticCurveTo(cx - 2, cy - 12 - blow * 4, cx - len, cy + curl);
    ctx.quadraticCurveTo(cx - 4, cy + 2, cx + 4, cy + 7);
    ctx.closePath();
    ctx.fillStyle = c.mane;
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = c.maneHi;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(cx + 4, cy - 3); ctx.quadraticCurveTo(cx - 3, cy - 7 - blow * 3, cx - len * 0.7, cy + curl * 0.6); ctx.stroke();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 2;
  }
  // 额发
  ctx.beginPath();
  ctx.moveTo(194, 18);
  ctx.quadraticCurveTo(201, 13, 211, 22 + blow * 2);
  ctx.quadraticCurveTo(203, 21, 199, 26);
  ctx.quadraticCurveTo(198, 22, 196, 24);
  ctx.closePath();
  ctx.fillStyle = c.mane;
  ctx.fill();
  ctx.stroke();
}

/** 嘴里叼着的草（嚼草帧）。 */
function grassInMouth(ctx: CanvasRenderingContext2D, x: number, y: number, sway: number): void {
  ctx.lineCap = 'round';
  for (const [dx, len, a, col] of [[0, 16, 0.5, '#5f9d3a'], [2, 12, 0.9, '#7dbb47'], [-1, 10, 0.2, '#4c8a2e']] as Array<[number, number, number, string]>) {
    const ang = a + sway;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.quadraticCurveTo(x + dx + len * 0.5, y + 2, x + dx + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }
}

function drawHorse(ctx: CanvasRenderingContext2D, c: HorsePalette, pose: Pose, geos: LegGeo[], pivot: Pt): void {
  const spec = SPECS.horse;
  drawLeg(ctx, spec, geos[0], c.legFar, c.lowerFar, c.hoof, false);
  drawLeg(ctx, spec, geos[1], c.legFar, c.lowerFar, c.hoof, false);
  rotated(ctx, pivot, pose.pitch, () => {
    horseTail(ctx, c, pose.tail);
    withHead(ctx, spec, pose.head, () => horseNeck(ctx, c));
    horseBody(ctx, c);
  });
  drawLeg(ctx, spec, geos[2], c.legNear, c.lowerNear, c.hoof, true);
  drawLeg(ctx, spec, geos[3], c.legNear, c.lowerNear, c.hoof, true);
  rotated(ctx, pivot, pose.pitch, () => withHead(ctx, spec, pose.head, () => {
    horseMane(ctx, c, pose.tail);
    horseHead(ctx, c, pose);
    if (pose.mouth === 'chew0' || pose.mouth === 'chew1') grassInMouth(ctx, 224, 68, pose.mouth === 'chew0' ? 0 : 0.25);
  }));
}
// ---------------- 牛 ----------------

function cowTail(ctx: CanvasRenderingContext2D, c: CowPalette, lift: number): void {
  const tx = 30 - lift * 10;
  const ty = 118 - lift * 40;
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(52, 74);
  ctx.quadraticCurveTo(36, 78 - lift * 20, tx + 4, ty);
  ctx.stroke();
  ctx.strokeStyle = c.hide[1];
  ctx.lineWidth = 3;
  ctx.stroke();
  // 尾穗：三绺毛
  ctx.save();
  ctx.translate(tx + 3, ty + 1);
  ctx.rotate(0.3 + lift * 0.8);
  for (const [a, l] of [[-0.35, 11], [0, 13], [0.35, 10]]) {
    ctx.beginPath();
    ctx.moveTo(-2.5, 0);
    ctx.quadraticCurveTo(Math.sin(a) * l - 3, l * 0.6, Math.sin(a) * l, l);
    ctx.quadraticCurveTo(Math.sin(a) * l + 3, l * 0.5, 2.5, 0);
    ctx.closePath();
    fillStroke(ctx, c.spot, 1.8);
  }
  ctx.restore();
}

function cowBodyPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(48, 80);
  ctx.bezierCurveTo(46, 64, 56, 58, 70, 60);
  ctx.bezierCurveTo(74, 55, 82, 54, 88, 58);
  ctx.bezierCurveTo(108, 63, 128, 61, 150, 60);
  ctx.bezierCurveTo(170, 60, 182, 72, 182, 90);
  ctx.bezierCurveTo(182, 106, 176, 118, 162, 122);
  ctx.bezierCurveTo(132, 128, 104, 128, 82, 124);
  ctx.bezierCurveTo(60, 122, 46, 108, 48, 80);
  ctx.closePath();
}

function cowSpot(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, seed: number): void {
  ctx.beginPath();
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = s * (0.78 + 0.32 * Math.sin(a * 3 + seed) + 0.12 * Math.cos(a * 5 + seed * 2));
    const px = x + Math.cos(a) * r * 1.25;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else {
      const pa = ((i - 0.5) / n) * Math.PI * 2;
      ctx.quadraticCurveTo(x + Math.cos(pa) * r * 1.5, y + Math.sin(pa) * r * 1.2, px, py);
    }
  }
  ctx.closePath();
}

const COW_SPOTS: Array<Array<[number, number, number, number]>> = [
  [[70, 72, 15, 1.3], [118, 64, 13, 4.1], [104, 110, 14, 2.2], [160, 100, 11, 5.7]],
  [[64, 92, 13, 2.8], [100, 70, 16, 0.6], [146, 74, 12, 3.3], [130, 116, 9, 5.1]],
];

function cowNeck(ctx: CanvasRenderingContext2D, c: CowPalette): void {
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(156, 64);
    ctx.bezierCurveTo(176, 54, 192, 52, 202, 58);
    ctx.lineTo(206, 92);
    ctx.bezierCurveTo(198, 106, 184, 116, 168, 122);
    ctx.closePath();
  };
  path();
  fillStroke(ctx, bodyGradient(ctx, 54, 122, c.hide));
  rimLight(ctx, path, 'rgba(255,255,255,0.7)', 'rgba(120,96,76,0.3)', 4);
  // 垂皮褶
  ctx.strokeStyle = 'rgba(120,100,85,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(196, 96); ctx.quadraticCurveTo(188, 106, 178, 110); ctx.stroke();
}

function cowBody(ctx: CanvasRenderingContext2D, c: CowPalette, variant: number): void {
  // 乳房
  ctx.beginPath();
  ctx.ellipse(94, 125, 14, 8, 0, 0, Math.PI);
  fillStroke(ctx, c.udder, 2.5);
  ctx.fillStyle = 'rgba(190,90,84,0.7)';
  for (const tx of [86, 94, 102]) {
    ctx.beginPath(); ctx.ellipse(tx, 134, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  const path = (): void => cowBodyPath(ctx);
  path();
  fillStroke(ctx, bodyGradient(ctx, 56, 128, c.hide));
  // 斑块裁剪在躯干内，带一点内侧亮边避免像贴纸
  ctx.save();
  path();
  ctx.clip();
  for (const [sx, sy, ss, seed] of COW_SPOTS[variant % COW_SPOTS.length]) {
    cowSpot(ctx, sx, sy, ss, seed);
    ctx.fillStyle = c.spot;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.translate(2, 3);
    cowSpot(ctx, sx, sy, ss, seed);
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.spotHi;
    ctx.stroke();
  }
  ctx.restore();
  rimLight(ctx, path, 'rgba(255,255,255,0.75)', 'rgba(110,86,66,0.32)', 6);
  path();
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 胯骨、肩胛、肋部的结构线
  ctx.strokeStyle = 'rgba(120,100,85,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(76, 80, 14, -2.2, -0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(158, 70); ctx.quadraticCurveTo(164, 86, 160, 100); ctx.stroke();
  ctx.lineWidth = 1.5;
  for (const k of [0, 7, 14]) {
    ctx.beginPath(); ctx.moveTo(122 + k, 92); ctx.quadraticCurveTo(126 + k, 102, 124 + k, 110); ctx.stroke();
  }
}
function cowHorn(ctx: CanvasRenderingContext2D, x: number, y: number, far: boolean): void {
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 2);
  ctx.bezierCurveTo(x - 6, y - 8, x - 2, y - 16, x + 8, y - 18);
  ctx.bezierCurveTo(x + 4, y - 12, x + 3, y - 6, x + 5, y + 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(x, y + 2, x + 8, y - 18);
  g.addColorStop(0, far ? '#d9c08a' : '#f6e3b0');
  g.addColorStop(0.75, far ? '#c7aa6e' : '#ecd298');
  g.addColorStop(1, '#5a4a3a');
  fillStroke(ctx, g, 2);
}

function cowEar(ctx: CanvasRenderingContext2D, c: CowPalette, ear: number): void {
  rotated(ctx, [192, 60], ear, () => {
    ctx.beginPath();
    ctx.moveTo(192, 58);
    ctx.bezierCurveTo(184, 50, 172, 50, 167, 57);
    ctx.bezierCurveTo(174, 63, 184, 65, 193, 63);
    ctx.closePath();
    fillStroke(ctx, c.hide[1], 2.5);
    ctx.beginPath();
    ctx.moveTo(188, 59);
    ctx.bezierCurveTo(182, 55, 176, 55, 172, 57.5);
    ctx.bezierCurveTo(178, 61, 184, 62, 188, 61);
    ctx.closePath();
    ctx.fillStyle = c.muzzle;
    ctx.fill();
  });
}

function cowHead(ctx: CanvasRenderingContext2D, c: CowPalette, pose: Pose): void {
  cowHorn(ctx, 196, 48, true);
  // 头：方头、略低垂
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(190, 54);
    ctx.bezierCurveTo(194, 44, 212, 42, 218, 50);
    ctx.lineTo(230, 82);
    ctx.bezierCurveTo(232, 92, 226, 104, 212, 104);
    ctx.bezierCurveTo(202, 104, 196, 98, 194, 90);
    ctx.closePath();
  };
  path();
  fillStroke(ctx, bodyGradient(ctx, 44, 104, c.hide));
  // 眼周斑块
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = c.spot;
  ctx.beginPath(); ctx.ellipse(202, 58, 11, 13, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  rimLight(ctx, path, 'rgba(255,255,255,0.7)', 'rgba(110,86,66,0.3)', 3);
  // 大口鼻：张嘴时下唇下移，嚼草时左右错动
  const jawY = pose.mouth === 'open' ? 6 : 0;
  const chewX = pose.mouth === 'chew0' ? -1.5 : pose.mouth === 'chew1' ? 1.5 : 0;
  if (jawY > 0) {
    ctx.beginPath();
    ctx.ellipse(216, 104, 10, 7, -0.3, 0, Math.PI * 2);
    fillStroke(ctx, '#5a2a24', 2);
    ctx.beginPath(); ctx.ellipse(214, 107, 5, 2.6, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#e47f86'; ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(218 + chewX, 93, 15, 12, -0.35, 0, Math.PI * 2);
  const mg = ctx.createRadialGradient(214, 88, 2, 218, 93, 16);
  mg.addColorStop(0, '#fcd0c8');
  mg.addColorStop(1, c.muzzle);
  fillStroke(ctx, mg, 2.5);
  const flare = pose.mouth === 'open' || pose.eye === 'wide' ? 1.35 : 1;
  ctx.fillStyle = c.nostril;
  ctx.beginPath(); ctx.ellipse(215 + chewX, 90, 2.4 * flare, 3.4 * flare, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(226 + chewX, 87, 2 * flare, 3 * flare, -0.3, 0, Math.PI * 2); ctx.fill();
  if (jawY === 0) {
    ctx.strokeStyle = c.nostril;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(210 + chewX, 100); ctx.quadraticCurveTo(218 + chewX * 2, 103, 226 + chewX, 98); ctx.stroke();
  }
  // 眼睛（白底在斑块上更醒目）
  drawEye(ctx, 205, 62, 3.8, pose.eye, -0.6);
  cowEar(ctx, c, pose.ear);
  cowHorn(ctx, 204, 48, false);
  // 额前一撮毛
  ctx.beginPath();
  ctx.moveTo(198, 46); ctx.quadraticCurveTo(204, 40, 212, 46); ctx.quadraticCurveTo(206, 44, 204, 50); ctx.closePath();
  fillStroke(ctx, c.hide[1], 2);
}

function drawCow(ctx: CanvasRenderingContext2D, c: CowPalette, variant: number, pose: Pose, geos: LegGeo[], pivot: Pt): void {
  const spec = SPECS.cow;
  drawLeg(ctx, spec, geos[0], c.legFar, c.legFar, c.hoof, false);
  drawLeg(ctx, spec, geos[1], c.legFar, c.legFar, c.hoof, false);
  rotated(ctx, pivot, pose.pitch, () => {
    cowTail(ctx, c, pose.tail);
    withHead(ctx, spec, pose.head, () => cowNeck(ctx, c));
    cowBody(ctx, c, variant);
  });
  drawLeg(ctx, spec, geos[2], c.legNear, c.lowerNear, c.hoof, true);
  drawLeg(ctx, spec, geos[3], c.legNear, c.lowerNear, c.hoof, true);
  rotated(ctx, pivot, pose.pitch, () => withHead(ctx, spec, pose.head, () => {
    cowHead(ctx, c, pose);
    if (pose.mouth === 'chew0' || pose.mouth === 'chew1') grassInMouth(ctx, 220, 102, pose.mouth === 'chew0' ? 0 : 0.25);
  }));
}
interface Layout {
  pose: Pose;
  geos: LegGeo[];
  pivot: Pt;
  dy: number;
}

function layoutOf(kind: AnimalKind, frame: FrameName): Layout {
  const spec = SPECS[kind];
  const pose = poseOf(kind, frame);
  if (frame === 'rear') pose.pitch = spec.rearPitch;
  const pivot: Pt = spec.hindHip;
  const hips: Pt[] = [
    [spec.hindHip[0] - 6, spec.hindHip[1] - 2],
    [spec.frontHip[0] - 6, spec.frontHip[1] - 2],
    spec.hindHip,
    spec.frontHip,
  ].map((h) => rotAround(h as Pt, pivot, pose.pitch));
  const geos = pose.legs.map((leg, i) => legGeo(spec, hips[i], leg));
  const lowest = Math.max(...geos.map((g) => g.hoof[1]));
  // 支撑腿落地：最低蹄对齐地面；腾空帧最多下沉 6px 形成起伏
  const dy = Math.min(GROUND - lowest, frame === 'rear' ? 0 : 6);
  return { pose, geos, pivot, dy };
}

/**
 * 在 ctx 当前坐标系（ART_W×ART_H 逻辑尺寸）画一帧。
 * 身体随前后蹄落地自动升降，保证支撑腿始终踩在地面线上。
 */
export function drawAnimal(ctx: CanvasRenderingContext2D, kind: AnimalKind, frame: FrameName, variant = 0): void {
  const { pose, geos, pivot, dy } = layoutOf(kind, frame);
  ctx.save();
  ctx.translate(0, TOP_PAD + dy);
  if (kind === 'horse') drawHorse(ctx, HORSES[variant % HORSES.length], pose, geos, pivot);
  else drawCow(ctx, COWS[variant % COWS.length], variant, pose, geos, pivot);
  ctx.restore();
}

/** 某帧口鼻相对锚点（ART_CX, ART_GROUND）的偏移，用于把草放到嘴下。 */
export function muzzleOffset(kind: AnimalKind, frame: FrameName): Pt {
  const spec = SPECS[kind];
  const { pose, pivot, dy } = layoutOf(kind, frame);
  const p = rotAround(rotAround(spec.muzzle, spec.neck, pose.head), pivot, pose.pitch);
  return [p[0] - ART_CX, p[1] + TOP_PAD + dy - ART_GROUND];
}

export const RUN_NAMES = Array.from({ length: RUN_FRAMES }, (_, i) => `run${i}` as FrameName);
export const ALL_FRAMES: FrameName[] = [...RUN_NAMES, 'stand', 'blink', 'rear', 'slam', 'graze', 'chew0', 'chew1', 'shock'];
