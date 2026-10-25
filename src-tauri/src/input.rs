//! 全局输入采集：WH_MOUSE_LL 低级鼠标钩子。
//!
//! - Ctrl+右键（固定）→ 直接触发技能 `airstrike-trigger`
//! - 轮盘修饰键+右键 → 唤出轮盘并进入屏蔽模式：吞掉所有鼠标事件
//!   （桌面输入被护住），持续上报光标 `menu-move`，左键点选 `menu-pick`，
//!   右键或 15s 超时 `menu-cancel`。前端结算后调 `menu_finish` 正常恢复。
//!
//! 钩子回调只采集与投递，全部重活（含事件转发）都在独立线程。

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, MSLLHOOKSTRUCT, MSG, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP,
    WM_MOUSEHWHEEL, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONDBLCLK,
    WM_RBUTTONUP,
};

pub const VK_CTRL: u8 = 0x11;
pub const VK_ALT: u8 = 0x12;
pub const VK_SHIFT: u8 = 0x10;

/// 事件种类 → 前端事件名
const EV_STRIKE: u8 = 1;
const EV_MENU_OPEN: u8 = 2;
const EV_MENU_MOVE: u8 = 3;
const EV_MENU_CLOSE: u8 = 4;
const EV_MENU_PICK: u8 = 5;
const EV_MENU_CANCEL: u8 = 6;

/// 轮盘打开后的安全超时：前端失联也不会锁死输入
const MENU_TIMEOUT_MS: u64 = 15_000;

/// 「给我炸」固定使用 Ctrl + 右键（不开放配置）
const STRIKE_VK: u8 = VK_CTRL;

fn event_name(kind: u8) -> &'static str {
    match kind {
        EV_MENU_OPEN => "menu-open",
        EV_MENU_MOVE => "menu-move",
        EV_MENU_CANCEL => "menu-cancel",
        EV_MENU_PICK => "menu-pick",
        _ => "airstrike-trigger",
    }
}

/// Rust → 前端事件负载（camelCase 序列化）。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScreenPoint {
    screen_x: i32,
    screen_y: i32,
}

static EVENT_TX: OnceLock<Sender<(u8, i32, i32)>> = OnceLock::new();
static SWALLOW_RIGHT_BUTTON: AtomicBool = AtomicBool::new(false);
static MENU_MODE: AtomicBool = AtomicBool::new(false);
static MENU_OPENED_AT: AtomicU64 = AtomicU64::new(0);
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static MENU_VK: AtomicU8 = AtomicU8::new(VK_ALT);
/// 轮盘模式下的最新光标位置（无锁原子：钩子回调在系统输入线程上，禁止阻塞）
static CURSOR_X: AtomicI32 = AtomicI32::new(0);
static CURSOR_Y: AtomicI32 = AtomicI32::new(0);
static CURSOR_DIRTY: AtomicBool = AtomicBool::new(false);

pub fn vk_from_name(name: &str) -> Option<u8> {
    match name {
        "ctrl" => Some(VK_CTRL),
        "alt" => Some(VK_ALT),
        "shift" => Some(VK_SHIFT),
        _ => None,
    }
}

pub fn set_menu_modifier(vk: u8) {
    MENU_VK.store(vk, Ordering::SeqCst);
}

/// 前端结算完毕，退出轮盘屏蔽模式、恢复正常输入。
pub fn exit_menu_mode() {
    MENU_MODE.store(false, Ordering::SeqCst);
    MENU_OPENED_AT.store(0, Ordering::SeqCst);
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 安装钩子：事件转发线程 + 光标轮询线程 + 带消息循环的钩子线程。
pub fn install(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<(u8, i32, i32)>();
    let _ = EVENT_TX.set(tx.clone());

    // 事件转发
    std::thread::spawn(move || {
        for (kind, x, y) in rx {
            let _ = app.emit(event_name(kind), ScreenPoint { screen_x: x, screen_y: y });
        }
    });

    // 光标轮询 + 轮盘安全超时：30Hz 且仅在光标移动时上报
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(33));
        if !MENU_MODE.load(Ordering::Relaxed) {
            continue;
        }
        let opened = MENU_OPENED_AT.load(Ordering::Relaxed);
        if opened != 0 && now_ms() - opened > MENU_TIMEOUT_MS {
            exit_menu_mode();
            let _ = tx.send((EV_MENU_CANCEL, 0, 0));
            continue;
        }
        if CURSOR_DIRTY.swap(false, Ordering::AcqRel) {
            let x = CURSOR_X.load(Ordering::Relaxed);
            let y = CURSOR_Y.load(Ordering::Relaxed);
            let _ = tx.send((EV_MENU_MOVE, x, y));
        }
    });

    std::thread::spawn(|| unsafe { hook_thread() });
}

