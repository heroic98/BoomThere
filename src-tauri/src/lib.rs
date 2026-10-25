mod config;
mod input;
mod overlay;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            // 读取持久化快捷键配置并应用到钩子
            let settings = config::load(&handle);
            if let Some(mk) = input::vk_from_name(&settings.menu_modifier) {
                input::set_menu_modifier(mk);
            }
            overlay::create_overlay(&handle)?;
            input::install(handle);
            overlay::setup_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            overlay::overlay_ready,
            overlay::menu_finish,
            overlay::log_line,
            overlay::get_settings,
            overlay::set_settings,
            overlay::open_settings,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build BoomThere application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                input::shutdown();
            }
        });
}
