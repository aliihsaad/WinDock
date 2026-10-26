import { EventEmitter } from "node:events";
import { createChecker } from "./lib/assert.mjs";
import { createClipboardHistory } from "../src/platform/clipboard.js";
import { listUserProcesses } from "../src/platform/linux-clipboard.js";

const t = createChecker("linux-clipboard");
const HOME = "/home/tester";
const wayland = { HOME, WAYLAND_DISPLAY: "wayland-1" };
const calls = [];

/**
 * A fake execFile that answers each command through `handler`, or ENOENT.
 * With `epipe`, stdin fails as it does when a command exits without reading it.
 */
function fakeExec(handler, { epipe = false } = {}) {
  const mine = [];
  const execFile = (file, args, options, done) => {
    const call = { file, args, options, input: "" };
    calls.push(call); mine.push(call);
    // The real child reads stdin after execFile returns; so does this one.
    setImmediate(async () => {
      const out = await handler(call);
      if (out instanceof Error) done(out, out.stdout ?? "");
      else if (out === undefined) done(fail("ENOENT"), "");
      else done(null, out);
    });
    const stdin = new EventEmitter();
    stdin.end = (data = "") => {
      call.input += data;
      // An 'error' event with no listener throws, failing this oracle.
      if (epipe) setImmediate(() => stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })));
    };
    return { stdin };
  };
  return { execFile, calls: mine };
}
const fail = (code, stdout = "") => Object.assign(new Error("secret clipboard text"), { code, stdout });
const command = call => [call.file, ...call.args].join(" ");
const proc = (comm, ...argv) => ({ pid: 1000, comm, argv: argv.length ? argv : [comm] });
const noFile = async () => { throw fail("ENOENT"); };
const history = options => createClipboardHistory({ platform: "linux", env: wayland, processes: async () => [], readFile: noFile, ...options }).history();
const texts = result => result.items.map(item => item.text);

const omarchyWatcher = proc("wl-paste", "wl-paste", "--type", "text", "--watch", "/usr/share/omarchy/shell/plugins/clipboard/capture.sh", "text");
const omarchyFile = JSON.stringify(["legacy string", { type: "text", text: "multi\nline 🙂" },
  { type: "image", mime: "image/png", path: "/home/tester/.local/state/omarchy/clipboard-images/x.png" },
  { kind: "text", text: "kind field" }, { type: "text", text: "   " }]);
{
  const reads = [];
  const { execFile, calls: run } = fakeExec(() => undefined);
  const result = await history({ execFile, processes: async () => [omarchyWatcher], readFile: async (path, limit) => { reads.push({ path, limit }); return omarchyFile; } });
  t.equal(result.status, "ready", "Omarchy 4 history is a full history");
  t.deepEqual(texts(result), ["legacy string", "multi\nline 🙂", "kind field"], "Omarchy 4 history keeps text newest first and drops images and blank entries");
  t.deepEqual(reads.map(read => read.path), [`${HOME}/.local/state/omarchy/clipboard-history.json`], "only Omarchy's own history file is read");
  t.ok(reads[0].limit > 0 && reads[0].limit <= 16 * 1024 * 1024, "the history file size is bounded");
  t.equal(run.length, 0, "reading Omarchy's history runs no command");
}
{
  const reads = [];
  const { execFile } = fakeExec(call => command(call) === "wl-paste --list-types" ? "text/plain\n" : command(call) === "wl-paste --no-newline --type text" ? "now" : undefined);
  const result = await history({ execFile, readFile: async path => { reads.push(path); return omarchyFile; } });
  t.equal(reads.length, 0, "a history file is not read while its recorder is not running");
  t.equal(result.status, "current-only", "a stale history file falls back to the current clipboard");
}

{
  const ndjson = JSON.stringify({ qid: 1, item: { provider: "clipboard", preview_type: "text", text: "trunc", preview: "elephant text" } });
  const { execFile, calls: run } = fakeExec(call => call.file === "elephant" ? ndjson : undefined);
  const result = await history({ execFile, processes: async () => [proc("elephant", "elephant")] });
  t.deepEqual(texts(result), ["elephant text"], "a running Elephant is still read");
  t.deepEqual(run[0].args, ["query", "--json", "clipboard;;20"], "Elephant gets only the fixed clipboard query");
}

