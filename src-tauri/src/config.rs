//! 持久化配置：快捷键修饰键等，存放于应用数据目录 config.json。

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub menu_modifier: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            menu_modifier: "alt".into(),
        }
    }
}

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("config.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    let Some(path) = config_path(app) else {
        return Settings::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = config_path(app).ok_or_else(|| "无法定位配置目录".to_string())?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
