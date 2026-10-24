//! The touchpad protocol, revalidated here exactly like src/input.js
//! `validateInput` so the helper never trusts its parent blindly.

use serde::Deserialize;
use std::os::fd::RawFd;
use std::time::{Duration, Instant};

pub const MAX_LINE: usize = 8192;

#[derive(Debug, PartialEq, Eq, Deserialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Button {
    Left,
    Right,
}

/// Only named editing keys; no modifiers can be left held.
#[derive(Debug, PartialEq, Eq, Deserialize, Clone, Copy)]
pub enum Key {
    Backspace,
    Delete,
    Enter,
    Tab,
    Escape,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    ArrowDown,
    Home,
    End,
}

#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Message {
    // Empty structs rather than unit variants: serde ignores extra fields on
    // internally tagged unit variants, even with deny_unknown_fields.
    Ping {},
    Release {},
    Focus {},
    Move { dx: i32, dy: i32 },
    Scroll { dx: i32, dy: i32 },
    Zoom { steps: i32 },
    Button { button: Button, down: bool },
    Text { target: String, text: String },
    Key { target: String, key: Key },
}

pub fn valid_target(target: &str) -> bool {
    let bytes = target.as_bytes();
    (1..=16).contains(&bytes.len()) && bytes[0] != b'0' && bytes.iter().all(u8::is_ascii_digit)
}

fn valid_text(text: &str) -> bool {
    let units = text.encode_utf16().count();
    (1..=1024).contains(&units)
        && !text.chars().any(|c| c.is_control() && c <= '\u{7f}' && !matches!(c, '\t' | '\n' | '\r'))
}

pub fn parse(line: &str) -> crate::Result<Message> {
    let message: Message = serde_json::from_str(line).map_err(|_| "Invalid input.")?;
    let delta = |n: i32| n.unsigned_abs() <= 2048;
    let ok = match &message {
        Message::Ping {} | Message::Release {} | Message::Focus {} | Message::Button { .. } => true,
        Message::Move { dx, dy } | Message::Scroll { dx, dy } => delta(*dx) && delta(*dy),
        Message::Zoom { steps } => (1..=8).contains(&steps.unsigned_abs()),
        Message::Text { target, text } => valid_target(target) && valid_text(text),
        Message::Key { target, .. } => valid_target(target),
    };
    if ok { Ok(message) } else { Err("Invalid input.".into()) }
}

pub enum Read {
    Line(String),
    Eof,
    Timeout,
}

/// Newline-delimited reader with a per-line deadline, so a silent or crashed
/// parent can never leave a button held.
pub struct LineReader {
    fd: RawFd,
    buffer: Vec<u8>,
    eof: bool,
}

impl LineReader {
    pub fn new(fd: RawFd) -> Self {
        Self { fd, buffer: Vec::new(), eof: false }
    }

    fn take(&mut self, end: usize, skip: usize) -> crate::Result<Read> {
        let line: Vec<u8> = self.buffer.drain(..end + skip).take(end).collect();
        let mut line = String::from_utf8(line).map_err(|_| "Input is not UTF-8.")?;
        if line.ends_with('\r') {
            line.pop();
        }
        Ok(Read::Line(line))
    }

