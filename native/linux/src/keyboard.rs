//! Typed text through wtype (Wayland virtual-keyboard protocol). wtype uploads
//! a keymap holding exactly the symbols it types, so emoji and any script work
//! regardless of the user's layout. Text goes over stdin, never argv, because
//! /proc/<pid>/cmdline is readable by other users.
//!
//! Named keys and Ctrl+V are pressed on the uinput keyboard instead: through
//! an input method such as fcitx5, wtype's key presses reach apps without
//! taking effect, while typed text still commits.

use crate::protocol::Key;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn find_program(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH")?
        .to_str()?
        .split(':')
        .filter(|dir| dir.starts_with('/'))
        .map(|dir| PathBuf::from(dir).join(name))
        .find(|path| path.is_file())
}

/// Run a helper program with a bounded runtime. Its output is discarded so
/// nothing it echoes can reach logs.
pub fn run(program: &str, args: &[&str], input: Option<&[u8]>, timeout: Duration) -> crate::Result<()> {
    let path = find_program(program).ok_or_else(|| format!("{program} is not installed"))?;
    let mut child = Command::new(path)
        .args(args)
        // wtype decodes text with the C library's locale; a service may start with LANG unset.
        .env("LC_ALL", "C.UTF-8")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    if let Some(bytes) = input {
        let mut stdin = child.stdin.take().ok_or("stdin unavailable")?;
        let written = stdin.write_all(bytes);
        drop(stdin);
        if let Err(error) = written {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error.into());
        }
    }
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child.try_wait()? {
            return if status.success() { Ok(()) } else { Err(format!("{program} failed ({status})").into()) };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{program} timed out").into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}

const TIMEOUT: Duration = Duration::from_secs(5);

fn wtype(args: &[&str], input: Option<&[u8]>) -> crate::Result<()> {
    run("wtype", args, input, TIMEOUT)
}

/// The evdev code of a named key; these mean the same in every common layout.
pub fn keycode(key: Key) -> u16 {
    use crate::uinput::*;
    match key {
        Key::Backspace => KEY_BACKSPACE,
        Key::Delete => KEY_DELETE,
        Key::Enter => KEY_ENTER,
        Key::Tab => KEY_TAB,
        Key::Escape => KEY_ESC,
        Key::ArrowLeft => KEY_LEFT,
        Key::ArrowRight => KEY_RIGHT,
        Key::ArrowUp => KEY_UP,
        Key::ArrowDown => KEY_DOWN,
        Key::Home => KEY_HOME,
        Key::End => KEY_END,
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Segment<'a> {
    Text(&'a str),
    Key(Key),
}

/// Split text into runs to type and the Return/Tab keys between them, so line
/// breaks press Enter rather than typing a Linefeed keysym.
pub fn segments(text: &str) -> Vec<Segment<'_>> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((index, c)) = chars.next() {
        let key = match c {
            '\r' | '\n' => Key::Enter,
            '\t' => Key::Tab,
            _ => continue,
        };
        if index > start {
            parts.push(Segment::Text(&text[start..index]));
        }
        parts.push(Segment::Key(key));
        start = index + c.len_utf8();
        if c == '\r' && chars.peek().is_some_and(|&(_, next)| next == '\n') {
            chars.next();
            start += 1;
        }
    }
    if start < text.len() {
        parts.push(Segment::Text(&text[start..]));
    }
    parts
}

/// Type text; line breaks and tabs go to `press` as Enter and Tab.
pub fn text(text: &str, mut press: impl FnMut(Key) -> crate::Result<()>) -> crate::Result<()> {
    for part in segments(text) {
        match part {
            Segment::Text(run) => wtype(&["-"], Some(run.as_bytes()))?,
            Segment::Key(key) => press(key)?,
        }
    }
    Ok(())
}

/// Ctrl+V by keysym, for when there is no uinput keyboard. Works in apps
/// without an input method in between.
pub fn paste_with_wtype() -> crate::Result<()> {
    wtype(&["-M", "ctrl", "-k", "v", "-m", "ctrl"], None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_breaks_and_tabs_become_keys() {
        use Segment::{Key as K, Text as T};
        assert_eq!(segments("Hello 🙂"), vec![T("Hello 🙂")]);
        assert_eq!(segments("a\r\nb\tc\n"), vec![T("a"), K(Key::Enter), T("b"), K(Key::Tab), T("c"), K(Key::Enter)]);
        assert_eq!(segments("\r\r\n"), vec![K(Key::Enter), K(Key::Enter)]);
    }

    #[test]
    fn named_keys_use_layout_independent_codes() {
        assert_eq!(keycode(Key::Enter), 28);
        assert_eq!(keycode(Key::Backspace), 14);
        assert_eq!(keycode(Key::ArrowDown), 108);
        assert_eq!(keycode(Key::Delete), 111);
    }
}
