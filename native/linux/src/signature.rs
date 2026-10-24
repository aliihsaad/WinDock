//! Signature export, mirroring native/win/Signature.cs: validated strokes in,
//! a transparent 1600x600 PNG out, optionally pasted into the focused app.

use crate::hyprland::Hyprland;
use crate::uinput::{Pointer, VirtualInput};
use crate::{emit, keyboard};
use serde::Deserialize;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tiny_skia::{FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, Stroke, Transform};

pub const WIDTH: u32 = 1600;
pub const HEIGHT: u32 = 600;
const MAX_BODY: usize = 65536;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signature {
    strokes: Vec<Vec<[f64; 2]>>,
    color: String,
}

/// Validate everything before allocating an image or creating any file.
pub fn parse(body: &[u8]) -> crate::Result<Signature> {
    let bad = || -> crate::Error { "Invalid signature.".into() };
    let signature: Signature = serde_json::from_slice(body).map_err(|_| bad())?;
    if !matches!(signature.color.as_str(), "black" | "blue") || !(1..=64).contains(&signature.strokes.len()) {
        return Err(bad());
    }
    let mut count = 0;
    for stroke in &signature.strokes {
        count += stroke.len();
        if stroke.is_empty() || count > 2048 {
            return Err(bad());
        }
        if stroke.iter().flatten().any(|n| !n.is_finite() || !(0.0..=1.0).contains(n)) {
            return Err(bad());
        }
    }
    Ok(signature)
}

pub fn render(signature: &Signature) -> crate::Result<Pixmap> {
    let mut pixmap = Pixmap::new(WIDTH, HEIGHT).ok_or("Could not allocate the signature image.")?;
    let mut paint = Paint::default();
    match signature.color.as_str() {
        "blue" => paint.set_color_rgba8(30, 64, 175, 255),
        _ => paint.set_color_rgba8(24, 24, 27, 255),
    }
    paint.anti_alias = true;
    let pen = Stroke { width: 4.0, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Stroke::default() };
    let scale = |[x, y]: [f64; 2]| ((x * (WIDTH - 1) as f64) as f32, (y * (HEIGHT - 1) as f64) as f32);
    for stroke in &signature.strokes {
        if let [point] = stroke.as_slice() {
            let (x, y) = scale(*point);
            if let Some(dot) = PathBuilder::from_circle(x, y, 2.0) {
                pixmap.fill_path(&dot, &paint, FillRule::Winding, Transform::identity(), None);
            }
            continue;
        }
        let mut path = PathBuilder::new();
        for (index, point) in stroke.iter().enumerate() {
            let (x, y) = scale(*point);
            if index == 0 { path.move_to(x, y) } else { path.line_to(x, y) }
        }
        if let Some(path) = path.finish() {
            pixmap.stroke_path(&path, &paint, &pen, Transform::identity(), None);
        }
    }
    Ok(pixmap)
}

fn timestamp() -> String {
    // SAFETY: time and localtime_r only write into the zeroed tm we own.
    let tm = unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&now, &mut tm);
        tm
    };
    format!("{:04}-{:02}-{:02}-{:02}{:02}{:02}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec)
}

