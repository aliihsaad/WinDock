//! windock-input — the Linux input surface WinDock needs, behind an argv interface.
//!
//! It speaks the same newline-delimited JSON protocol as the Windows helper
//! (native/win/Touchpad.cs), so src/platform/input.js drives both.
//!
//! Verbs:
//!   touchpad                 stream pointer/keyboard input from stdin, emit ready/focus events
//!   signature <dir>          render stdin strokes to a transparent PNG in <dir>
//!   signature-insert <dir>   same, then copy it with wl-copy and paste with Ctrl+V
//!   check                    print which requirements are met, as JSON
//!
//! Every external program is spawned with an argv array, never a shell. Typed
//! text and signature strokes are never written to stderr.
//!
//! Exit codes: 0 success, 1 usage error, 2 runtime failure.

mod atspi;
mod focus;
mod hyprland;
mod keyboard;
mod protocol;
mod signature;
mod touchpad;
mod uinput;

use std::process::ExitCode;

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;

/// Write one JSON line to stdout. A shared lock keeps lines from different
/// threads whole.
pub fn emit(value: &serde_json::Value) {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}");
    let _ = out.flush();
}

fn main() -> ExitCode {
    let args: Vec<String> = match std::env::args_os().skip(1).map(|a| a.into_string()).collect() {
        Ok(args) => args,
        Err(_) => return usage("arguments must be UTF-8"),
    };
    let result = match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["touchpad"] => touchpad::run(),
        ["signature", dir] => signature::save(dir, false),
        ["signature-insert", dir] => signature::save(dir, true),
        ["check"] => check(),
        _ => return usage("usage: windock-input <touchpad | signature DIR | signature-insert DIR | check>"),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(2)
        }
    }
}

fn usage(message: &str) -> ExitCode {
    eprintln!("{message}");
    ExitCode::from(1)
}

/// Read-only diagnostics: nothing is created, moved or typed.
fn check() -> Result<()> {
    let uinput = match uinput::probe() {
        Ok(()) => "ok".to_string(),
        Err(error) => error.to_string(),
    };
    emit(&serde_json::json!({
        "uinput": uinput,
        "wtype": keyboard::find_program("wtype").is_some(),
        "wlCopy": keyboard::find_program("wl-copy").is_some(),
        "hyprland": hyprland::Hyprland::detect().is_some_and(|h| h.active_window().is_ok()),
        "atspi": atspi::bus_address().is_ok(),
    }));
    Ok(())
}
