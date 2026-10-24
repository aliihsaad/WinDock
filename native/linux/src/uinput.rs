//! A uinput virtual pointer and keyboard, which every compositor reads
//! through libinput.
//!
//! The keyboard half presses only Ctrl, V and the named editing keys, whose
//! evdev codes mean the same in every common layout. Being a real keyboard,
//! its keys pass through input methods like fcitx5 exactly as physical ones
//! do, which keys from a wtype virtual keyboard do not. Text still goes
//! through wtype, because evdev codes cannot spell arbitrary characters.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::time::Duration;

pub const EV_SYN: u16 = 0x00;
pub const EV_KEY: u16 = 0x01;
pub const EV_REL: u16 = 0x02;
pub const SYN_REPORT: u16 = 0;
pub const REL_X: u16 = 0x00;
pub const REL_Y: u16 = 0x01;
pub const REL_HWHEEL: u16 = 0x06;
pub const REL_WHEEL: u16 = 0x08;
pub const REL_WHEEL_HI_RES: u16 = 0x0b;
pub const REL_HWHEEL_HI_RES: u16 = 0x0c;
pub const BTN_LEFT: u16 = 0x110;
pub const BTN_RIGHT: u16 = 0x111;
pub const BTN_MIDDLE: u16 = 0x112;
pub const KEY_LEFTCTRL: u16 = 29;
pub const KEY_V: u16 = 47;
pub const KEY_ESC: u16 = 1;
pub const KEY_BACKSPACE: u16 = 14;
pub const KEY_TAB: u16 = 15;
pub const KEY_ENTER: u16 = 28;
pub const KEY_HOME: u16 = 102;
pub const KEY_UP: u16 = 103;
pub const KEY_LEFT: u16 = 105;
pub const KEY_RIGHT: u16 = 106;
pub const KEY_END: u16 = 107;
pub const KEY_DOWN: u16 = 108;
pub const KEY_DELETE: u16 = 111;

const DEVICE: &str = "/dev/uinput";
const BUS_VIRTUAL: u16 = 0x06;

// _IO/_IOW('U', nr, size) with the generic encoding used by x86_64 and aarch64.
const fn ioc(dir: u64, nr: u64, size: u64) -> u64 {
    (dir << 30) | (size << 16) | ((b'U' as u64) << 8) | nr
}
const UI_DEV_CREATE: u64 = ioc(0, 1, 0);
const UI_DEV_DESTROY: u64 = ioc(0, 2, 0);
const UI_DEV_SETUP: u64 = ioc(1, 3, std::mem::size_of::<UinputSetup>() as u64);
const UI_SET_EVBIT: u64 = ioc(1, 100, 4);
const UI_SET_KEYBIT: u64 = ioc(1, 101, 4);
const UI_SET_RELBIT: u64 = ioc(1, 102, 4);

#[repr(C)]
struct InputId {
    bustype: u16,
    vendor: u16,
    product: u16,
    version: u16,
}

#[repr(C)]
struct UinputSetup {
    id: InputId,
    name: [u8; 80],
    ff_effects_max: u32,
}

/// Something that accepts evdev events; a SYN_REPORT ends every batch.
pub trait Sink {
    fn send(&mut self, events: &[(u16, u16, i32)]) -> io::Result<()>;
    /// Give the compositor time to deliver what was sent so far.
    fn settle(&mut self) {}
}

fn open_error(error: io::Error) -> io::Error {
    let message = match error.kind() {
        io::ErrorKind::PermissionDenied => format!(
            "{DEVICE} is not writable by this user, so the touchpad cannot move the pointer. \
             Install native/linux/70-windock-uinput.rules (docs/DEVELOPMENT.md, Linux host)."
        ),
        io::ErrorKind::NotFound => format!("{DEVICE} does not exist. Load the uinput kernel module: sudo modprobe uinput"),
        _ => format!("Cannot open {DEVICE}: {error}"),
    };
    io::Error::new(error.kind(), message)
}

fn open() -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_CLOEXEC)
        .open(DEVICE)
        .map_err(open_error)
}

/// Check access without creating a device.
pub fn probe() -> io::Result<()> {
    open().map(drop)
}