fn random_hex() -> crate::Result<String> {
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

/// Wait until our PNG is the clipboard selection, so Ctrl+V cannot paste
/// whatever was copied before.
fn clipboard_has_png(timeout: Duration) -> bool {
    let Some(program) = keyboard::find_program("wl-paste") else { return false };
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let Ok(mut child) = Command::new(&program).arg("--list-types").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else {
            return false;
        };
        let started = Instant::now();
        let exited = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if started.elapsed() < Duration::from_millis(500) => std::thread::sleep(Duration::from_millis(5)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
            }
        };
        let mut types = String::new();
        if exited.is_some_and(|status| status.success()) {
            let _ = child.stdout.take().map(|out| out.take(64 * 1024).read_to_string(&mut types));
            if types.lines().any(|line| line.trim() == "image/png") {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    false
}

/// Ctrl+V on a short-lived uinput keyboard, which works through input
/// methods; wtype when uinput is not available.
fn paste() -> crate::Result<()> {
    let Ok(device) = VirtualInput::create() else { return keyboard::paste_with_wtype() };
    let mut keys = Pointer::new(device);
    keys.paste()?;
    // Let libinput read the keys before the device disappears.
    std::thread::sleep(Duration::from_millis(100));
    Ok(())
}

pub fn save(dir: &str, insert: bool) -> crate::Result<()> {
    let dir = Path::new(dir);
    if !dir.is_absolute() {
        return Err("The signature folder must be an absolute path.".into());
    }
    // The window that was active when the user pressed Insert.
    let hyprland = if insert { Hyprland::detect() } else { None };
    let target = hyprland.as_ref().and_then(|h| h.active_window().ok().flatten());

    // Read a bounded payload from the private parent pipe, never a client path.
    let mut body = Vec::new();
    std::io::stdin().lock().take(MAX_BODY as u64 + 1).read_to_end(&mut body)?;
    if body.len() > MAX_BODY {
        return Err("Signature too large.".into());
    }
    let png = render(&parse(&body)?)?.encode_png()?;

    std::fs::create_dir_all(dir)?;
    let name = format!("Signature-{}-{}.png", timestamp(), random_hex()?);
    let path = dir.join(&name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(&path)?;
    file.write_all(&png)?;
    file.sync_all()?;

    let mut paste_requested = false;
    if insert {
        // wl-copy keeps serving the selection in the background; its output is
        // detached so it cannot hold the parent's pipes open.
        keyboard::run("wl-copy", &["--type", "image/png"], Some(png.as_slice()), Duration::from_secs(5))
            .map_err(|error| format!("Could not copy the signature: {error}"))?;
        // Keep the PNG on disk and clipboard even if focus moved or paste fails.
        if let (Some(hyprland), Some(before)) = (&hyprland, &target) {
            let unchanged = || matches!(hyprland.active_window(), Ok(Some(now)) if now.address == before.address);
            if unchanged() && clipboard_has_png(Duration::from_secs(1)) && unchanged() {
                paste_requested = paste().is_ok();
            }
        }
    }
    emit(&serde_json::json!({
        "type": "saved",
        "path": path.to_string_lossy(),
        "name": name,
        "width": WIDTH,
        "height": HEIGHT,
        "clipboard": insert,
        "pasteRequested": paste_requested,
    }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha(pixmap: &Pixmap, x: u32, y: u32) -> u8 {
        pixmap.pixel(x, y).unwrap().alpha()
    }

    #[test]
    fn renders_transparent_ink() {
        let signature = parse(br#"{"strokes":[[[0.1,0.5],[0.9,0.5]],[[0.5,0.9]]],"color":"blue"}"#).unwrap();
        let pixmap = render(&signature).unwrap();
        assert_eq!((pixmap.width(), pixmap.height()), (WIDTH, HEIGHT));
        assert_eq!(alpha(&pixmap, 0, 0), 0, "background is transparent");
        assert_eq!(alpha(&pixmap, 800, 100), 0, "away from the ink");
        let ink = pixmap.pixel(800, 299).unwrap().demultiply();
        assert_eq!((ink.red(), ink.green(), ink.blue(), ink.alpha()), (30, 64, 175, 255), "line is solid blue");
        assert!(alpha(&pixmap, 800, 539) > 0, "single point draws a dot");
        let png = pixmap.encode_png().unwrap();
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn rejects_bad_signatures() {
        for bad in [
            r#"{"strokes":[],"color":"black"}"#.to_string(),
            r#"{"strokes":[[[0.1,0.2]]],"color":"red"}"#.to_string(),
            r#"{"strokes":[[[1.5,0.2]]],"color":"black"}"#.to_string(),
            r#"{"strokes":[[[0.1]]],"color":"black"}"#.to_string(),
            r#"{"strokes":[[]],"color":"black"}"#.to_string(),
            r#"{"strokes":[[[0.1,0.2]]],"color":"black","path":"/etc/x"}"#.to_string(),
            format!(r#"{{"strokes":[[{}]],"color":"black"}}"#, vec!["[0,0]"; 2049].join(",")),
            format!(r#"{{"strokes":[{}],"color":"black"}}"#, vec!["[[0,0]]"; 65].join(",")),
        ] {
            assert!(parse(bad.as_bytes()).is_err(), "{bad}");
        }
        assert!(parse(format!(r#"{{"strokes":[[{}]],"color":"black"}}"#, vec!["[0,0]"; 2048].join(",")).as_bytes()).is_ok());
    }

    #[test]
    fn file_names_are_unique_and_local() {
        let stamp = timestamp();
        assert_eq!(stamp.len(), 17, "{stamp}");
        assert_ne!(random_hex().unwrap(), random_hex().unwrap());
    }
}
