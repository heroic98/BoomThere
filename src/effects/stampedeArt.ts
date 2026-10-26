// 牛马矢量绘制（纯 Canvas 2D，不依赖 Pixi，便于离线出图预览）。
// 侧视、朝右；腿为两段关节式，按姿势参数烘焙成多帧步态。

export type AnimalKind = 'cow' | 'horse';
export type FrameName = `run${0 | 1 | 2 | 3 | 4 | 5}` | 'stand' | 'rear' | 'slam';

/** 逻辑画布尺寸、地面线与身体中心（贴图锚点）。 */
export const ART_W = 240;
export const ART_H = 212;
export const ART_GROUND = 202;
/** 绘制坐标内的地面线（画布顶部留 32px 给人立的马头） */
const GROUND = 170;
const TOP_PAD = ART_GROUND - GROUND;
export const ART_CX = 118;
export const RUN_FRAMES = 6;

/** 腿：[上段角度, 关节弯曲]，角度以竖直向下为 0，正值朝前。 */
type Leg = [number, number];
interface Pose {
  pitch: number;
  /** 远后、远前、近后、近前 */
  legs: [Leg, Leg, Leg, Leg];
  tail: number;
}

interface Spec {
  hindHip: [number, number];
  frontHip: [number, number];
  l1: number;
  l2: number;
  w1: number;
  w2: number;
  rearPitch: number;
}

const OUTLINE = '#2a201c';
const SPECS: Record<AnimalKind, Spec> = {
  horse: { hindHip: [84, 94], frontHip: [150, 94], l1: 37, l2: 39, w1: 12, w2: 7, rearPitch: -0.42 },
  cow: { hindHip: [74, 114], frontHip: [158, 116], l1: 27, l2: 29, w1: 14, w2: 10, rearPitch: -0.28 },
};

function poseOf(name: FrameName): Pose {
  if (name === 'stand') {
    return { pitch: 0, legs: [[-0.12, 0.12], [0.1, -0.05], [-0.04, 0.06], [0.02, 0]], tail: 0.2 };
  }
  if (name === 'rear') {
    return { pitch: 0, legs: [[0.3, 0.05], [1.0, -1.7], [0.18, 0.02], [0.7, -1.9]], tail: 0.9 };
  }
  if (name === 'slam') {
    return { pitch: 0.06, legs: [[-0.42, 0.25], [0.42, -0.08], [-0.3, 0.2], [0.26, -0.02]], tail: 0.6 };
  }
  // 飞奔：前后肢反相（收拢 ↔ 伸展），近远侧错开相位
  const f = Number(name.slice(3));
  const p = (f / RUN_FRAMES) * Math.PI * 2;
  const front = (o: number): Leg => [0.62 * Math.sin(p + o), -1.5 * Math.max(0, Math.cos(p + o))];
  const hind = (o: number): Leg => [-0.12 - 0.55 * Math.sin(p + o), 0.15 + 1.25 * Math.max(0, -Math.cos(p + o))];
  return {
    pitch: 0.07 * Math.sin(p),
    legs: [hind(0.7), front(0.7), hind(0), front(0)],
    tail: 0.7 + 0.25 * Math.sin(p * 2),
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

function drawLeg(ctx: CanvasRenderingContext2D, spec: Spec, g: LegGeo, upper: string, lower: string, hoofColor: string): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 先整条描边，再分段填色，关节处不出现描边断缝
  // 大腿/肩部肌肉：靠近髋部的一段加粗，避免火柴腿
  const thigh: Pt = [g.hip[0] + (g.knee[0] - g.hip[0]) * 0.42, g.hip[1] + (g.knee[1] - g.hip[1]) * 0.42];
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = spec.w1 * 1.75 + 5;
  ctx.beginPath(); ctx.moveTo(g.hip[0], g.hip[1] - 4); ctx.lineTo(...thigh); ctx.stroke();
  ctx.lineWidth = spec.w1 + 5;
  ctx.beginPath(); ctx.moveTo(...g.hip); ctx.lineTo(...g.knee); ctx.stroke();
  ctx.lineWidth = spec.w2 + 5;
  ctx.beginPath(); ctx.moveTo(...g.knee); ctx.lineTo(...g.hoof); ctx.stroke();
  ctx.strokeStyle = upper;
  ctx.lineWidth = spec.w1 * 1.75;
  ctx.beginPath(); ctx.moveTo(g.hip[0], g.hip[1] - 4); ctx.lineTo(...thigh); ctx.stroke();
  ctx.lineWidth = spec.w1;
  ctx.beginPath(); ctx.moveTo(...g.hip); ctx.lineTo(...g.knee); ctx.stroke();
  ctx.strokeStyle = lower;
  ctx.lineWidth = spec.w2;
  ctx.beginPath(); ctx.moveTo(...g.knee); ctx.lineTo(...g.hoof); ctx.stroke();
  ctx.fillStyle = lower;
  ctx.beginPath(); ctx.arc(g.knee[0], g.knee[1], spec.w2 * 0.55, 0, Math.PI * 2); ctx.fill();
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
  ctx.restore();
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, width = 3): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
}