pub struct VirtualInput {
    file: File,
}

fn ioctl(file: &File, request: u64, value: libc::c_ulong) -> io::Result<()> {
    // SAFETY: every request here takes an int or a pointer to a live UinputSetup.
    let result = unsafe { libc::ioctl(file.as_raw_fd(), request as _, value) };
    if result < 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

impl VirtualInput {
    pub fn create() -> io::Result<Self> {
        let file = open()?;
        ioctl(&file, UI_SET_EVBIT, EV_KEY as _)?;
        ioctl(&file, UI_SET_EVBIT, EV_REL as _)?;
        for button in [BTN_LEFT, BTN_RIGHT, BTN_MIDDLE] {
            ioctl(&file, UI_SET_KEYBIT, button as _)?;
        }
        // udev's input_id marks a device as a keyboard when it has KEY_ESC..KEY_D.
        for key in (1..=31u16).chain([KEY_V, KEY_HOME, KEY_UP, KEY_LEFT, KEY_RIGHT, KEY_END, KEY_DOWN, KEY_DELETE]) {
            ioctl(&file, UI_SET_KEYBIT, key as _)?;
        }
        for axis in [REL_X, REL_Y, REL_WHEEL, REL_HWHEEL, REL_WHEEL_HI_RES, REL_HWHEEL_HI_RES] {
            ioctl(&file, UI_SET_RELBIT, axis as _)?;
        }
        let mut setup = UinputSetup {
            id: InputId { bustype: BUS_VIRTUAL, vendor: 0x5744, product: 0x0001, version: 1 },
            name: [0; 80],
            ff_effects_max: 0,
        };
        let name = b"WinDock virtual input";
        setup.name[..name.len()].copy_from_slice(name);
        ioctl(&file, UI_DEV_SETUP, &setup as *const UinputSetup as libc::c_ulong)?;
        ioctl(&file, UI_DEV_CREATE, 0)?;
        // Events written before libinput opens the new node are lost.
        std::thread::sleep(Duration::from_millis(300));
        Ok(Self { file })
    }
}

impl Sink for VirtualInput {
    fn send(&mut self, events: &[(u16, u16, i32)]) -> io::Result<()> {
        let mut bytes = Vec::with_capacity((events.len() + 1) * std::mem::size_of::<libc::input_event>());
        for &(kind, code, value) in events.iter().chain([(EV_SYN, SYN_REPORT, 0)].iter()) {
            let event = libc::input_event {
                time: libc::timeval { tv_sec: 0, tv_usec: 0 },
                type_: kind,
                code,
                value,
            };
            // SAFETY: input_event is plain old data with no padding the kernel reads.
            let raw = unsafe {
                std::slice::from_raw_parts(&event as *const _ as *const u8, std::mem::size_of::<libc::input_event>())
            };
            bytes.extend_from_slice(raw);
        }
        self.file.write_all(&bytes)
    }

    fn settle(&mut self) {
        std::thread::sleep(Duration::from_millis(20));
    }
}

impl Drop for VirtualInput {
    fn drop(&mut self) {
        // Removing the device also makes libinput release anything still held.
        let _ = ioctl(&self.file, UI_DEV_DESTROY, 0);
    }
}

/// Pointer state for one touchpad session, mirroring the Windows helper.
pub struct Pointer<S: Sink> {
    sink: S,
    left: bool,
    right: bool,
    wheel: i32,
    hwheel: i32,
}

impl<S: Sink> Pointer<S> {
    pub fn new(sink: S) -> Self {
        Self { sink, left: false, right: false, wheel: 0, hwheel: 0 }
    }

    pub fn movement(&mut self, dx: i32, dy: i32) -> io::Result<()> {
        if dx == 0 && dy == 0 {
            return Ok(());
        }
        self.sink.send(&[(EV_REL, REL_X, dx), (EV_REL, REL_Y, dy)])
    }

    /// Deltas are 120ths of a wheel notch, the unit of both Windows wheel data
    /// and REL_WHEEL_HI_RES. Whole notches are also sent as REL_WHEEL for
    /// readers without high-resolution support, as kernel drivers do.
    pub fn scroll(&mut self, dx: i32, dy: i32) -> io::Result<()> {
        let mut events = Vec::with_capacity(4);
        if dy != 0 {
            events.push((EV_REL, REL_WHEEL_HI_RES, dy));
            self.wheel += dy;
            let notches = self.wheel / 120;
            if notches != 0 {
                events.push((EV_REL, REL_WHEEL, notches));
                self.wheel -= notches * 120;
            }
        }
        if dx != 0 {
            events.push((EV_REL, REL_HWHEEL_HI_RES, dx));
            self.hwheel += dx;
            let notches = self.hwheel / 120;
            if notches != 0 {
                events.push((EV_REL, REL_HWHEEL, notches));
                self.hwheel -= notches * 120;
            }
        }
        if events.is_empty() { Ok(()) } else { self.sink.send(&events) }
    }

    /// Hold Ctrl around `events`. Hyprland handles a batch's pointer events
    /// before its key events, so Ctrl gets its own write and a moment to
    /// reach the app before the rest, and again before it is released.
    fn with_ctrl(&mut self, events: &[(u16, u16, i32)]) -> io::Result<()> {
        self.sink.send(&[(EV_KEY, KEY_LEFTCTRL, 1)])?;
        self.sink.settle();
        let sent = self.sink.send(events);
        self.sink.settle();
        // Release even if the rest failed, so the synthetic Ctrl is never left held.
        let released = self.sink.send(&[(EV_KEY, KEY_LEFTCTRL, 0)]);
        sent.and(released)
    }

    /// Ctrl + whole wheel notches. Ignored while a button is held, like the
    /// Windows helper.
    pub fn zoom(&mut self, steps: i32) -> io::Result<()> {
        if self.left || self.right {
            return Ok(());
        }
        self.with_ctrl(&[(EV_REL, REL_WHEEL_HI_RES, steps * 120), (EV_REL, REL_WHEEL, steps)])
    }

    /// Press and release one named key.
    pub fn key(&mut self, code: u16) -> io::Result<()> {
        self.sink.send(&[(EV_KEY, code, 1), (EV_SYN, SYN_REPORT, 0), (EV_KEY, code, 0)])
    }

    /// Ctrl+V on the key in the V position of the user's layout.
    pub fn paste(&mut self) -> io::Result<()> {
        self.with_ctrl(&[(EV_KEY, KEY_V, 1), (EV_SYN, SYN_REPORT, 0), (EV_KEY, KEY_V, 0)])
    }

    pub fn button(&mut self, right: bool, down: bool) -> io::Result<()> {
        let (held, code) = if right { (&mut self.right, BTN_RIGHT) } else { (&mut self.left, BTN_LEFT) };
        if *held == down {
            return Ok(());
        }
        self.sink.send(&[(EV_KEY, code, down as i32)])?;
        *held = down;
        Ok(())
    }

    /// Release only buttons this session pressed, never unrelated physical input.
    pub fn release(&mut self) -> io::Result<()> {
        let left = if self.left { self.sink.send(&[(EV_KEY, BTN_LEFT, 0)]) } else { Ok(()) };
        self.left = false;
        let right = if self.right { self.sink.send(&[(EV_KEY, BTN_RIGHT, 0)]) } else { Ok(()) };
        self.right = false;
        left.and(right)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Record(Vec<Vec<(u16, u16, i32)>>);
    impl Sink for &mut Record {
        fn send(&mut self, events: &[(u16, u16, i32)]) -> io::Result<()> {
            self.0.push(events.to_vec());
            Ok(())
        }
    }

    #[test]
    fn setup_struct_matches_the_kernel_abi() {
        assert_eq!(std::mem::size_of::<UinputSetup>(), 92);
        assert_eq!(UI_SET_EVBIT, 0x4004_5564);
        assert_eq!(UI_DEV_SETUP, 0x405c_5503);
        assert_eq!(UI_DEV_CREATE, 0x5501);
        assert_eq!(std::mem::size_of::<libc::input_event>(), 24);
    }

    #[test]
    fn buttons_are_tracked_and_released_once() {
        let mut record = Record::default();
        let mut pointer = Pointer::new(&mut record);
        pointer.button(false, true).unwrap();
        pointer.button(false, true).unwrap();
        pointer.release().unwrap();
        pointer.release().unwrap();
        assert_eq!(record.0, vec![vec![(EV_KEY, BTN_LEFT, 1)], vec![(EV_KEY, BTN_LEFT, 0)]]);
    }

    #[test]
    fn release_leaves_unpressed_buttons_alone() {
        let mut record = Record::default();
        let mut pointer = Pointer::new(&mut record);
        pointer.button(true, true).unwrap();
        pointer.release().unwrap();
        assert_eq!(record.0, vec![vec![(EV_KEY, BTN_RIGHT, 1)], vec![(EV_KEY, BTN_RIGHT, 0)]]);
    }

    #[test]
    fn zoom_holds_ctrl_around_the_wheel_and_waits_for_buttons() {
        let mut record = Record::default();
        let mut pointer = Pointer::new(&mut record);
        pointer.zoom(-2).unwrap();
        pointer.button(false, true).unwrap();
        pointer.zoom(3).unwrap();
        assert_eq!(record.0, vec![
            vec![(EV_KEY, KEY_LEFTCTRL, 1)],
            vec![(EV_REL, REL_WHEEL_HI_RES, -240), (EV_REL, REL_WHEEL, -2)],
            vec![(EV_KEY, KEY_LEFTCTRL, 0)],
            vec![(EV_KEY, BTN_LEFT, 1)],
        ], "Ctrl, wheel and release are separate writes; zoom while dragging is ignored");
    }

    #[test]
    fn zoom_releases_ctrl_when_the_wheel_fails() {
        struct FailWheel(Vec<Vec<(u16, u16, i32)>>);
        impl Sink for &mut FailWheel {
            fn send(&mut self, events: &[(u16, u16, i32)]) -> io::Result<()> {
                self.0.push(events.to_vec());
                if events[0].0 == EV_REL { Err(io::Error::other("rejected")) } else { Ok(()) }
            }
        }
        let mut record = FailWheel(Vec::new());
        assert!(Pointer::new(&mut record).zoom(1).is_err());
        assert_eq!(record.0.last(), Some(&vec![(EV_KEY, KEY_LEFTCTRL, 0)]));
    }

    #[test]
    fn keys_press_and_release_and_paste_holds_ctrl() {
        let mut record = Record::default();
        let mut pointer = Pointer::new(&mut record);
        pointer.key(KEY_BACKSPACE).unwrap();
        pointer.paste().unwrap();
        assert_eq!(record.0, vec![
            vec![(EV_KEY, KEY_BACKSPACE, 1), (EV_SYN, SYN_REPORT, 0), (EV_KEY, KEY_BACKSPACE, 0)],
            vec![(EV_KEY, KEY_LEFTCTRL, 1)],
            vec![(EV_KEY, KEY_V, 1), (EV_SYN, SYN_REPORT, 0), (EV_KEY, KEY_V, 0)],
            vec![(EV_KEY, KEY_LEFTCTRL, 0)],
        ]);
    }

    #[test]
    fn scroll_accumulates_whole_notches() {
        let mut record = Record::default();
        let mut pointer = Pointer::new(&mut record);
        pointer.scroll(0, 80).unwrap();
        pointer.scroll(0, 80).unwrap();
        pointer.scroll(-130, 0).unwrap();
        pointer.scroll(0, 0).unwrap();
        assert_eq!(record.0, vec![
            vec![(EV_REL, REL_WHEEL_HI_RES, 80)],
            vec![(EV_REL, REL_WHEEL_HI_RES, 80), (EV_REL, REL_WHEEL, 1)],
            vec![(EV_REL, REL_HWHEEL_HI_RES, -130), (EV_REL, REL_HWHEEL, -1)],
        ]);
    }

    #[test]
    fn movement_is_relative() {
        let mut record = Record::default();
        let mut pointer = Pointer::new(&mut record);
        pointer.movement(15, -7).unwrap();
        pointer.movement(0, 0).unwrap();
        assert_eq!(record.0, vec![vec![(EV_REL, REL_X, 15), (EV_REL, REL_Y, -7)]]);
    }
}
