// WebAudio 程序化音效（零素材）：引擎轰鸣 + 爆炸。
// 任何失败都静默降级，绝不影响视觉演出。

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
const liveNodes: AudioScheduledSourceNode[] = [];

/** 设置页的音效开关（localStorage 持久化，两个窗口同源共享）。 */
function soundEnabled(): boolean {
  try {
    return localStorage.getItem('bt_sound') !== '0';
  } catch {
    return true;
  }
}

export function initAudio(): void {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  } catch {
    ctx = null;
  }
}

async function ensureRunning(): Promise<boolean> {
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === 'running';
}

function track(node: AudioScheduledSourceNode, stopAt: number): void {
  liveNodes.push(node);
  node.onended = () => {
    const i = liveNodes.indexOf(node);
    if (i >= 0) liveNodes.splice(i, 1);
  };
  node.stop(stopAt);
}

/** 战机低空掠过：带通噪声包络，0.3s-1.5s 区间播放。 */
export async function sfxJet(): Promise<void> {
  if (!soundEnabled()) return;
  if (!(await ensureRunning()) || !ctx || !master || !noiseBuffer) return;
  try {
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(220, t0);
    bp.frequency.linearRampToValueAtTime(420, t0 + 0.9);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.25);
    g.gain.setValueAtTime(0.09, t0 + 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    src.connect(bp);
    bp.connect(g);
    g.connect(master);
    src.start(t0);
    track(src, t0 + 1.25);
  } catch {
    /* 忽略音频错误 */
  }
}

/** 爆炸：低通噪声轰 + 低频正弦闷响。 */
export async function sfxBoom(): Promise<void> {
  if (!soundEnabled()) return;
  if (!(await ensureRunning()) || !ctx || !master || !noiseBuffer) return;
  try {
    const t0 = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t0);
    lp.frequency.exponentialRampToValueAtTime(70, t0 + 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start(t0);
    track(src, t0 + 1.45);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.55, t0);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    osc.connect(og);
    og.connect(master);
    osc.start(t0);
    track(osc, t0 + 0.65);
  } catch {
    /* 忽略音频错误 */
  }
}

/** 中止/清理时停掉所有声音源，保证无残留。 */
export function stopAllAudio(): void {
  for (const n of liveNodes.splice(0)) {
    try {
      n.onended = null;
      n.stop();
    } catch {
      /* 已停止，忽略 */
    }
  }
}
