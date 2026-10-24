//! Best-effort text-focus metadata from AT-SPI2 on the accessibility bus.
//!
//! GTK and Qt report focus well; Chromium and Electron only when their
//! accessibility is on; most terminals expose nothing. Only the role and the
//! state bits are read, never a value, selection or text.

use std::collections::HashMap;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use zbus::blocking::{Connection, MessageIterator, connection};
use zbus::zvariant::{Structure, Value};

const STATE_EDITABLE: u32 = 7;
const STATE_ENABLED: u32 = 8;
const STATE_SENSITIVE: u32 = 24;
const STATE_READ_ONLY: u32 = 43;
const ROLE_PASSWORD_TEXT: u32 = 40;
const ROLE_TERMINAL: u32 = 60;
const FOCUS_EVENT: &str = "object:state-changed:focused";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct A11yFocus {
    pub pid: u32,
    /// Bus name and object path: an identity, not content.
    pub key: String,
    pub editable: bool,
    pub password: bool,
}

pub type Shared = Arc<Mutex<Option<A11yFocus>>>;

pub fn classify(state: &[u32], role: u32) -> (bool, bool) {
    let has = |bit: u32| state.get((bit / 32) as usize).is_some_and(|word| (word >> (bit % 32)) & 1 == 1);
    let password = role == ROLE_PASSWORD_TEXT;
    let usable = has(STATE_ENABLED) || has(STATE_SENSITIVE);
    let editable = usable && ((has(STATE_EDITABLE) && !has(STATE_READ_ONLY)) || password || role == ROLE_TERMINAL);
    (editable, password)
}

pub fn bus_address() -> crate::Result<String> {
    let session = Connection::session()?;
    let reply = session.call_method(Some("org.a11y.Bus"), "/org/a11y/bus", Some("org.a11y.Bus"), "GetAddress", &())?;
    Ok(reply.body().deserialize::<String>()?)
}

/// Track focus on a background thread; `wake` is poked after every change.
pub fn watch(shared: Shared, wake: Sender<()>) {
    let spawned = std::thread::Builder::new().name("windock-atspi".into()).spawn(move || {
        if let Err(error) = run(&shared, &wake) {
            eprintln!("AT-SPI focus tracking is unavailable ({error}); the keyboard button still works.");
        }
    });
    if let Err(error) = spawned {
        eprintln!("AT-SPI focus tracking could not start ({error}).");
    }
}

fn run(shared: &Shared, wake: &Sender<()>) -> crate::Result<()> {
    let address = bus_address()?;
    let bus = connection::Builder::address(address.as_str())?
        // An unresponsive app must not stall focus tracking for long.
        .method_timeout(Duration::from_millis(800))
        .build()?;
    let rule = zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface("org.a11y.atspi.Event.Object")?
        .member("StateChanged")?
        .arg(0, "focused")?
        .build();
    let events = MessageIterator::for_match_rule(rule, &bus, Some(64))?;
    // Toolkits only emit events somebody registered for. The registry drops
    // the registration when this connection closes.
    let registry = (Some("org.a11y.atspi.Registry"), "/org/a11y/atspi/registry", Some("org.a11y.atspi.Registry"));
    if bus.call_method(registry.0, registry.1, registry.2, "RegisterEvent", &(FOCUS_EVENT, Vec::<&str>::new(), "")).is_err() {
        bus.call_method(registry.0, registry.1, registry.2, "RegisterEvent", &(FOCUS_EVENT,))?;
    }
    let mut pids: HashMap<String, u32> = HashMap::new();
    for message in events {
        let message = message?;
        let header = message.header();
        let (Some(sender), Some(path)) = (header.sender(), header.path()) else { continue };
        let body = message.body();
        let Ok(fields) = body.deserialize::<Structure>() else { continue };
        let gained = match fields.fields() {
            [Value::Str(kind), Value::I32(detail), ..] if kind.as_str() == "focused" => *detail == 1,
            _ => continue,
        };
        let key = format!("{sender}{path}");
        if !gained {
            let mut current = shared.lock().unwrap_or_else(|e| e.into_inner());
            if current.as_ref().is_some_and(|focus| focus.key == key) {
                *current = None;
                drop(current);
                let _ = wake.send(());
            }
            continue;
        }
        let sender = sender.as_str();
        let accessible = |method: &str| bus.call_method(Some(sender), path.as_str(), Some("org.a11y.atspi.Accessible"), method, &());
        let state: Vec<u32> = match accessible("GetState").and_then(|reply| reply.body().deserialize()) {
            Ok(state) => state,
            Err(_) => continue,
        };
        let role: u32 = accessible("GetRole").and_then(|reply| reply.body().deserialize()).unwrap_or(0);
        let pid = match pids.get(sender) {
            Some(&pid) => pid,
            None => {
                let reply = bus.call_method(
                    Some("org.freedesktop.DBus"), "/org/freedesktop/DBus", Some("org.freedesktop.DBus"),
                    "GetConnectionUnixProcessID", &(sender,),
                );
                let Ok(pid) = reply.and_then(|reply| reply.body().deserialize::<u32>()) else { continue };
                pids.insert(sender.to_string(), pid);
                pid
            }
        };
        let (editable, password) = classify(&state, role);
        *shared.lock().unwrap_or_else(|e| e.into_inner()) = Some(A11yFocus { pid, key, editable, password });
        let _ = wake.send(());
    }
    Err("the accessibility bus closed".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bits(list: &[u32]) -> Vec<u32> {
        let mut words = vec![0u32; 2];
        for &bit in list {
            words[(bit / 32) as usize] |= 1 << (bit % 32);
        }
        words
    }

    #[test]
    fn editable_needs_an_enabled_writable_field() {
        assert_eq!(classify(&bits(&[STATE_EDITABLE, STATE_ENABLED, STATE_SENSITIVE]), 79), (true, false));
        assert_eq!(classify(&bits(&[STATE_EDITABLE, STATE_ENABLED, STATE_READ_ONLY]), 79), (false, false));
        assert_eq!(classify(&bits(&[STATE_EDITABLE]), 79), (false, false), "disabled field");
        assert_eq!(classify(&bits(&[STATE_ENABLED]), 43), (false, false), "a button");
        assert_eq!(classify(&bits(&[STATE_ENABLED]), ROLE_PASSWORD_TEXT), (true, true));
        assert_eq!(classify(&bits(&[STATE_ENABLED]), ROLE_TERMINAL), (true, false));
        assert_eq!(classify(&[], 79), (false, false), "no state");
    }
}
