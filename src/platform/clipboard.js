import { execFile as runFile } from "node:child_process";

export const MAX_CLIPBOARD_TEXT = 32768;
const MAX_ITEMS = 20, MAX_TOTAL = 131072;
const validText = text => typeof text === "string" && text.length > 0 && text.length <= MAX_CLIPBOARD_TEXT && text.isWellFormed() && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);

/** Read existing OS history only on request. Never persist it or activate an item. */
export function createClipboardHistory({ platform, helperPath, execFile = runFile, timeout = 4000 } = {}) {
  let busy = false;
  return {
    async history() {
      if (busy) throw Object.assign(new Error("Clipboard is loading. Try again shortly."), { status: 429 });
      busy = true;
      try {
        const file = platform === "windows" ? helperPath : "elephant";
        const args = platform === "windows" ? ["clipboard-history"] : ["query", "--json", "clipboard;;20"];
        const output = await new Promise((resolve, reject) => {
          execFile(file, args, { windowsHide: true, shell: false, encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
            // Process errors may embed clipboard stdout/stderr. Never forward them.
            if (error) reject(Object.assign(new Error(platform === "linux"
              ? "PC clipboard history needs a running Elephant clipboard manager with JSON query support."
              : "Windows clipboard history could not be read. Try again on the PC."), { status: 503 }));
            else resolve(stdout);
          });
        });
        return platform === "windows" ? normalizeHistory(JSON.parse(output)) : parseElephantHistory(output);
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
  return { status: ["disabled", "unavailable"].includes(value.status) ? value.status : "ready", items, skipped };
}

export function parseElephantHistory(output) {
  const items = [];
  let responseSeen = false;
  for (const line of String(output).split(/\r?\n/).filter(line => line.trim())) {
    const response = JSON.parse(line);
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("Invalid history");
    responseSeen = true;
    for (const item of response.item ? [response.item] : []) {
      // Preview holds the full text; `text` is truncated by Elephant. Never
      // execute command previews or read file/image paths returned by a provider.
      if (item.provider === "clipboard" && item.preview_type === "text" && typeof item.preview === "string") items.push({ text: item.preview });
    }
  }
  if (!responseSeen) throw new Error("No clipboard response");
  return normalizeHistory({ items });
}