{
  const watcher = proc("wl-paste", "wl-paste", "--type", "text", "--watch", "cliphist", "-db-path", "/tmp/clip.db", "store");
  const full = { "9": "full text of nine, which is longer than its preview", "7": "seven\n  keeps whitespace  ", "5": "five" };
  const { execFile, calls: run } = fakeExec(call => {
    if (command(call) === "cliphist -db-path /tmp/clip.db list") return "9\tfull text of nine…\n8\t[[ binary data 4 KiB png 10x10 ]]\n7\tseven keeps whitespace\n6\tbroken\n5\tfive\n";
    if (command(call) === "cliphist -db-path /tmp/clip.db decode") return full[call.input.split("\t")[0]] ?? fail(1);
  });
  const result = await history({ execFile, processes: async () => [watcher] });
  t.deepEqual(texts(result), [full[9], full[7], full[5]], "cliphist entries are decoded to their full text, newest first");
  const decodes = run.filter(call => call.args.includes("decode"));
  t.deepEqual(decodes.map(call => call.input), ["9\t", "7\t", "6\t", "5\t"], "cliphist ids go over stdin, binary entries are never decoded");
  t.ok(decodes.every(call => call.args.join(" ") === "-db-path /tmp/clip.db decode"), "the watcher's database is read, not a default one");

  const many = Array.from({ length: 40 }, (_, i) => `${40 - i}\tline ${40 - i}`).join("\n");
  const bounded = fakeExec(call => call.args.at(-1) === "list" ? many : `entry ${call.input}`);
  await history({ execFile: bounded.execFile, processes: async () => [proc("wl-paste", "wl-paste", "--watch", "cliphist", "store")] });
  t.equal(bounded.calls.filter(call => call.args.at(-1) === "decode").length, 20, "at most 20 cliphist entries are decoded");
  t.deepEqual(bounded.calls[0].args, ["list"], "a watcher without a database flag uses cliphist's own default");

  const equalsForm = fakeExec(call => call.args.at(-1) === "list" ? "" : undefined);
  await history({ execFile: equalsForm.execFile, processes: async () => [proc("wl-paste", "wl-paste", "--watch", "cliphist", "--db-path=/x/db", "store")] });
  t.deepEqual(equalsForm.calls[0].args, ["--db-path=/x/db", "list"], "a --db-path=value flag is passed through");
}

{
  const reads = [];
  const primary = proc("wl-paste", "wl-paste", "-p", "-t", "text", "--watch", "clipman", "store", "-P", "--histpath=~/primary.json");
  const clipboard = proc("wl-paste", "wl-paste", "-t", "text", "--watch", "clipman", "store", "--histpath=~/clips.json");
  const { execFile } = fakeExec(() => undefined);
  const result = await history({ execFile, processes: async () => [primary, clipboard], readFile: async path => { reads.push(path); return JSON.stringify(["oldest", "newer", "newest"]); } });
  t.deepEqual(reads, [`${HOME}/clips.json`], "clipman's clipboard history file is read, never its primary-selection one");
  t.deepEqual(texts(result), ["newest", "newer", "oldest"], "clipman history is shown newest first");
  const defaults = [];
  await history({ execFile, processes: async () => [proc("wl-paste", "wl-paste", "--watch", "clipman", "store")], readFile: async path => { defaults.push(path); return "[]"; } });
  t.deepEqual(defaults, [`${HOME}/.local/share/clipman.json`], "clipman's default history path is used");
}

{
  const { execFile, calls: run } = fakeExec(call => call.file === "copyq" ? JSON.stringify(["copyq one", "", "copyq two"]) : undefined);
  const result = await history({ execFile, processes: async () => [proc("copyq", "/usr/bin/copyq")] });
  t.deepEqual(texts(result), ["copyq one", "copyq two"], "a running CopyQ is read and empty rows are skipped");
  t.equal(run[0].args[0], "eval", "CopyQ is read with one script");
}

{
  const reply = JSON.stringify({ type: "as", data: [["first", "▨ 10x10 32bpp", "second"]] });
  const { execFile, calls: run } = fakeExec(call => call.file === "busctl" ? reply : undefined);
  const result = await history({ execFile, processes: async () => [proc("plasmashell", "/usr/bin/plasmashell")] });
  t.deepEqual(texts(result), ["first", "second"], "Klipper history skips image placeholders");
  t.ok(run[0].args.includes("--user") && run[0].args.includes("--auto-start=no"), "Klipper is asked on the session bus without starting it");
}

{
  const watcher = proc("wl-paste", "wl-paste", "--watch", "cliphist", "store");
  const { execFile, calls: run } = fakeExec(call => {
    if (call.file === "elephant") return fail(1, "secret");
    if (call.args.at(-1) === "list") return "3\tafter elephant";
    if (call.args.at(-1) === "decode") return "after elephant";
  });
  const result = await history({ execFile, processes: async () => [proc("elephant", "elephant"), watcher] });
  t.deepEqual(texts(result), ["after elephant"], "a failing manager falls through to the next running one");
  t.equal(run[0].file, "elephant", "managers are tried in their fixed order");
}

