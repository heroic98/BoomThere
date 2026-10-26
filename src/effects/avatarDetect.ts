// 目标识别：在一块屏幕取样里找出点击处的「头像」——
// 与周边背景色差明显、近似正方形、尺寸合理的连通块（微信/QQ/钉钉头像都满足）。
// 纯函数，不依赖 DOM / Pixi，可直接用 node 跑单测。

export interface PixelImage {
  width: number;
  height: number;
  /** RGBA，每像素 4 字节 */
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectResult {
  /** 取样内的外接框（像素） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 估算的圆角半径（像素），圆形头像约为 w/2 */
  radius: number;
  /** 背景色（用于填补被吸走后留下的空洞） */
  bg: [number, number, number];
  /** true = 识别到头像；false = 未识别，按点击处的默认方块兜底 */
  found: boolean;
}

/** 与背景的色差阈值（RGB 曼哈顿距离）。微信浅灰底上白底头像约 30+。 */
const FG_THRESHOLD = 26;
/** 头像边长范围（物理像素）：100% 缩放下约 34–40，200% 下约 80。 */
const MIN_SIDE = 18;
const MAX_SIDE = 150;
/** 兜底方块边长 */
const FALLBACK_SIDE = 60;

/** 估计 (cx, cy) 周围一圈的背景色：取样环上颜色出现最多的量化桶。 */
function estimateBackground(img: PixelImage, cx: number, cy: number): [number, number, number] {
  const { width: W, height: H, data } = img;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const ringR = Math.min(W, H) * 0.42;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    for (const k of [0.7, 0.85, 1]) {
      const x = Math.round(cx + Math.cos(a) * ringR * k);
      const y = Math.round(cy + Math.sin(a) * ringR * k);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const o = (y * W + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bin.n++;
      bin.r += r;
      bin.g += g;
      bin.b += b;
      bins.set(key, bin);
    }
  }
  let best = { n: 0, r: 0, g: 0, b: 0 };
  for (const bin of bins.values()) if (bin.n > best.n) best = bin;
  if (best.n === 0) return [240, 240, 240];
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

function fallback(img: PixelImage, cx: number, cy: number, bg: [number, number, number]): DetectResult {
  const s = Math.min(FALLBACK_SIDE, img.width, img.height);
  const x = Math.max(0, Math.min(img.width - s, Math.round(cx - s / 2)));
  const y = Math.max(0, Math.min(img.height - s, Math.round(cy - s / 2)));
  return { x, y, w: s, h: s, radius: s * 0.18, bg, found: false };
}

/**
 * 在取样 img 中识别 (cx, cy) 处的头像。
 * 步骤：背景色 → 前景掩码 → 1px 膨胀（连接头像内部与背景同色的区域）
 * → 从点击点（或最近前景点）洪泛 → 外接框 → 形状/尺寸校验 → 圆角估算。
 */
export function detectAvatar(img: PixelImage, cx: number, cy: number): DetectResult {
  const { width: W, height: H, data } = img;
  cx = Math.round(Math.max(0, Math.min(W - 1, cx)));
  cy = Math.round(Math.max(0, Math.min(H - 1, cy)));
  const bg = estimateBackground(img, cx, cy);

  const fg = new Uint8Array(W * H);
  for (let i = 0, o = 0; i < W * H; i++, o += 4) {
    const d = Math.abs(data[o] - bg[0]) + Math.abs(data[o + 1] - bg[1]) + Math.abs(data[o + 2] - bg[2]);
    if (d > FG_THRESHOLD) fg[i] = 1;
  }
  // 膨胀 1px：白底头像的浅色边缘、头像内的背景色块不至于把连通块切碎
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!fg[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < W) mask[yy * W + xx] = 1;
        }
      }
    }
  }

  // 种子：点击点本身；落在背景上则在 12px 内找最近的前景点
  let seed = -1;
  if (mask[cy * W + cx]) seed = cy * W + cx;
  else {
    let bestD = Infinity;
    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H || !mask[y * W + x]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          seed = y * W + x;
        }
      }
    }
  }
  if (seed < 0) return fallback(img, cx, cy, bg);

  // 洪泛（4 邻域），面积超限即放弃：说明点在大片界面上而非头像
  const limit = MAX_SIDE * MAX_SIDE * 1.3;
  const seen = new Uint8Array(W * H);
  const stack = [seed];
  seen[seed] = 1;
  let minX = W, minY = H, maxX = -1, maxY = -1, area = 0;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % W;
    const y = (i - x) / W;
    if (++area > limit) return fallback(img, cx, cy, bg);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
    if (x < W - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && mask[i - W] && !seen[i - W]) { seen[i - W] = 1; stack.push(i - W); }
    if (y < H - 1 && mask[i + W] && !seen[i + W]) { seen[i + W] = 1; stack.push(i + W); }
  }
  // 抵消膨胀带来的 1px 外扩
  minX = Math.min(maxX, minX + 1);
  minY = Math.min(maxY, minY + 1);
  maxX = Math.max(minX, maxX - 1);
  maxY = Math.max(minY, maxY - 1);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;

  const touchesEdge = minX <= 0 || minY <= 0 || maxX >= W - 1 || maxY >= H - 1;
  const aspect = w / h;
  const fill = area / (w * h);
  const squareish = aspect > 0.8 && aspect < 1.25;
  const sized = Math.min(w, h) >= MIN_SIDE && Math.max(w, h) <= MAX_SIDE;
  // 环形 / 线框图标填充率很低，排除
  if (touchesEdge || !squareish || !sized || fill < 0.55) return fallback(img, cx, cy, bg);

  // 圆角：从四个角沿对角线向内走到第一个前景像素，步数 k = r(1 - 1/√2)
  const corners: Array<[number, number, number, number]> = [
    [minX, minY, 1, 1], [maxX, minY, -1, 1], [minX, maxY, 1, -1], [maxX, maxY, -1, -1],
  ];
  let radius = Infinity;
  for (const [x0, y0, sx, sy] of corners) {
    let k = 0;
    const lim = Math.floor(Math.min(w, h) / 2);
    while (k < lim && !fg[(y0 + sy * k) * W + (x0 + sx * k)]) k++;
    radius = Math.min(radius, k / (1 - Math.SQRT1_2));
  }
  radius = Math.max(1, Math.min(radius, Math.min(w, h) / 2));

  return { x: minX, y: minY, w, h, radius, bg, found: true };
}
