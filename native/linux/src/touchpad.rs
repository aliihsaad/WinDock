//! The persistent touchpad session, mirroring Touchpad.RunAsync on Windows.

use crate::focus::Focus;
use crate::protocol::{self, Button, LineReader, Message, Read};
use crate::uinput::{Pointer, Sink, VirtualInput};
use crate::{emit, keyboard};
use std::fs::OpenOptions;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::time::Duration;

/// One touchpad per user session, like the Windows `Local\WinDock.Touchpad` mutex.
fn single_instance() -> crate::Result<Option<std::fs::File>> {
    let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") else { return Ok(None) };
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC)
        .open(std::path::Path::new(&runtime).join("windock-touchpad.lock"))?;
    // SAFETY: flock on a descriptor we own.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        return Err("Another touchpad is active.".into());
    }
    Ok(Some(file))
}

pub fn run() -> crate::Result<()> {
    let _lock = single_instance()?;
    let mut pointer = Pointer::new(VirtualInput::create()?);
    let focus = Focus::start();
    emit(&serde_json::json!({ "type": "ready" }));
    let result = session(&mut pointer, &focus);
    // Also runs after a parse error, a stdin EOF, or the parent going quiet.
    let released = pointer.release();
    result.and(released.map_err(Into::into))
}

fn session<S: Sink>(pointer: &mut Pointer<S>, focus: &Focus) -> crate::Result<()> {
    let mut input = LineReader::new(libc::STDIN_FILENO);
    loop {
        // Releases buttons if Node crashes or stops forwarding the phone heartbeat.
        let line = match input.next(Duration::from_secs(2))? {
            Read::Line(line) => line,
            Read::Eof | Read::Timeout => return Ok(()),
        };
        match protocol::parse(&line)? {
            Message::Ping {} => {}
            Message::Focus {} => focus.refresh(),
            Message::Release {} => pointer.release()?,
            Message::Move { dx, dy } => pointer.movement(dx, dy)?,
            Message::Scroll { dx, dy } => pointer.scroll(dx, dy)?,
            Message::Zoom { steps } => pointer.zoom(steps)?,
            Message::Button { button, down } => pointer.button(button == Button::Right, down)?,
            Message::Text { target, text } => type_into(pointer, focus, &target, |pointer| {
                keyboard::text(&text, |key| Ok(pointer.key(keyboard::keycode(key))?))
            }),
            Message::Key { target, key } => type_into(pointer, focus, &target, |pointer| Ok(pointer.key(keyboard::keycode(key))?)),
        }
    }
}

/// Keyboard input goes only to the field the phone was told about. Any
/// failure is reported as an input-error, never with the text itself.
fn type_into<S: Sink>(pointer: &mut Pointer<S>, focus: &Focus, target: &str, send: impl FnOnce(&mut Pointer<S>) -> crate::Result<()>) {
    let sent = if focus.accepts(target) {
        pointer.release().map_err(Into::into).and_then(|()| send(pointer))
    } else {
        Err("Focus changed.".into())
    };
    if let Err(error) = sent {
        if error.to_string() != "Focus changed." {
            eprintln!("Keyboard input failed: {error}");
        }
        emit(&serde_json::json!({ "type": "input-error" }));
        focus.refresh();
    }
}
