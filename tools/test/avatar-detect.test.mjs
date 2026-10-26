// 头像识别单测：node --experimental-strip-types --test tools/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectAvatar } from '../../src/effects/avatarDetect.ts';

const W = 320, H = 320;
const BG = [237, 237, 237]; // 微信聊天区浅灰

function canvas() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...BG, 255], i * 4);
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) data.set([...c, 255], (y * W + x) * 4); };
  return {
    img: { width: W, height: H, data },
    roundRect(x0, y0, w, h, r, color) {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const dx = Math.max(x0 + r - x - 0.5, 0, x + 0.5 - (x0 + w - r));
        const dy = Math.max(y0 + r - y - 0.5, 0, y + 0.5 - (y0 + h - r));
        if (dx * dx + dy * dy <= r * r) put(x, y, typeof color === 'function' ? color(x - x0, y - y0) : color);
      }
    },
  };
}

test('微信圆角方形头像：精确框出', () => {
  const c = canvas();
  c.roundRect(140, 130, 40, 40, 4, (x, y) => [40 + x * 4, 90 + y * 3, 160]);
  const r = detectAvatar(c.img, 160, 150);
  assert.equal(r.found, true);
  assert.deepEqual([r.x, r.y, r.w, r.h], [140, 130, 40, 40]);
  assert.ok(r.radius >= 2 && r.radius <= 7, `radius ${r.radius}`);
  assert.deepEqual(r.bg, BG);
});

test('圆形头像：圆角约为半宽', () => {
  const c = canvas();
  c.roundRect(120, 120, 60, 60, 30, [200, 60, 60]);
  const r = detectAvatar(c.img, 150, 150);
  assert.equal(r.found, true);
  assert.ok(Math.abs(r.w - 60) <= 1 && Math.abs(r.h - 60) <= 1);
  assert.ok(r.radius > 24, `radius ${r.radius}`);
});

test('白底头像（内部大片与背景接近）仍整体识别', () => {
  const c = canvas();
  // 1px 深色描边 + 白色内部 + 中间一个小图案
  c.roundRect(140, 130, 40, 40, 4, (x, y) => (x === 0 || y === 0 || x === 39 || y === 39) ? [190, 190, 190] : [255, 255, 255]);
  c.roundRect(152, 142, 16, 16, 8, [30, 30, 30]);
  const r = detectAvatar(c.img, 145, 165);
  assert.equal(r.found, true);
  assert.deepEqual([r.x, r.y, r.w, r.h], [140, 130, 40, 40]);
});

test('点在头像旁的背景上：吸附到 12px 内的头像', () => {
  const c = canvas();
  c.roundRect(140, 130, 40, 40, 4, [60, 120, 200]);
  const r = detectAvatar(c.img, 186, 150);
  assert.equal(r.found, true);
  assert.equal(r.x, 140);
});

test('头像旁有聊天气泡：不粘连', () => {
  const c = canvas();
  c.roundRect(40, 130, 40, 40, 4, [60, 120, 200]);
  c.roundRect(90, 132, 180, 46, 6, [255, 255, 255]); // 白色气泡，间距 10px
  const r = detectAvatar(c.img, 60, 150);
  assert.equal(r.found, true);
  assert.deepEqual([r.x, r.y, r.w, r.h], [40, 130, 40, 40]);
});

test('点在长条气泡上：不是方形 → 兜底', () => {
  const c = canvas();
  c.roundRect(60, 130, 200, 46, 6, [149, 236, 105]); // 微信绿气泡
  const r = detectAvatar(c.img, 160, 150);
  assert.equal(r.found, false);
  assert.equal(r.w, 60);
});

test('点在空白背景：兜底方块居中于点击处', () => {
  const c = canvas();
  const r = detectAvatar(c.img, 160, 160);
  assert.equal(r.found, false);
  assert.deepEqual([r.x, r.y, r.w, r.h], [130, 130, 60, 60]);
});

test('点在铺满取样的大块界面上：兜底', () => {
  const c = canvas();
  c.roundRect(0, 0, 320, 320, 0, [40, 40, 40]);
  c.roundRect(100, 100, 120, 120, 0, [36, 44, 40]);
  const r = detectAvatar(c.img, 160, 160);
  assert.equal(r.found, false);
});

test('靠近取样边缘的头像不越界', () => {
  const c = canvas();
  c.roundRect(2, 2, 40, 40, 4, [60, 120, 200]);
  const r = detectAvatar(c.img, 20, 20);
  assert.equal(r.found, true);
  assert.deepEqual([r.x, r.y, r.w, r.h], [2, 2, 40, 40]);
});
