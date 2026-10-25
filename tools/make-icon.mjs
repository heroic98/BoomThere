// 生成 src-tauri/icons/icon.ico（32x32 32bpp，准星图案），零外部素材。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = 32;
const px = Buffer.alloc(S * S * 4); // BGRA，自底向上

function put(x, y, r, g, b, a) {
  if (x < 0 || x >= S || y < 0 || y >= S) return;
  const row = S - 1 - y; // BMP 行序自底向上
  const i = (row * S + x) * 4;
  px[i] = b;
  px[i + 1] = g;
  px[i + 2] = r;
  px[i + 3] = a;
}

// 抗锯齿圆环 + 中心点 + 十字刻度
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = x - 15.5;
    const dy = y - 15.5;
    const d = Math.hypot(dx, dy);
    if (d <= 14.5 && d >= 11) {
      const edge = Math.min(d - 11, 14.5 - d);
      const a = Math.max(0, Math.min(1, edge + 0.5));
      put(x, y, 224, 49, 49, Math.round(a * 255));
    } else if (d <= 5.5) {
      const a = Math.max(0, Math.min(1, 5.5 - d + 0.5));
      put(x, y, 255, 122, 26, Math.round(a * 255));
    }
  }
}
for (let t = -14; t <= -9; t++) {
  put(15, 15 + t, 224, 49, 49, 255);
  put(16, 15 + t, 224, 49, 49, 255);
  put(15, 15 - t, 224, 49, 49, 255);
  put(16, 15 - t, 224, 49, 49, 255);
  put(15 + t, 15, 224, 49, 49, 255);
  put(15 + t, 16, 224, 49, 49, 255);
  put(15 - t, 15, 224, 49, 49, 255);
  put(15 - t, 16, 224, 49, 49, 255);
}

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count

const andMask = Buffer.alloc((S / 8) * S); // 全 0：使用 alpha 通道
const imgSize = 40 + px.length + andMask.length;

const entry = Buffer.alloc(16);
entry[0] = S;
entry[1] = S;
entry[2] = 0; // 调色板色数
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(imgSize, 8);
entry.writeUInt32LE(22, 12); // 数据偏移

const info = Buffer.alloc(40);
info.writeUInt32LE(40, 0);
info.writeInt32LE(S, 4);
info.writeInt32LE(S * 2, 8); // XOR + AND 两倍高
info.writeUInt16LE(1, 12);
info.writeUInt16LE(32, 14);

const out = join(root, 'src-tauri', 'icons', 'icon.ico');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, entry, info, px, andMask]));
console.log(`written: ${out}`);