    pub fn next(&mut self, timeout: Duration) -> crate::Result<Read> {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(end) = self.buffer.iter().position(|&b| b == b'\n') {
                if end > MAX_LINE {
                    return Err("Input too large.".into());
                }
                return self.take(end, 1);
            }
            if self.buffer.len() > MAX_LINE {
                return Err("Input too large.".into());
            }
            if self.eof {
                return if self.buffer.is_empty() { Ok(Read::Eof) } else { self.take(self.buffer.len(), 0) };
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Ok(Read::Timeout);
            }
            let mut poll = libc::pollfd { fd: self.fd, events: libc::POLLIN, revents: 0 };
            // SAFETY: one valid pollfd for the duration of the call.
            let ready = unsafe { libc::poll(&mut poll, 1, left.as_millis().clamp(1, i32::MAX as u128) as i32) };
            if ready < 0 {
                let error = std::io::Error::last_os_error();
                if error.kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error.into());
            }
            if ready == 0 {
                return Ok(Read::Timeout);
            }
            let mut chunk = [0u8; 4096];
            // SAFETY: the buffer is valid for chunk.len() bytes.
            let count = unsafe { libc::read(self.fd, chunk.as_mut_ptr().cast(), chunk.len()) };
            if count < 0 {
                let error = std::io::Error::last_os_error();
                if matches!(error.kind(), std::io::ErrorKind::Interrupted | std::io::ErrorKind::WouldBlock) {
                    continue;
                }
                return Err(error.into());
            }
            if count == 0 {
                self.eof = true;
            } else {
                self.buffer.extend_from_slice(&chunk[..count as usize]);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_protocol() {
        assert_eq!(parse(r#"{"type":"move","dx":-2048,"dy":2048}"#).unwrap(), Message::Move { dx: -2048, dy: 2048 });
        assert_eq!(parse(r#"{"type":"zoom","steps":-8}"#).unwrap(), Message::Zoom { steps: -8 });
        assert_eq!(parse(r#"{"type":"button","button":"right","down":true}"#).unwrap(), Message::Button { button: Button::Right, down: true });
        assert_eq!(parse(r#"{"type":"key","target":"12","key":"ArrowLeft"}"#).unwrap(), Message::Key { target: "12".into(), key: Key::ArrowLeft });
        assert_eq!(parse(r#"{"type":"text","target":"1","text":"مرحبا 👋🏽\ttab"}"#).unwrap(), Message::Text { target: "1".into(), text: "مرحبا 👋🏽\ttab".into() });
        assert_eq!(parse(r#"{"type":"focus"}"#).unwrap(), Message::Focus {});
        let emoji = format!(r#"{{"type":"text","target":"1","text":"{}"}}"#, "🙂".repeat(512));
        assert!(parse(&emoji).is_ok(), "1024 UTF-16 units");
    }

    #[test]
    fn rejects_everything_else() {
        for bad in [
            r#"{"type":"move","dx":2049,"dy":0}"#,
            r#"{"type":"move","dx":0.5,"dy":0}"#,
            r#"{"type":"zoom","steps":0}"#,
            r#"{"type":"zoom","steps":9}"#,
            r#"{"type":"zoom","steps":-2147483648}"#,
            r#"{"type":"move","dx":-2147483648,"dy":0}"#,
            r#"{"type":"button","button":"middle","down":true}"#,
            r#"{"type":"key","target":"1","key":"Control"}"#,
            r#"{"type":"text","target":"0","text":"hi"}"#,
            r#"{"type":"text","target":"../x","text":"hi"}"#,
            r#"{"type":"text","target":"1","text":""}"#,
            r#"{"type":"text","target":"1","text":"\u001b[2J"}"#,
            r#"{"type":"text","target":"1","text":"\ud800"}"#,
            r#"{"type":"release","path":"/etc"}"#,
            r#"{"type":"launch"}"#,
            "not json",
        ] {
            assert!(parse(bad).is_err(), "{bad}");
        }
        let long = format!(r#"{{"type":"text","target":"1","text":"{}"}}"#, "🙂".repeat(513));
        assert!(parse(&long).is_err(), "over 1024 UTF-16 units");
    }

    fn pipe() -> (RawFd, std::fs::File) {
        let mut fds = [0; 2];
        assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
        (fds[0], unsafe { <std::fs::File as std::os::fd::FromRawFd>::from_raw_fd(fds[1]) })
    }

    #[test]
    fn reads_lines_then_eof() {
        use std::io::Write;
        let (read, mut write) = pipe();
        write.write_all(b"{\"type\":\"ping\"}\r\nlast").unwrap();
        drop(write);
        let mut reader = LineReader::new(read);
        let second = Duration::from_secs(1);
        assert!(matches!(reader.next(second).unwrap(), Read::Line(l) if l == r#"{"type":"ping"}"#));
        assert!(matches!(reader.next(second).unwrap(), Read::Line(l) if l == "last"));
        assert!(matches!(reader.next(second).unwrap(), Read::Eof));
        unsafe { libc::close(read) };
    }

    #[test]
    fn times_out_when_the_parent_goes_quiet() {
        let (read, write) = pipe();
        let mut reader = LineReader::new(read);
        let started = Instant::now();
        assert!(matches!(reader.next(Duration::from_millis(60)).unwrap(), Read::Timeout));
        assert!(started.elapsed() >= Duration::from_millis(55));
        drop(write);
        unsafe { libc::close(read) };
    }

    #[test]
    fn refuses_oversized_lines() {
        use std::io::Write;
        let (read, mut write) = pipe();
        let mut reader = LineReader::new(read);
        let writer = std::thread::spawn(move || { let _ = write.write_all(&vec![b'x'; MAX_LINE + 10]); });
        assert!(reader.next(Duration::from_secs(1)).is_err());
        unsafe { libc::close(read) };
        writer.join().unwrap();
    }
}
