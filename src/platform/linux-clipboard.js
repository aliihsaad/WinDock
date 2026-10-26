/**
 * Linux has no system clipboard history, so read whichever history manager
 * this user already runs. Managers are found by their running processes, never
 * by distro or desktop, and none is started, configured or written to. With no
 * manager, only the current clipboard is offered. Text only, newest first.
 */

import { open, readdir, readFile as readProcFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { posix } from "node:path";

const LIMIT = 20;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_OUTPUT = 2 * 1024 * 1024;

const unavailable = message => Object.assign(new Error(message), { status: 503 });
const NO_TOOL = "PC clipboard history needs a clipboard manager such as cliphist, CopyQ or Klipper, or wl-paste or xclip to read the current clipboard.";
const TOO_SLOW = "The PC clipboard took too long to answer. Try again.";

const base = arg => String(arg).split("/").pop();
const present = text => typeof text === "string" && text.trim().length > 0;

/** This user's processes. Command lines stay in memory for matching only. */
export async function listUserProcesses() {
  const uid = process.getuid?.();
  const pids = (await readdir("/proc")).filter(name => /^\d+$/.test(name));
  const found = await Promise.all(pids.map(async pid => {
    try {
      if (uid !== undefined && (await stat(`/proc/${pid}`)).uid !== uid) return null;
      const [comm, cmdline] = await Promise.all([readProcFile(`/proc/${pid}/comm`, "utf8"), readProcFile(`/proc/${pid}/cmdline`, "utf8")]);
      return { pid: Number(pid), comm: comm.trim(), argv: cmdline.split("\0").filter(Boolean) };
    } catch { return null; } // exited while listing
  }));
  return found.filter(Boolean);
}

/** A regular file of at most `limit` bytes. */
export async function readTextFile(path, limit) {
  const file = await open(path, "r");
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) throw new Error("Unsupported history file");
    return await file.readFile("utf8");
  } finally { await file.close(); }
}

