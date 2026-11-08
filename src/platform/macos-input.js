/**
 * macOS touchpad, phone keyboard and signatures through `windock-input`
 * (native/macos), which speaks the Windows helper's JSON protocol: Quartz
 * events for the pointer and keys, Accessibility focus tokens, and the
 * pasteboard for inserting signatures.
 */

import { spawn as spawnProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHelperInput } from "./input.js";

export const INPUT_HELPER = process.env.WINDOCK_INPUT_HELPER || fileURLToPath(new URL("../../windock-input", import.meta.url));

/** Signatures go next to captures; the folder is never chosen by the phone. */
export function signatureDir(home = homedir()) {
  return join(home, "Pictures", "WinDock", "Signatures");
}

export function createMacInput({
  helperPath = INPUT_HELPER,
  spawn = spawnProcess,
  startupMs,
  stopMs,
  signatures = signatureDir,
  log = (line) => console.error(`windock-input: ${line}`),
} = {}) {
  return createHelperInput({
    helperPath, spawn, startupMs, stopMs,
    signatureArgs: (insert) => [insert ? "signature-insert" : "signature", signatures()],
    unavailableMessage: "The Mac could not save the signature. Check Pictures / WinDock / Signatures and try again.",
    diagnostic: log,
    missingHint: "Build it with: npm run build:macos",
    // The helper logs the exact cause (Accessibility permission, unbuilt helper) on the Mac.
    startupError: "Your Mac could not start the touchpad. WinDock's output on the Mac shows why.",
  });
}
