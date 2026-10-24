//! Opaque keyboard-focus tokens, like KeyboardFocus in native/win/RemoteKeyboard.cs.
//!
//! The identity is the active Hyprland window plus, when the same process
//! reports it, the AT-SPI focused object. Each new identity gets a fresh
//! counter token; only the token and the editable/password flags leave the
//! helper. When neither source knows anything, a token is still issued on
//! request so the phone's keyboard button keeps working.

use crate::atspi::{self, A11yFocus};
use crate::hyprland::{Hyprland, Window};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
struct State {
    window: Option<String>,
    identity: String,
    editable: bool,
    password: bool,
    target: String,
    revision: u64,
}

pub struct Focus {
    state: Arc<Mutex<State>>,
    requested: Arc<AtomicBool>,
    wake: Sender<()>,
    hyprland: Option<Arc<Hyprland>>,
}

pub fn identify(hyprland: bool, window: Option<&Window>, focus: Option<&A11yFocus>) -> (String, bool, bool) {
    match (hyprland, window, focus) {
        (true, None, _) => (String::new(), false, false),
        (true, Some(window), Some(focus)) if focus.pid == window.pid => {
            (format!("{}:{}", window.address, focus.key), focus.editable, focus.password)
        }
        (true, Some(window), _) => (window.address.clone(), false, false),
        (false, _, Some(focus)) => (focus.key.clone(), focus.editable, focus.password),
        (false, _, None) => (String::new(), false, false),
    }
}

impl Focus {
    pub fn start() -> Self {
        let hyprland = Hyprland::detect().map(Arc::new);
        let (wake, woken) = mpsc::channel();
        let a11y = atspi::Shared::default();
        atspi::watch(a11y.clone(), wake.clone());
        let focus = Self { state: Arc::default(), requested: Arc::default(), wake, hyprland };
        let (state, requested, hyprland) = (focus.state.clone(), focus.requested.clone(), focus.hyprland.clone());
        let spawned = std::thread::Builder::new().name("windock-focus".into()).spawn(move || {
            let mut first = true;
            loop {
                let window = hyprland.as_ref().and_then(|h| h.active_window().ok().flatten());
                let current = a11y.lock().unwrap_or_else(|e| e.into_inner()).clone();
                let (identity, editable, password) = identify(hyprland.is_some(), window.as_ref(), current.as_ref());
                {
                    let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
                    let changed = s.identity != identity || s.editable != editable || s.password != password;
                    if changed || s.target.is_empty() {
                        let revision = s.revision + 1;
                        *s = State { window: window.map(|w| w.address), identity, editable, password, target: revision.to_string(), revision };
                    }
                    if changed || first || requested.swap(false, Ordering::SeqCst) {
                        crate::emit(&serde_json::json!({ "type": "focus", "target": s.target, "editable": s.editable, "password": s.password }));
                    }
                }
                first = false;
                match woken.recv_timeout(Duration::from_millis(250)) {
                    Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
        if let Err(error) = spawned {
            eprintln!("Focus tracking could not start ({error}).");
        }
        focus
    }

    /// The phone asked for the current token (keyboard button).
    pub fn refresh(&self) {
        self.requested.store(true, Ordering::SeqCst);
        let _ = self.wake.send(());
    }

    /// Keyboard input needs the current token and, on Hyprland, the same
    /// window still active right now.
    pub fn accepts(&self, target: &str) -> bool {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if target.is_empty() || state.target != target {
            return false;
        }
        match &self.hyprland {
            None => true,
            Some(hyprland) => matches!(hyprland.active_window(), Ok(Some(window)) if state.window.as_deref() == Some(window.address.as_str())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn window(pid: u32) -> Window {
        Window { address: "0xabc".into(), pid }
    }
    fn field(pid: u32) -> A11yFocus {
        A11yFocus { pid, key: ":1.42/org/a11y/atspi/accessible/7".into(), editable: true, password: true }
    }

    #[test]
    fn accessibility_focus_counts_only_inside_the_active_window() {
        assert_eq!(identify(true, Some(&window(10)), Some(&field(10))), ("0xabc::1.42/org/a11y/atspi/accessible/7".into(), true, true));
        assert_eq!(identify(true, Some(&window(10)), Some(&field(11))), ("0xabc".into(), false, false), "another process");
        assert_eq!(identify(true, Some(&window(10)), None), ("0xabc".into(), false, false), "unknown focus is not editable");
        assert_eq!(identify(true, None, Some(&field(10))), (String::new(), false, false), "no active window");
        assert_eq!(identify(false, None, Some(&field(10))).1, true, "other compositors use AT-SPI alone");
        assert_eq!(identify(false, None, None), (String::new(), false, false));
    }
}
