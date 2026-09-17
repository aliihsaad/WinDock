/** G2: Windows installed-app inventory parses correctly from fixtures. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChecker } from "./lib/assert.mjs";
import {
  parseInstalled,
  appIdFromTarget,
  createWindowsProvider,
  INVENTORY_PS,
  POWERSHELL,
  PS_FLAGS,
} from "../src/platform/windows.js";

const t = createChecker("inventory");
const fixtures = join(import.meta.dirname, "..", "test", "fixtures");
const read = (f) => readFileSync(join(fixtures, f), "utf8");

const apps = parseInstalled(read("installed.json"));
const names = apps.map((a) => a.name);

// Pin the exact surviving set, not just its size: a count alone would still
// pass if filtering kept the wrong three records.
t.deepEqual(names, ["Firefox", "Notepad", "Visual Studio Code"], "exactly the launchable apps survive");
t.equal(apps.length, 3, "three launchable apps survive filtering");
t.ok(!names.includes("Broken No Target"), "entry with empty target is dropped");
t.ok(!names.includes("Readme"), "non-.exe target is dropped");
t.ok(!names.some((n) => n === ""), "entry with empty name is dropped");

// Start Menu must win over the registry duplicate of the same target.
const firefox = apps.filter((a) => a.target.toLowerCase().includes("firefox.exe"));
t.equal(firefox.length, 1, "duplicate targets collapse to one app");
t.equal(firefox[0].name, "Firefox", "Start Menu name wins over registry name");
t.equal(firefox[0].source, "startmenu", "surviving record keeps the startmenu source");

t.deepEqual(
  names,
  [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })),
  "apps are sorted by display name",
);

t.equal(
  appIdFromTarget("C:\\Program Files\\App\\App.exe"),
  "c:/program files/app/app.exe",
  "app id normalizes case and separators",
);
t.equal(
  appIdFromTarget("C:\\Program Files\\App\\App.exe"),
  appIdFromTarget("c:/PROGRAM FILES/app/APP.EXE"),
  "app id is stable across case and separator style",
);

// ConvertTo-Json emits a bare object when there is exactly one result.
const solo = parseInstalled(read("single.json"));
t.equal(solo.length, 1, "single bare object parses as one app");
t.equal(solo[0].name, "Solo App", "single object keeps its name");

// Malformed input must degrade to empty, never throw.
for (const bad of ["", "   ", "not json", "null", "undefined", "[", "{}"]) {
  let threw = false;
  let out = null;
  try {
    out = parseInstalled(bad);
  } catch {
    threw = true;
  }
  t.ok(!threw, `malformed input does not throw: ${JSON.stringify(bad)}`);
  t.ok(Array.isArray(out), `malformed input yields an array: ${JSON.stringify(bad)}`);
}

// Negative control: a fixture that SHOULD produce apps must not come back empty,
// proving the assertions above are not passing merely because everything is
// being filtered out.
t.ok(parseInstalled(read("installed.json")).length > 0, "negative control: valid fixture is not empty");

// The provider must issue the constant, non-interpolated PowerShell command.
let captured = null;
const provider = createWindowsProvider({
  exec: async (file, args) => {
    captured = { file, args };
    return { stdout: read("installed.json") };
  },
});
const viaProvider = await provider.listInstalledApps();
t.equal(viaProvider.length, 3, "provider returns the parsed inventory");
t.equal(captured.file, POWERSHELL, "provider invokes powershell.exe");
t.deepEqual(captured.args, [...PS_FLAGS, INVENTORY_PS], "provider passes the constant inventory script");
t.ok(captured.args.includes("-NoProfile"), "inventory runs with -NoProfile");

t.done("inventory verification passed");
