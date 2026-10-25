import './settings.css';

interface Settings {
  menuModifier: string;
}

const app = document.querySelector<HTMLDivElement>('#app')!;

// 简约线性 SVG 图标（与轮盘矢量图标同一风格）
const ICON_WHEEL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/><circle cx="12" cy="12" r="2.4"/></svg>`;
const ICON_SLIDERS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 4v7M5 15v5M12 4v3M12 11v9M19 4v9M19 17v3"/><circle cx="5" cy="13" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="19" cy="15" r="2"/></svg>`;

app.innerHTML = `
  <div class="page">
    <header class="header">
      <h1>设置</h1>
      <p class="desc">定制你的 BoomThere 技能轮盘</p>
    </header>

    <section class="card">
      <div class="card-head">
        <span class="card-icon">${ICON_WHEEL}</span>
        <div>
          <h2>技能轮盘</h2>
          <p>按住修饰键并右键拖拽选择技能，松开发射</p>
        </div>
      </div>
      <div class="field">
        <label class="field-label">触发修饰键</label>
        <div class="tg" role="radiogroup" aria-label="触发修饰键">
          <button type="button" class="tg-item" data-value="alt">Alt</button>
          <button type="button" class="tg-item" data-value="shift">Shift</button>
        </div>
        <p class="hint">Ctrl + 右键已固定用于「给我炸」，无需设置</p>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <span class="card-icon">${ICON_SLIDERS}</span>
        <div>
          <h2>通用</h2>
          <p>音效与反馈</p>
        </div>
      </div>
      <div class="field field-row">
        <div>
          <label class="field-label">特效音效</label>
          <p class="hint">爆炸与战机引擎声</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="sound" />
          <span class="track"></span>
        </label>
      </div>
    </section>

    <footer>
      <span id="status" role="status"></span>
      <button id="save" class="btn">保存</button>
    </footer>
  </div>
`;

const tgItems = Array.from(document.querySelectorAll<HTMLButtonElement>('.tg-item'));
const soundBox = document.querySelector<HTMLInputElement>('#sound')!;
const statusEl = document.querySelector<HTMLSpanElement>('#status')!;
const saveBtn = document.querySelector<HTMLButtonElement>('#save')!;

let menuModifier = 'alt';

function selectedModifier(): string {
  return tgItems.find((b) => b.classList.contains('active'))?.dataset.value ?? 'alt';
}

tgItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    menuModifier = btn.dataset.value ?? 'alt';
    tgItems.forEach((b) => b.classList.toggle('active', b === btn));
  });
});

function setStatus(text: string, ok = true): void {
  statusEl.textContent = text;
  statusEl.className = ok ? 'ok' : 'err';
  window.setTimeout(() => {
    statusEl.textContent = '';
  }, 2600);
}

async function boot(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const s = await invoke<Settings>('get_settings');
    menuModifier = s.menuModifier === 'shift' ? 'shift' : 'alt';
  } catch {
    setStatus('读取配置失败，使用默认值', false);
  }
  tgItems.forEach((b) => b.classList.toggle('active', b.dataset.value === menuModifier));
  try {
    soundBox.checked = localStorage.getItem('bt_sound') !== '0';
  } catch {
    soundBox.checked = true;
  }
}

saveBtn.addEventListener('click', async () => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_settings', { menuModifier });
    localStorage.setItem('bt_sound', soundBox.checked ? '1' : '0');
    setStatus('✓ 已保存，立即生效');
  } catch (err) {
    setStatus(String(err).replace(/^.*?"([^"]+)".*$/, '$1'), false);
  }
});

void boot();
