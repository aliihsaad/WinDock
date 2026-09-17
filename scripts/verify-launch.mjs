/** G4: launch and focus build exact argv that never reaches a shell. */
import { createChecker } from "./lib/assert.mjs";
import { createWindowsProvider } from "../src/platform/windows.js";
import { createLinuxProvider, splitExec, parseDesktop } from "../src/platform/linux.js";

const t = createChecker("launch");
const HELPER = "C:\\Tools\\WinDockHelper.exe";

function recorder(stdout = "") {
  const calls = [];
  return {
    calls,
    exec: async (file, args) => {
      calls.push({ file, args });
      return { stdout };
    },
  };
}

// ---- Windows launch / focus / close ----
let rec = recorder();
let win = createWindowsProvider({ exec: rec.exec, helperPath: HELPER });

await win.launchApp({ target: "C:\\Program Files\\App\\App.exe" });
t.equal(rec.calls.length, 1, "launch issues exactly one exec");
t.equal(rec.calls[0].file, HELPER, "launch dispatches to the helper binary");
t.deepEqual(
  rec.calls[0].args,
  ["launch", "C:\\Program Files\\App\\App.exe"],
  "launch argv is [verb, target] with the path as one argument",
);

await win.focusApp({ pid: 4812 });
t.deepEqual(rec.calls[1].args, ["focus", "4812"], "focus argv is [verb, pid]");
await win.closeApp({ pid: 1200 });
t.deepEqual(rec.calls[2].args, ["close", "1200"], "close argv is [verb, pid]");

// The decisive property: a hostile path must remain ONE argv entry. If any
// code path joined argv into a string, this target would become a second
// command. Assert both the count and the exact element.
const HOSTILE = 'C:\\tmp\\a b" & shutdown /s /t 0 & echo "pwned.exe';
rec = recorder();
win = createWindowsProvider({ exec: rec.exec, helperPath: HELPER });
await win.launchApp({ target: HOSTILE });
t.equal(rec.calls[0].args.length, 2, "hostile path does not expand into extra argv entries");
t.equal(rec.calls[0].args[1], HOSTILE, "hostile path is passed through verbatim as one argument");
t.ok(
  !rec.calls[0].args.some((a) => a === "shutdown" || a === "/s"),
  "no fragment of the hostile path becomes its own argument",
);

// Negative control: prove the assertion above can fail. A deliberately unsafe
// joiner must be caught by the same check, otherwise the check proves nothing.
const unsafeArgv = ["launch", ...HOSTILE.split(" ")];
t.ok(unsafeArgv.length > 2, "negative control: a shell-splitting launcher produces extra argv entries");

// Bad input must reject before any exec happens.
rec = recorder();
win = createWindowsProvider({ exec: rec.exec, helperPath: HELPER });
for (const bad of [{}, { target: "" }, { target: "   " }, { target: null }, null]) {
  await t.rejects(() => win.launchApp(bad), `launch rejects invalid target ${JSON.stringify(bad)}`);
}
for (const bad of [{ pid: 0 }, { pid: -1 }, { pid: 1.5 }, { pid: "4812; rm -rf /" }, {}]) {
  await t.rejects(() => win.focusApp(bad), `focus rejects invalid pid ${JSON.stringify(bad)}`);
  await t.rejects(() => win.closeApp(bad), `close rejects invalid pid ${JSON.stringify(bad)}`);
}
t.equal(rec.calls.length, 0, "no exec is issued for any rejected input");

// ---- Linux provider argv ----
const lrec = recorder();
const lin = createLinuxProvider({ exec: lrec.exec });
await lin.launchApp({ target: "/usr/bin/firefox", argv: ["/usr/bin/firefox", "--new-window"] });
t.equal(lrec.calls[0].file, "/usr/bin/firefox", "linux launch execs the binary directly");
t.deepEqual(lrec.calls[0].args, ["--new-window"], "linux launch passes remaining argv");

t.deepEqual(splitExec("/usr/bin/app %U"), ["/usr/bin/app"], "field codes are stripped from Exec");
t.deepEqual(
  splitExec('"/opt/my app/run" --flag "a b"'),
  ["/opt/my app/run", "--flag", "a b"],
  "quoted Exec segments stay single arguments",
);
t.deepEqual(splitExec(""), [], "empty Exec yields no argv");

const entry = parseDesktop("[Desktop Entry]\nType=Application\nName=Demo\nExec=/usr/bin/demo %F\n", "demo");
t.equal(entry.name, "Demo", "desktop entry name is parsed");
t.equal(entry.target, "/usr/bin/demo", "desktop entry target is parsed");
t.equal(parseDesktop("[Desktop Entry]\nType=Application\nName=H\nExec=/x\nNoDisplay=true\n", "h"), null,
  "NoDisplay entries are skipped");
t.equal(parseDesktop("[Desktop Entry]\nType=Link\nName=L\nURL=x\n", "l"), null, "non-Application types are skipped");
t.equal(parseDesktop("[Desktop Entry]\nType=Application\nName=NoExec\n", "n"), null, "entries without Exec are skipped");

t.done("launch verification passed");