/// 退出前解除钩子：向钩子线程投递 WM_QUIT，循环结束后 UnhookWindowsHookEx。
pub fn shutdown() {
    let tid = HOOK_THREAD_ID.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

unsafe fn hook_thread() {
    HOOK_THREAD_ID.store(GetCurrentThreadId(), Ordering::SeqCst);
    let hook = match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) {
        Ok(h) => h,
        Err(err) => {
            eprintln!("[boomthere] SetWindowsHookExW failed: {err}");
            return;
        }
    };
    let mut msg = MSG::default();
    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
        DispatchMessageW(&msg);
    }
    let _ = UnhookWindowsHookEx(hook);
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        match wparam.0 as u32 {
            WM_MOUSEMOVE => {
                if MENU_MODE.load(Ordering::Relaxed) {
                    // 无锁写入：拦截 LL 层 move 会冻结系统光标，这里只记录不拦截
                    CURSOR_X.store(info.pt.x, Ordering::Relaxed);
                    CURSOR_Y.store(info.pt.y, Ordering::Relaxed);
                    CURSOR_DIRTY.store(true, Ordering::Release);
                }
            }
            WM_LBUTTONDOWN => {
                if MENU_MODE.load(Ordering::Relaxed) {
                    // 点选：交给前端判定（启用片发射 / 禁用片抖动 / 空白取消）
                    dispatch(EV_MENU_PICK, info.pt.x, info.pt.y);
                    return LRESULT(1);
                }
            }
            WM_LBUTTONUP | WM_MOUSEWHEEL | WM_MOUSEHWHEEL | WM_RBUTTONDBLCLK => {
                if MENU_MODE.load(Ordering::Relaxed) {
                    return LRESULT(1);
                }
            }
            WM_RBUTTONDOWN => {
                if MENU_MODE.swap(false, Ordering::SeqCst) {
                    // 轮盘打开期间右键 = 取消
                    MENU_OPENED_AT.store(0, Ordering::SeqCst);
                    dispatch(EV_MENU_CANCEL, info.pt.x, info.pt.y);
                    return LRESULT(1);
                }
                if is_down(STRIKE_VK) {
                    // 技能触发：吞掉按下并成对吞掉释放，防止原生菜单
                    SWALLOW_RIGHT_BUTTON.store(true, Ordering::SeqCst);
                    dispatch(EV_STRIKE, info.pt.x, info.pt.y);
                    return LRESULT(1);
                }
                if is_down(MENU_VK.load(Ordering::Relaxed)) {
                    // 唤出轮盘：进入屏蔽模式；右键释放不关闭，等待点选
                    MENU_MODE.store(true, Ordering::SeqCst);
                    MENU_OPENED_AT.store(now_ms(), Ordering::SeqCst);
                    SWALLOW_RIGHT_BUTTON.store(true, Ordering::SeqCst);
                    CURSOR_X.store(info.pt.x, Ordering::Relaxed);
                    CURSOR_Y.store(info.pt.y, Ordering::Relaxed);
                    CURSOR_DIRTY.store(true, Ordering::Release);
                    dispatch(EV_MENU_OPEN, info.pt.x, info.pt.y);
                    return LRESULT(1);
                }
            }
            WM_RBUTTONUP => {
                if SWALLOW_RIGHT_BUTTON.swap(false, Ordering::SeqCst) {
                    // 与被吞掉的按下成对释放；轮盘模式不受影响（保持打开）
                    return LRESULT(1);
                }
            }
            _ => {}
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

fn is_down(vk: u8) -> bool {
    (unsafe { GetAsyncKeyState(vk as i32) } as u16 & 0x8000) != 0
}

fn dispatch(kind: u8, x: i32, y: i32) {
    if let Some(tx) = EVENT_TX.get() {
        let _ = tx.send((kind, x, y));
    }
}