{
  const { execFile, calls: run } = fakeExec(call => {
    if (command(call) === "wl-paste --list-types") return "text/plain;charset=utf-8\nUTF8_STRING\n";
    if (command(call) === "wl-paste --no-newline --type text") return "current text";
  }, { epipe: true });
  const result = await history({ execFile });
  await new Promise(resolve => setImmediate(resolve));
  t.ok(true, "a command that never reads stdin does not crash the host");
  t.equal(result.status, "current-only", "without a manager only the current clipboard is offered");
  t.deepEqual(texts(result), ["current text"], "the current Wayland clipboard is read");
  t.ok(!run.some(call => ["copyq", "cliphist", "elephant", "busctl"].includes(call.file)), "managers that are not running are never called or started");

  const hinted = fakeExec(call => command(call) === "wl-paste --list-types" ? "text/plain\nx-kde-passwordManagerHint\n" : "password");
  t.deepEqual(texts(await history({ execFile: hinted.execFile })), [], "a password manager's clipboard is not shown");
  t.equal(hinted.calls.length, 1, "a password manager's clipboard is never read");
  const image = fakeExec(call => command(call) === "wl-paste --list-types" ? "image/png\n" : "binary");
  t.deepEqual(texts(await history({ execFile: image.execFile })), [], "an image clipboard shows no text");
  t.equal(image.calls.length, 1, "an image clipboard is never read as text");
  const empty = fakeExec(() => fail(1));
  const nothing = await history({ execFile: empty.execFile });
  t.equal(nothing.status, "current-only", "an empty clipboard is still a current-only answer");
  t.deepEqual(texts(nothing), [], "an empty clipboard shows no text");
}

{
  const x11 = { HOME, DISPLAY: ":0" };
  const { execFile } = fakeExec(call => {
    if (command(call) === "xclip -selection clipboard -o -t TARGETS") return "TARGETS\nUTF8_STRING\n";
    if (command(call) === "xclip -selection clipboard -o -t UTF8_STRING") return "x11 text";
  });
  t.deepEqual(texts(await history({ execFile, env: x11 })), ["x11 text"], "X11 uses xclip");
  const xsel = fakeExec(call => command(call) === "xsel --clipboard --output" ? "xsel text" : undefined);
  t.deepEqual(texts(await history({ execFile: xsel.execFile, env: x11 })), ["xsel text"], "X11 falls back to xsel");
  const noWlPaste = fakeExec(call => call.file === "xclip" ? (call.args.includes("TARGETS") ? "UTF8_STRING" : "xwayland text") : undefined);
  t.deepEqual(texts(await history({ execFile: noWlPaste.execFile, env: { ...wayland, DISPLAY: ":0" } })), ["xwayland text"], "a missing wl-paste falls back to X11");
}

{
  const { execFile } = fakeExec(() => undefined);
  const missing = await history({ execFile, env: { HOME } }).then(() => null, error => error);
  t.equal(missing?.status, 503, "no manager and no clipboard tool is unavailable");
  t.ok(/clipboard manager/.test(missing?.message ?? ""), "the error says what to install");
  const leaky = fakeExec(call => fail(call.file === "elephant" ? 1 : "ENOENT", "secret clipboard text"));
  const error = await history({ execFile: leaky.execFile, processes: async () => [proc("elephant", "elephant")], env: { HOME } }).then(() => null, value => value);
  t.ok(error && !error.message.includes("secret"), "errors never carry clipboard text or command output");
}

{
  const { execFile, calls: run } = fakeExec(call => call.file === "elephant" ? new Promise(resolve => setTimeout(() => resolve(fail(1)), 80)) : "late");
  const error = await history({ execFile, timeout: 40, processes: async () => [proc("elephant", "elephant")] }).then(() => null, value => value);
  t.equal(error?.status, 503, "one deadline bounds the whole read");
  t.ok(/too long/.test(error?.message ?? ""), "a slow read says so");
  t.equal(run.length, 1, "nothing else runs after the deadline");
  t.ok(run[0].options.timeout <= 40, "each command gets only the time that is left");
}

{
  let listings = 0;
  const { execFile } = fakeExec(call => command(call) === "wl-paste --list-types" ? "text/plain" : "x");
  await history({ execFile, processes: async () => { listings++; return []; } });
  t.equal(listings, 1, "one history read lists processes once");
}

t.ok(calls.length > 0 && calls.every(call => call.options.shell === false && call.options.timeout > 0 && call.options.maxBuffer <= 2 * 1024 * 1024), "every command runs without a shell, with bounded time and output");

if (process.platform === "linux") {
  const own = await listUserProcesses();
  t.ok(own.some(entry => entry.pid === process.pid && entry.argv.length > 0), "the process list finds this user's own processes");
}

t.done("linux-clipboard verification passed");
