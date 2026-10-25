//! 覆盖层窗口：全屏、透明、置顶、无装饰、鼠标穿透。
//! 托盘：设置 / 退出。设置窗口：快捷键等配置面板。

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::config::{self, Settings};
use crate::input;

pub const OVERLAY_LABEL: &str = "overlay";
pub const SETTINGS_LABEL: &str = "settings";

/// 创建隐藏的覆盖层窗口；前端画布就绪后调用 `overlay_ready` 再显示。
pub fn create_overlay(app: &AppHandle) -> tauri::Result<()> {
    let monitor = app.primary_monitor()?.expect("no primary monitor found");
    let scale = monitor.scale_factor();
    let pos = monitor.position().to_logical::<f64>(scale);
    let size = monitor.size().to_logical::<f64>(scale);

    let win = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("index.html".into()))
        .title("BoomThere Overlay")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .focused(false)
        .visible(false)
        .shadow(false)
        .position(pos.x, pos.y)
        .inner_size(size.width, size.height)
        // 覆盖层永不抢焦点；放开 WebView2 自动播放限制以启用合成音效
        .additional_browser_args(
            "--autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        )
        .build()?;

    // 创建即穿透：无论何时显示都不会挡住下层应用的鼠标输入
    let _ = win.set_ignore_cursor_events(true);
    Ok(())
}

/// 前端特效画布初始化完毕后调用：安全显示覆盖层。
#[tauri::command]
pub fn overlay_ready(app: AppHandle) {
    if let Some(win) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = win.set_ignore_cursor_events(true);
        let _ = win.show();
    }
}

/// 前端结算完毕（点选技能或取消）：退出轮盘屏蔽模式，恢复正常输入。
#[tauri::command]
pub fn menu_finish() {
    crate::input::exit_menu_mode();
}

/// 前端诊断日志落盘（与钩子日志同文件，便于实机排查事件链路）。
#[tauri::command]
pub fn log_line(line: String) {
    crate::input::hlog(&format!("[ui] {line}"));
}

/// 读取当前设置。
#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    config::load(&app)
}

/// 保存设置：写配置并热更新钩子。
#[tauri::command]
pub fn set_settings(app: AppHandle, menu_modifier: String) -> Result<(), String> {
    let menu_vk =
        input::vk_from_name(&menu_modifier).ok_or_else(|| format!("不支持的修饰键：{menu_modifier}"))?;
    let settings = Settings { menu_modifier };
    config::save(&app, &settings)?;
    input::set_menu_modifier(menu_vk);
    Ok(())
}

/// 打开（或聚焦）设置窗口；托盘「设置」与命令共用。
pub fn open_settings_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("settings.html".into()))
        .title("BoomThere 设置")
        .inner_size(440.0, 520.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build()?;
    Ok(())
}

/// 托盘「设置」入口（可从前端 invoke 调用）。
#[tauri::command]
pub fn open_settings(app: AppHandle) {
    let _ = open_settings_window(&app);
}

/// 常驻托盘图标：设置 + 退出。
pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 BoomThere", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &quit])?;
    TrayIconBuilder::with_id("boomthere-tray")
        .icon(tray_icon_image())
        .tooltip("BoomThere · 右键轮盘特效")
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                app.exit(0);
            } else if event.id() == "settings" {
                let _ = open_settings_window(app);
            }
        })
        .build(app)?;
    Ok(())
}

/// 程序化绘制托盘图标（准星图案），无需素材文件。
fn tray_icon_image() -> tauri::image::Image<'static> {
    const S: usize = 32;
    let mut rgba = vec![0u8; S * S * 4];
    for y in 0..S {
        for x in 0..S {
            let dx = x as f32 - 15.5;
            let dy = y as f32 - 15.5;
            let d = (dx * dx + dy * dy).sqrt();
            let (r, g, b, a) = if d <= 5.5 {
                (255u8, 122u8, 26u8, 255u8) // 中心橙色
            } else if (11.0..=14.5).contains(&d) {
                (224u8, 49u8, 49u8, 255u8) // 红色外环
            } else {
                (0, 0, 0, 0)
            };
            let i = (y * S + x) * 4;
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = a;
        }
    }
    tauri::image::Image::new_owned(rgba, S as u32, S as u32)
}