/** The value of `--name value` or `--name=value` in a watcher's arguments. */
function flag(args, ...names) {
  for (const [index, arg] of args.entries()) {
    for (const name of names) {
      if (arg === name) return args[index + 1];
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
}

/** A `wl-paste --watch <tool> … store` recorder, with the tool's own arguments. */
function storeWatcher(processes, tool, skip = () => false) {
  for (const { argv } of processes) {
    const at = argv.findIndex(arg => base(arg) === tool);
    const own = at < 0 ? [] : argv.slice(at + 1);
    if (own.includes("store") && !skip(own)) return own;
  }
}

/** Elephant's NDJSON: full text is in `preview`; `text` is truncated. */
export function elephantTexts(output) {
  const texts = [];
  let responseSeen = false;
  for (const line of String(output).split(/\r?\n/).filter(line => line.trim())) {
    const response = JSON.parse(line);
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("Invalid history");
    responseSeen = true;
    // Never execute command previews or read file/image paths returned by a provider.
    const item = response.item;
    if (item?.provider === "clipboard" && item.preview_type === "text" && typeof item.preview === "string") texts.push(item.preview);
  }
  if (!responseSeen) throw new Error("No clipboard response");
  return texts;
}

function stringList(value) {
  if (!Array.isArray(value) || !value.every(entry => typeof entry === "string")) throw new Error("Invalid history");
  return value;
}

/** Omarchy 4's shell plugin keeps text and image entries, newest first. */
function omarchyTexts(raw) {
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error("Invalid history");
  return entries.map(entry => typeof entry === "string" ? entry
    : entry && typeof entry === "object" && (entry.type ?? entry.kind) === "text" && typeof entry.text === "string" ? entry.text : null);
}

const COPYQ_SCRIPT = "var n = Math.min(size(), 20), out = []; for (var i = 0; i < n; ++i) out.push(str(read('text/plain', i))); print(JSON.stringify(out));";

/** In priority order. `find` returns what `read` needs, or nothing when the manager is not running. */
const MANAGERS = [
  {
    // omarchy.clipboard records with `wl-paste --watch …/shell/plugins/clipboard/capture.sh`.
    find: processes => processes.some(({ argv }) => base(argv[0] ?? "") === "wl-paste" && argv.some(arg => arg.endsWith("/shell/plugins/clipboard/capture.sh"))),
    read: async ctx => omarchyTexts(await ctx.readFile(posix.join(ctx.home, ".local/state/omarchy/clipboard-history.json"), MAX_FILE)),
  },
  {
    find: processes => processes.some(({ comm }) => comm === "elephant"),
    read: async ctx => elephantTexts(await ctx.run("elephant", ["query", "--json", `clipboard;;${LIMIT}`])),
  },
  {
    find: processes => storeWatcher(processes, "cliphist"),
    async read(ctx, own) {
      // The watcher's own database, if it names one; cliphist's default otherwise.
      const at = own.findIndex(arg => /^--?db-path(=|$)/.test(arg));
      const global = at < 0 ? [] : own[at].includes("=") ? [own[at]] : own.slice(at, at + 2);
      const rows = (await ctx.run("cliphist", [...global, "list"])).split("\n")
        .map(line => line.match(/^(\d+)\t(.*)$/)).filter(Boolean)
        .filter(([, , preview]) => !preview.startsWith("[[ binary data"));
      const texts = [];
      // Previews are truncated and flattened; decode recovers the exact text.
      for (const [, id] of rows.slice(0, LIMIT)) {
        try { texts.push(await ctx.run("cliphist", [...global, "decode"], `${id}\t`)); }
        catch (error) { if (ctx.expired()) throw error; }
      }
      return texts;
    },
  },
  {
    // `-P` stores the primary selection, which is not the clipboard.
    find: processes => storeWatcher(processes, "clipman", own => own.includes("-P") || own.includes("--primary")),
    async read(ctx, own) {
      const path = (flag(own, "--histpath") ?? "~/.local/share/clipman.json").replace(/^~(?=\/)/, ctx.home);
      return stringList(JSON.parse(await ctx.readFile(path, MAX_FILE))).toReversed();
    },
  },
  {
    // Checked first: the copyq client would otherwise talk to, or wait on, a server.
    find: processes => processes.some(({ comm }) => comm === "copyq"),
    read: async ctx => stringList(JSON.parse(await ctx.run("copyq", ["eval", COPYQ_SCRIPT]))),
  },
  {
    // Plasma 6 runs Klipper inside plasmashell; Plasma 5 as its own process.
    find: processes => processes.some(({ comm }) => comm === "klipper" || comm === "plasmashell"),
    async read(ctx) {
      const reply = JSON.parse(await ctx.run("busctl", ["--user", "--json=short", "--auto-start=no", "call", "org.kde.klipper", "/klipper", "org.kde.klipper.klipper", "getClipboardHistoryMenu"]));
      if (reply?.type !== "as" || !Array.isArray(reply.data)) throw new Error("Invalid history");
      // Images are listed as "▨ <width>x<height> <depth>bpp".
      return stringList(reply.data[0]).filter(text => !text.startsWith("▨ "));
    },
  },
];

const TEXT_TYPE = type => /^text\//.test(type) || ["UTF8_STRING", "STRING", "TEXT"].includes(type);
const SENSITIVE = "x-kde-passwordManagerHint";

/** The current clipboard alone, for PCs without a history manager. */
async function currentClipboard(ctx) {
  const sources = [];
  if (ctx.env.WAYLAND_DISPLAY) sources.push(["wl-paste", ["--list-types"], ["--no-newline", "--type", "text"]]);
  if (ctx.env.DISPLAY) sources.push(["xclip", ["-selection", "clipboard", "-o", "-t", "TARGETS"], ["-selection", "clipboard", "-o", "-t", "UTF8_STRING"]], ["xsel", null, ["--clipboard", "--output"]]);
  for (const [file, list, get] of sources) {
    try {
      if (list) {
        const types = (await ctx.run(file, list)).split(/\r?\n/).map(type => type.trim());
        if (types.includes(SENSITIVE) || !types.some(TEXT_TYPE)) return [];
      }
      return [await ctx.run(file, get)];
    } catch (error) {
      if (ctx.expired()) throw error;
      if (error?.code !== "ENOENT") return []; // nothing copied, or no text
    }
  }
  throw unavailable(NO_TOOL);
}

/**
 * Raw `{ status, items }` for normalizeHistory: "ready" from a manager, or
 * "current-only" from the clipboard itself. Errors carry only fixed messages.
 */
export async function readLinuxHistory({ execFile, processes = listUserProcesses, readFile = readTextFile, env = process.env, timeout }) {
  const deadline = Date.now() + timeout;
  const ctx = {
    env, readFile, home: env.HOME || homedir(),
    expired: () => Date.now() >= deadline,
    run(file, args, input = "") {
      const left = deadline - Date.now();
      if (left <= 0) return Promise.reject(unavailable(TOO_SLOW));
      return new Promise((resolve, reject) => {
        const child = execFile(file, args, { shell: false, encoding: "utf8", timeout: left, maxBuffer: MAX_OUTPUT, windowsHide: true }, (error, stdout) => {
          // Process errors may embed clipboard stdout/stderr. Keep only the code.
          if (error) reject(Object.assign(new Error("Clipboard command failed"), { code: error.code }));
          else resolve(String(stdout));
        });
        // A command that exits without reading stdin must not crash the host.
        child?.stdin?.on("error", () => {});
        child?.stdin?.end(input || undefined);
      });
    },
  };
  let running = [];
  try { running = await processes(); } catch { /* no /proc: only the current clipboard */ }
  for (const manager of MANAGERS) {
    const found = manager.find(running);
    if (!found) continue;
    try {
      return { status: "ready", items: (await manager.read(ctx, found)).filter(present).map(text => ({ text })) };
    } catch {
      if (ctx.expired()) break; // run() starts nothing more; report the deadline below
    }
  }
  try {
    return { status: "current-only", items: (await currentClipboard(ctx)).filter(present).map(text => ({ text })) };
  } catch (error) {
    throw ctx.expired() ? unavailable(TOO_SLOW) : error;
  }
}
