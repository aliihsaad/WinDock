/** User-facing pairing errors shared by the browser and its regression tests. */
export function pairingError(detail = {}) {
  if (detail.error === "locked" || detail.locked) {
    const seconds = Math.max(1, Math.ceil((Number(detail.retryInMs) || 1000) / 1000));
    const count = seconds >= 60 ? Math.ceil(seconds / 60) : seconds;
    const unit = seconds >= 60 ? "minute" : "second";
    const wait = count + " " + unit + (count === 1 ? "" : "s");
    return detail.global
      ? "Pairing is paused for all devices. Try again in " + wait + ", or choose “Allow pairing now” in WinDock on your PC."
      : "Too many attempts from this device. Try again in " + wait + ".";
  }
  const messages = {
    "wrong pin": "That PIN doesn’t match. Try the PIN shown on your PC.",
    "invalid pin": "Enter all six digits.",
    "internal error": "Your PC couldn’t complete that action. Check the app or device and try again.",
  };
  return messages[detail.error] || detail.error || "The request couldn’t be completed.";
}
