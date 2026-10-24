//! Read-only Hyprland IPC. The helper only ever asks which window is active;
//! it never dispatches, because Hyprland applies a window action to the
//! active window when its selector matches nothing.

use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    pub address: String,
    pub pid: u32,
}

pub struct Hyprland {
    socket: PathBuf,
}

impl Hyprland {
    pub fn detect() -> Option<Self> {
        let signature = std::env::var("HYPRLAND_INSTANCE_SIGNATURE").ok()?;
        if signature.is_empty() || !signature.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b)) {
            return None;
        }
        let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
        let socket = PathBuf::from(runtime).join("hypr").join(signature).join(".socket.sock");
        socket.exists().then_some(Self { socket })
    }

    /// The focused window, or None when nothing is focused.
    pub fn active_window(&self) -> crate::Result<Option<Window>> {
        let mut stream = UnixStream::connect(&self.socket)?;
        stream.set_read_timeout(Some(Duration::from_millis(500)))?;
        stream.set_write_timeout(Some(Duration::from_millis(500)))?;
        stream.write_all(b"j/activewindow")?;
        let mut body = Vec::new();
        stream.take(1 << 20).read_to_end(&mut body)?;
        Ok(parse_active_window(&body))
    }
}

pub fn parse_active_window(body: &[u8]) -> Option<Window> {
    let value: serde_json::Value = serde_json::from_slice(body).ok()?;
    let address = value.get("address")?.as_str()?;
    let hex = address.strip_prefix("0x")?;
    if hex.is_empty() || hex.len() > 16 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let pid = u32::try_from(value.get("pid")?.as_i64()?).ok().filter(|&pid| pid > 0)?;
    Some(Window { address: address.to_ascii_lowercase(), pid })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_active_window() {
        let window = parse_active_window(br#"{"address":"0x5BFF1fbb9bd0","pid":2957,"class":"x"}"#).unwrap();
        assert_eq!(window, Window { address: "0x5bff1fbb9bd0".into(), pid: 2957 });
        assert_eq!(parse_active_window(b"{}"), None, "nothing focused");
        assert_eq!(parse_active_window(br#"{"address":"0x1 & x","pid":1}"#), None);
        assert_eq!(parse_active_window(br#"{"address":"0x1","pid":-1}"#), None);
        assert_eq!(parse_active_window(b"unknown request"), None);
    }
}
