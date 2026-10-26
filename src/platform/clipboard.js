import { execFile as runFile } from "node:child_process";
import { elephantTexts, readLinuxHistory } from "./linux-clipboard.js";

export const MAX_CLIPBOARD_TEXT = 32768;
const MAX_ITEMS = 20, MAX_TOTAL = 131072;
const validText = text => typeof text === "string" && text.length > 0 && text.length <= MAX_CLIPBOARD_TEXT && text.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);

/** Read existing OS history only on request. Never persist it or activate an item. */
export function createClipboardHistory({ platform, helperPath, execFile = runFile, timeout = 4000, processes, readFile, env } = {}) {
  let busy = false;
  return {
    async history() {
      if (busy) throw Object.assign(new Error("Clipboard is loading. Try again shortly."), { status: 429 });
      busy = true;
      try {
        if (platform === "linux") return normalizeHistory(await readLinuxHistory({ execFile, processes, readFile, env, timeout }));
        const output = await new Promise((resolve, reject) => {
          execFile(helperPath, ["clipboard-history"], { windowsHide: true, shell: false, encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
            // Process errors may embed clipboard stdout/stderr. Never forward them.
            if (error) reject(Object.assign(new Error("Windows clipboard history could not be read. Try again on the PC."), { status: 503 }));
            else resolve(stdout);
          });
        });
        return normalizeHistory(JSON.parse(output));
      } catch (error) {
        if (error.status) throw error;
        throw Object.assign(new Error("The PC returned an unsupported clipboard history response."), { status: 503 });
      } finally { busy = false; }
    },
  };
}

export function normalizeHistory(value) {
  if (!value || !Array.isArray(value.items)) throw new Error("Invalid history");
  const items = [], seen = new Set();
  let total = 0, skipped = Number.isSafeInteger(value.skipped) && value.skipped > 0 ? value.skipped : 0;
  for (const entry of value.items.slice(0, 100)) {
    if (typeof entry?.text !== "string" || !validText(entry.text) || total + entry.text.length > MAX_TOTAL) { skipped++; continue; }
    if (seen.has(entry.text)) continue;
    seen.add(entry.text); total += entry.text.length;
    items.push({ text: entry.text });
    if (items.length === MAX_ITEMS) break;
  }
  return { status: ["disabled", "unavailable", "current-only"].includes(value.status) ? value.status : "ready", items, skipped };
}

export function parseElephantHistory(output) {
  return normalizeHistory({ items: elephantTexts(output).map(text => ({ text })) });
}