function bodyGradient(ctx: CanvasRenderingContext2D, top: number, bottom: number, light: string, mid: string, dark: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, light);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, dark);
  return g;
}

// ---------------- 马 ----------------

function horseTail(ctx: CanvasRenderingContext2D, lift: number): void {
  const tipY = 112 - lift * 44;
  const tipX = 22 - lift * 6;
  ctx.beginPath();
  ctx.moveTo(66, 66);
  ctx.bezierCurveTo(46, 60 - lift * 10, 34, 70 - lift * 20, tipX, tipY);
  ctx.bezierCurveTo(30, tipY - 4, 34, tipY + 10, 42, tipY + 6);
  ctx.bezierCurveTo(48, 92 - lift * 18, 56, 82, 68, 78);
  ctx.closePath();
  fillStroke(ctx, '#2b1d18', 2.5);
  ctx.strokeStyle = '#4a342b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(62, 70);
  ctx.quadraticCurveTo(44, 72 - lift * 14, tipX + 8, tipY + 2);
  ctx.stroke();
}

function horseBody(ctx: CanvasRenderingContext2D): void {
  const coat = bodyGradient(ctx, 54, 108, '#cf8550', '#ad6034', '#7e3f20');
  // 颈部（先画，躯干盖住颈根）
  ctx.beginPath();
  ctx.moveTo(138, 64);
  ctx.bezierCurveTo(152, 42, 172, 24, 194, 20);
  ctx.lineTo(206, 38);
  ctx.bezierCurveTo(194, 52, 184, 70, 178, 94);
  ctx.lineTo(156, 98);
  ctx.closePath();
  fillStroke(ctx, bodyGradient(ctx, 20, 98, '#d58b55', '#b1653a', '#8a4826'));
  // 躯干
  ctx.beginPath();
  ctx.moveTo(62, 72);
  ctx.bezierCurveTo(60, 58, 76, 52, 94, 56);
  ctx.bezierCurveTo(112, 61, 130, 62, 146, 56);
  ctx.bezierCurveTo(166, 52, 182, 68, 180, 86);
  ctx.bezierCurveTo(178, 100, 168, 106, 156, 106);
  ctx.bezierCurveTo(132, 110, 110, 108, 92, 104);
  ctx.bezierCurveTo(70, 102, 58, 90, 62, 72);
  ctx.closePath();
  fillStroke(ctx, coat);
  // 肌肉高光：后臀与肩
  ctx.strokeStyle = 'rgba(255,214,170,0.45)';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(86, 76, 16, -2.6, -0.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(160, 74, 13, -2.4, -0.6); ctx.stroke();
  ctx.strokeStyle = 'rgba(70,30,12,0.35)';
  ctx.beginPath(); ctx.moveTo(104, 98); ctx.quadraticCurveTo(126, 104, 146, 98); ctx.stroke();
}

function horseHead(ctx: CanvasRenderingContext2D): void {
  // 远侧耳
  ctx.beginPath();
  ctx.moveTo(190, 22); ctx.lineTo(186, 6); ctx.lineTo(197, 18); ctx.closePath();
  fillStroke(ctx, '#8a4826', 2);
  // 头：额 → 鼻梁 → 圆口鼻 → 下颌圆腮
  ctx.beginPath();
  ctx.moveTo(190, 22);
  ctx.bezierCurveTo(198, 14, 210, 16, 214, 24);
  ctx.lineTo(232, 52);
  ctx.bezierCurveTo(237, 61, 232, 70, 223, 69);
  ctx.bezierCurveTo(216, 68, 211, 64, 206, 58);
  ctx.bezierCurveTo(198, 54, 190, 48, 188, 38);
  ctx.bezierCurveTo(186, 31, 186, 26, 190, 22);
  ctx.closePath();
  fillStroke(ctx, bodyGradient(ctx, 16, 70, '#d99260', '#b86c3e', '#93502c'));
  // 白色流星
  ctx.beginPath();
  ctx.moveTo(207, 21);
  ctx.quadraticCurveTo(213, 22, 214, 28);
  ctx.lineTo(229, 54);
  ctx.quadraticCurveTo(226, 58, 222, 55);
  ctx.lineTo(206, 28);
  ctx.closePath();
  ctx.fillStyle = '#fbf1df';
  ctx.fill();
  // 口鼻暗色与鼻孔、嘴线
  ctx.beginPath();
  ctx.ellipse(225, 61, 9, 7, 0.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,28,16,0.35)';
  ctx.fill();
  ctx.fillStyle = OUTLINE;
  ctx.beginPath(); ctx.ellipse(228, 58, 2.6, 1.6, 0.8, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = OUTLINE;
  ctx.beginPath(); ctx.moveTo(218, 66); ctx.quadraticCurveTo(222, 64, 226, 67); ctx.stroke();
  // 腮部轮廓
  ctx.strokeStyle = 'rgba(70,30,12,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(198, 40, 9, 0.2, 2.2); ctx.stroke();
  // 眼睛（带高光，眼神坚定）
  ctx.fillStyle = '#1b1412';
  ctx.beginPath(); ctx.ellipse(204, 31, 3.4, 3, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(205.2, 30, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(199, 26.5); ctx.lineTo(208, 27.5); ctx.stroke();
  // 近侧耳
  ctx.beginPath();
  ctx.moveTo(195, 22); ctx.bezierCurveTo(192, 12, 194, 6, 198, 2); ctx.bezierCurveTo(202, 8, 204, 14, 203, 20); ctx.closePath();
  fillStroke(ctx, '#c27443', 2);
  ctx.beginPath();
  ctx.moveTo(197, 18); ctx.quadraticCurveTo(197, 10, 198.5, 7); ctx.quadraticCurveTo(201, 12, 200.5, 18); ctx.closePath();
  ctx.fillStyle = '#6b3a24';
  ctx.fill();
}

function horseMane(ctx: CanvasRenderingContext2D, blow: number): void {
  // 沿颈脊一排向后飘的鬃束
  ctx.fillStyle = '#2b1d18';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  const crest: Pt[] = [[142, 60], [152, 46], [164, 35], [176, 27], [188, 21]];
  for (let i = 0; i < crest.length; i++) {
    const [cx, cy] = crest[i];
    const len = 20 - i * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + 9, cy - 4);
    ctx.quadraticCurveTo(cx - 2, cy - 12 - blow * 4, cx - len, cy - 4 - blow * 6 + (i % 2) * 4);
    ctx.quadraticCurveTo(cx - 4, cy + 2, cx + 4, cy + 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // 额发
  ctx.beginPath();
  ctx.moveTo(194, 18);
  ctx.quadraticCurveTo(200, 14, 210, 22 + blow * 2);
  ctx.quadraticCurveTo(202, 22, 197, 25);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawHorse(ctx: CanvasRenderingContext2D, pose: Pose, geos: LegGeo[], pivot: Pt): void {
  const spec = SPECS.horse;
  drawLeg(ctx, spec, geos[0], '#7a3d1f', '#1f1714', '#141010');
  drawLeg(ctx, spec, geos[1], '#7a3d1f', '#1f1714', '#141010');
  ctx.save();
  ctx.translate(...pivot); ctx.rotate(pose.pitch); ctx.translate(-pivot[0], -pivot[1]);
  horseTail(ctx, pose.tail);
  horseBody(ctx);
  ctx.restore();
  drawLeg(ctx, spec, geos[2], '#a95e33', '#2e2320', '#1a1412');
  drawLeg(ctx, spec, geos[3], '#b5683a', '#2e2320', '#1a1412');
  ctx.save();
  ctx.translate(...pivot); ctx.rotate(pose.pitch); ctx.translate(-pivot[0], -pivot[1]);
  horseHead(ctx);
  horseMane(ctx, pose.tail);
  ctx.restore();
}

// ---------------- 牛 ----------------

function cowTail(ctx: CanvasRenderingContext2D, lift: number): void {
  const tx = 30 - lift * 10;
  const ty = 118 - lift * 40;
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(52, 74);
  ctx.quadraticCurveTo(36, 78 - lift * 20, tx + 4, ty);
  ctx.stroke();
  ctx.strokeStyle = '#f6f0e4';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(tx + 2, ty + 4, 5, 8, 0.3 + lift * 0.8, 0, Math.PI * 2);
  fillStroke(ctx, '#2a2422', 2);
}

function cowBodyPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(48, 80);
  ctx.bezierCurveTo(46, 64, 56, 58, 70, 60);
  ctx.lineTo(80, 56);
  ctx.bezierCurveTo(84, 58, 88, 60, 96, 60);
  ctx.lineTo(150, 60);
  ctx.bezierCurveTo(170, 60, 182, 72, 182, 90);
  ctx.bezierCurveTo(182, 106, 176, 118, 162, 122);
  ctx.bezierCurveTo(132, 126, 104, 126, 82, 124);
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
  ctx.fill();
}

function cowBody(ctx: CanvasRenderingContext2D): void {
  const hide = bodyGradient(ctx, 56, 126, '#ffffff', '#f6f1e8', '#d9cfc1');
  // 颈与垂皮
  ctx.beginPath();
  ctx.moveTo(160, 64);
  ctx.bezierCurveTo(176, 56, 190, 54, 200, 58);
  ctx.lineTo(204, 92);
  ctx.bezierCurveTo(196, 104, 184, 114, 170, 120);
  ctx.closePath();
  fillStroke(ctx, hide);
  // 乳房
  ctx.beginPath();
  ctx.ellipse(94, 124, 14, 8, 0, 0, Math.PI);
  fillStroke(ctx, '#f2aaa2', 2.5);
  ctx.fillStyle = '#e08b84';
  for (const tx of [86, 94, 102]) {
    ctx.beginPath(); ctx.ellipse(tx, 133, 2, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  cowBodyPath(ctx);
  fillStroke(ctx, hide);
  // 黑斑裁剪在躯干内
  ctx.save();
  cowBodyPath(ctx);
  ctx.clip();
  ctx.fillStyle = '#2a2422';
  cowSpot(ctx, 70, 72, 15, 1.3);
  cowSpot(ctx, 118, 64, 13, 4.1);
  cowSpot(ctx, 104, 110, 14, 2.2);
  cowSpot(ctx, 160, 100, 11, 5.7);
  ctx.restore();
  cowBodyPath(ctx);
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // 胯骨与肩胛的结构线
  ctx.strokeStyle = 'rgba(120,100,85,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(76, 80, 14, -2.2, -0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(158, 70); ctx.quadraticCurveTo(164, 86, 160, 100); ctx.stroke();
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

function cowHead(ctx: CanvasRenderingContext2D): void {
  cowHorn(ctx, 196, 48, true);
  // 头：方头、略低垂
  ctx.beginPath();
  ctx.moveTo(190, 54);
  ctx.bezierCurveTo(194, 44, 212, 42, 218, 50);
  ctx.lineTo(230, 82);
  ctx.bezierCurveTo(232, 92, 226, 104, 212, 104);
  ctx.bezierCurveTo(202, 104, 196, 98, 194, 90);
  ctx.closePath();
  fillStroke(ctx, bodyGradient(ctx, 44, 104, '#ffffff', '#f7f2ea', '#e2d9cc'));
  // 眼周黑斑
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#2a2422';
  ctx.beginPath(); ctx.ellipse(202, 58, 11, 13, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // 粉色大口鼻
  ctx.beginPath();
  ctx.ellipse(218, 93, 15, 12, -0.35, 0, Math.PI * 2);
  fillStroke(ctx, '#f4aca3', 2.5);
  ctx.fillStyle = '#7a3a36';
  ctx.beginPath(); ctx.ellipse(215, 90, 2.4, 3.4, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(226, 87, 2, 3, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7a3a36';
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(210, 100); ctx.quadraticCurveTo(218, 103, 226, 98); ctx.stroke();
  // 眼睛
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(205, 62, 4.4, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#16110f';
  ctx.beginPath(); ctx.arc(206, 62.5, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(207, 61.5, 1, 0, Math.PI * 2); ctx.fill();
  // 横向耳朵（粉色内耳）
  ctx.beginPath();
  ctx.moveTo(192, 58);
  ctx.bezierCurveTo(184, 50, 172, 50, 168, 56);
  ctx.bezierCurveTo(174, 62, 184, 64, 193, 63);
  ctx.closePath();
  fillStroke(ctx, '#f6f0e4', 2.5);
  ctx.beginPath();
  ctx.moveTo(188, 59);
  ctx.bezierCurveTo(182, 55, 176, 55, 173, 57);
  ctx.bezierCurveTo(178, 60, 184, 61, 188, 61);
  ctx.closePath();
  ctx.fillStyle = '#f0a49b';
  ctx.fill();
  cowHorn(ctx, 204, 48, false);
  // 额前一撮毛
  ctx.beginPath();
  ctx.moveTo(198, 46); ctx.quadraticCurveTo(204, 40, 212, 46); ctx.quadraticCurveTo(206, 44, 204, 50); ctx.closePath();
  fillStroke(ctx, '#f6f0e4', 2);
}

function drawCow(ctx: CanvasRenderingContext2D, pose: Pose, geos: LegGeo[], pivot: Pt): void {
  const spec = SPECS.cow;
  drawLeg(ctx, spec, geos[0], '#d6ccbe', '#d6ccbe', '#3a302b');
  drawLeg(ctx, spec, geos[1], '#d6ccbe', '#d6ccbe', '#3a302b');
  ctx.save();
  ctx.translate(...pivot); ctx.rotate(pose.pitch); ctx.translate(-pivot[0], -pivot[1]);
  cowTail(ctx, pose.tail);
  cowBody(ctx);
  ctx.restore();
  drawLeg(ctx, spec, geos[2], '#f8f3ea', '#f3ede2', '#2f2724');
  drawLeg(ctx, spec, geos[3], '#f8f3ea', '#f3ede2', '#2f2724');
  ctx.save();
  ctx.translate(...pivot); ctx.rotate(pose.pitch); ctx.translate(-pivot[0], -pivot[1]);
  cowHead(ctx);
  ctx.restore();
}

/**
 * 在 ctx 当前坐标系（ART_W×ART_H 逻辑尺寸）画一帧。
 * 身体随前后蹄落地自动升降，保证支撑腿始终踩在地面线上。
 */
export function drawAnimal(ctx: CanvasRenderingContext2D, kind: AnimalKind, frame: FrameName): void {
  const spec = SPECS[kind];
  const pose = poseOf(frame);
  if (frame === 'rear') pose.pitch = spec.rearPitch;
  const pivot: Pt = spec.hindHip;
  const hips: Pt[] = [
    [spec.hindHip[0] - 6, spec.hindHip[1] - 2],
    [spec.frontHip[0] - 6, spec.frontHip[1] - 2],
    spec.hindHip,
    spec.frontHip,
  ].map((h) => rotAround(h as Pt, pivot, pose.pitch));
  let geos = pose.legs.map((leg, i) => legGeo(spec, hips[i], leg));
  const lowest = Math.max(...geos.map((g) => g.hoof[1]));
  // 支撑腿落地：最低蹄对齐地面；腾空帧最多下沉 6px 形成起伏
  const dy = Math.min(GROUND - lowest, frame === 'rear' ? 0 : 6);
  ctx.save();
  ctx.translate(0, TOP_PAD + dy);
  geos = pose.legs.map((leg, i) => legGeo(spec, hips[i], leg));
  if (kind === 'horse') drawHorse(ctx, pose, geos, pivot);
  else drawCow(ctx, pose, geos, pivot);
  ctx.restore();
}

export const ALL_FRAMES: FrameName[] = ['run0', 'run1', 'run2', 'run3', 'run4', 'run5', 'stand', 'rear', 'slam'];
