/**
 * Provider selection and the single real `exec`.
 *
 * `execFile` is used with an argv array and `shell: false` (the default).
 * Nothing in WinDock ever builds a command string, so a malicious app name or
 * path cannot introduce a second command.
 */

import { execFile } from "node:child_process";
import { platform } from "node:os";
import { contractViolations } from "./contract.js";
import { createWindowsProvider } from "./windows.js";
import { createLinuxProvider } from "./linux.js";

/** Default ceiling on child output; inventory on a large Start Menu is chatty. */
export const EXEC_MAX_BUFFER = 8 * 1024 * 1024;
export const EXEC_TIMEOUT_MS = 20_000;

export function createExec({ timeout = EXEC_TIMEOUT_MS, maxBuffer = EXEC_MAX_BUFFER } = {}) {
  return function exec(file, args = []) {
    if (typeof file !== "string" || !file) {
      return Promise.reject(new Error("exec requires a file"));
    }
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
      return Promise.reject(new Error("exec requires string arguments"));
    }
    return new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        { timeout, maxBuffer, windowsHide: true, shell: false },
        (err, stdout, stderr) => {
          if (err) {
            err.stdout = String(stdout ?? "");
            err.stderr = String(stderr ?? "");
            reject(err);
            return;
          }
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        },
      );
    });
  };
}

export const PROVIDERS = Object.freeze({
  win32: createWindowsProvider,
  linux: createLinuxProvider,
});

/**
 * Build the provider for a platform. Throws on an unsupported platform or a
 * provider that does not satisfy the contract, so a broken provider fails at
 * boot rather than on the first tap from a phone.
 */
export function createProvider({ os = platform(), exec = createExec(), ...rest } = {}) {
  const factory = PROVIDERS[os];
  if (!factory) {
    const supported = Object.keys(PROVIDERS).join(", ");
    throw new Error(`unsupported platform: ${os} (supported: ${supported})`);
  }
  const provider = factory({ exec, ...rest });
  const problems = contractViolations(provider);
  if (problems.length) {
    throw new Error(`provider ${os} violates contract: ${problems.join("; ")}`);
  }
  return provider;
}
