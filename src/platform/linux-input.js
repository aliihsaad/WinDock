/**
 * Linux touchpad, phone keyboard and signatures through `windock-input`
 * (native/linux), which speaks the Windows helper's JSON protocol: a uinput
 * pointer, wtype for text, AT-SPI focus tokens, and wl-copy for pasting.
 */

import { spawn as spawnProcess } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHelperInput } from "./input.js";
import { userDir } from "./xdg.js";

export const INPUT_HELPER = process.env.WINDOCK_INPUT_HELPER || fileURLToPath(new URL("../../windock-input", import.meta.url));

/** Signatures go next to captures; the folder is never chosen by the phone. */
export async function signatureDir(options) {
  return join(await userDir("PICTURES", options), "WinDock", "Signatures");
}

export function createLinuxInput({
  helperPath = INPUT_HELPER,
  spawn = spawnProcess,
  startupMs,
  stopMs,
  signatures = signatureDir,
  log = (line) => console.error(`windock-input: ${line}`),
} = {}) {
  return createHelperInput({
    helperPath, spawn, startupMs, stopMs,
    signatureArgs: async (insert) => [insert ? "signature-insert" : "signature", await signatures()],
    unavailableMessage: "The PC could not save the signature. Check Pictures / WinDock / Signatures and try again.",
    diagnostic: log,
    missingHint: "Build it with: npm run build:linux",
    // The helper logs the exact cause (udev rule, uinput module, unbuilt helper) on the PC.
    startupError: "Your PC could not start the touchpad. WinDock's output on the PC shows why.",
  });
}
