//! 屏幕取样：轮盘唤出瞬间（覆盖层尚未绘制）截取光标周围一小块屏幕，
//! 供「飞碟绑架」识别并切出目标（如微信头像）。
//!
//! 只缓存最近一次取样，仅存在内存、只交给本机前端，不落盘、不外传。

use std::sync::Mutex;

use tauri::ipc::Response;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// 取样边长（物理像素）：覆盖 150% 缩放下的微信头像及其周边背景。
const CAPTURE_SIZE: i32 = 320;

struct Snapshot {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    rgba: Vec<u8>,
}

static LAST: Mutex<Option<Snapshot>> = Mutex::new(None);

/// 以 (cx, cy) 为中心截取一块屏幕并缓存（物理坐标，自动夹在虚拟桌面内）。
pub fn capture_around(cx: i32, cy: i32) {
    let snap = unsafe { grab(cx, cy) };
    if let Ok(mut last) = LAST.lock() {
        *last = snap;
    }
}

unsafe fn grab(cx: i32, cy: i32) -> Option<Snapshot> {
    let vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    let vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    let vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    let vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    let w = CAPTURE_SIZE.min(vw);
    let h = CAPTURE_SIZE.min(vh);
    let x = (cx - w / 2).clamp(vx, vx + vw - w);
    let y = (cy - h / 2).clamp(vy, vy + vh - h);

    let screen = GetDC(None);
    if screen.is_invalid() {
        return None;
    }
    let mem = CreateCompatibleDC(Some(screen));
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        biHeight: -h, // 负高 = 自上而下
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    let result = match CreateDIBSection(Some(mem), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
        Ok(bmp) if !bits.is_null() => {
            let old = SelectObject(mem, bmp.into());
            let ok = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT).is_ok();
            let snap = ok.then(|| {
                let src = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize);
                // GDI 为 BGRA，转 RGBA 并补满 alpha
                let mut rgba = Vec::with_capacity(src.len());
                for px in src.chunks_exact(4) {
                    rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
                }
                Snapshot { x, y, w, h, rgba }
            });
            SelectObject(mem, old);
            let _ = DeleteObject(bmp.into());
            snap
        }
        _ => None,
    };
    let _ = DeleteDC(mem);
    ReleaseDC(Some(HWND::default()), screen);
    result
}

/// 取走最近一次取样（取一次即清空）。
/// 二进制格式：x, y, w, h 四个 i32 小端 + RGBA 像素；无取样时返回空。
#[tauri::command]
pub fn take_capture() -> Response {
    let snap = LAST.lock().ok().and_then(|mut l| l.take());
    let Some(s) = snap else {
        return Response::new(Vec::new());
    };
    let mut out = Vec::with_capacity(16 + s.rgba.len());
    for v in [s.x, s.y, s.w, s.h] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&s.rgba);
    Response::new(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grabs_real_pixels() {
        let s = unsafe { grab(400, 300) }.expect("capture failed");
        assert_eq!(s.rgba.len(), (s.w * s.h * 4) as usize);
        // 桌面不可能整块纯黑：至少要有一些非零像素
        let lit = s.rgba.chunks_exact(4).filter(|p| p[0] as u32 + p[1] as u32 + p[2] as u32 > 30).count();
        assert!(lit > 0, "captured image is all black");
        assert!(s.rgba.chunks_exact(4).all(|p| p[3] == 255));
    }
}
