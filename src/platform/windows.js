/**
 * Windows platform provider.
 *
 * Two distinct channels, chosen deliberately:
 *
 *  - Inventory / telemetry (read-only) runs a CONSTANT PowerShell script that
 *    emits JSON. No caller input is ever interpolated into these strings, so
 *    the script text is fixed at module load and cannot be influenced.
 *
 *  - Every action (launch, focus, close, control) is dispatched to
 *    WinDockHelper.exe as an argv ARRAY. Arguments are passed as separate argv
 *    entries, never concatenated, so a path containing `& shutdown /s` is one
 *    opaque argument rather than a second command.
 *
 * The helper is where Win32 P/Invoke lives (SetForegroundWindow, SendInput for
 * media keys, ExtractIconEx, the GlobalSystemMediaTransportControls session).
 * Keeping it behind argv means this file stays pure, parseable and testable on
 * any OS, which is what the inventory and launch gates exercise.
 */

import { CONTROL_VERBS, validateControl } from "./contract.js";

/** Constant PowerShell: Start Menu shortcuts + registry uninstall entries. */
export const INVENTORY_PS = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$out=@();",
  "$roots=@(",
  "  [Environment]::GetFolderPath('CommonStartMenu'),",
  "  [Environment]::GetFolderPath('StartMenu')",
  ");",
  "$sh=New-Object -ComObject WScript.Shell;",
  "foreach($r in $roots){",
  "  if(-not $r){continue};",
  "  Get-ChildItem -LiteralPath $r -Recurse -Filter *.lnk | ForEach-Object {",
  "    $lk=$sh.CreateShortcut($_.FullName);",
  "    if($lk.TargetPath -and $lk.TargetPath.ToLower().EndsWith('.exe')){",
  "      $out+=[pscustomobject]@{",
  "        name=$_.BaseName; target=$lk.TargetPath;",
  "        args=$lk.Arguments; icon=$lk.IconLocation; source='startmenu'",
  "      }",
  "    }",
  "  }",
  "};",
  "$out | ConvertTo-Json -Compress -Depth 3",
].join(" ");

/** Constant PowerShell: processes owning a top-level window. */
export const RUNNING_PS = [
  "$ErrorActionPreference='SilentlyContinue';",
  "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |",
  "  Select-Object Id,ProcessName,MainWindowTitle,",
  "    @{n='Handle';e={[int64]$_.MainWindowHandle}},",
  "    @{n='Path';e={$_.Path}} |",
  "  ConvertTo-Json -Compress -Depth 3",
].join(" ");

/** Constant PowerShell: CPU, memory and battery snapshot. */
export const STATS_PS = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$os=Get-CimInstance Win32_OperatingSystem;",
  "$cpu=(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average;",
  "$bat=Get-CimInstance Win32_Battery | Select-Object -First 1;",
  "[pscustomobject]@{",
  "  cpu=$cpu;",
  "  memTotal=$os.TotalVisibleMemorySize;",
  "  memFree=$os.FreePhysicalMemory;",
  "  battery=$(if($bat){$bat.EstimatedChargeRemaining}else{$null});",
  "  charging=$(if($bat){$bat.BatteryStatus -eq 2}else{$null})",
  "} | ConvertTo-Json -Compress",
].join(" ");

export const POWERSHELL = "powershell.exe";
/** -NoProfile keeps a user profile script from altering output or timing. */
export const PS_FLAGS = Object.freeze([
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
]);

/** Control verbs the helper implements, mapped to its argv verbs. */
export const HELPER_CONTROL = Object.freeze({
  "volume-up": ["control", "volume-up"],
  "volume-down": ["control", "volume-down"],
  "volume-set": ["control", "volume-set"],
  "mute-toggle": ["control", "mute-toggle"],
  "media-play-pause": ["control", "media-play-pause"],
  "media-next": ["control", "media-next"],
  "media-previous": ["control", "media-previous"],
  "media-stop": ["control", "media-stop"],
  "brightness-set": ["control", "brightness-set"],
  lock: ["control", "lock"],
  sleep: ["control", "sleep"],
  shutdown: ["control", "shutdown"],
  restart: ["control", "restart"],
});

/** A Windows app id is stable across restarts: the lowercased target path. */
export function appIdFromTarget(target) {
  return String(target || "").trim().toLowerCase().replace(/\\/g, "/");
}

function jsonArray(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (parsed === null || parsed === undefined) return [];
  // ConvertTo-Json emits a bare object, not a 1-element array, for one result.
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Parse the inventory JSON into deduplicated app records.
 * Exported separately from the provider so the gate can drive it with fixtures.
 */
export function parseInstalled(raw) {
  const byId = new Map();
  for (const row of jsonArray(raw)) {
    const target = typeof row?.target === "string" ? row.target.trim() : "";
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    if (!target || !name) continue;
    if (!/\.exe$/i.test(target)) continue;
    const id = appIdFromTarget(target);
    // Start Menu wins over registry: it carries the user-facing display name.
    const existing = byId.get(id);
    if (existing && existing.source === "startmenu" && row.source !== "startmenu") continue;
    byId.set(id, {
      id,
      name,
      target,
      args: typeof row?.args === "string" ? row.args.trim() : "",
      icon: typeof row?.icon === "string" ? row.icon.trim() : "",
      source: row?.source === "registry" ? "registry" : "startmenu",
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
  );
}

/**
 * Parse running-window JSON into stable identities.
 * A process is only a dock-visible app when it owns a top-level window.
 */
export function parseRunning(raw) {
  const out = [];
  const seen = new Set();
  for (const row of jsonArray(raw)) {
    const pid = Number(row?.Id);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const handle = Number(row?.Handle);
    if (!Number.isInteger(handle) || handle === 0) continue;
    const path = typeof row?.Path === "string" ? row.Path.trim() : "";
    const procName = typeof row?.ProcessName === "string" ? row.ProcessName.trim() : "";
    if (!path && !procName) continue;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push({
      id: path ? appIdFromTarget(path) : `proc:${procName.toLowerCase()}`,
      name: procName,
      title: typeof row?.MainWindowTitle === "string" ? row.MainWindowTitle.trim() : "",
      pid,
      handle,
      path,
    });
  }
  return out.sort((a, b) => a.pid - b.pid);
}

/** Parse the stats snapshot into normalized percentages. */
export function parseStats(raw) {
  const [row] = jsonArray(raw);
  if (!row) return { cpu: null, memory: null, battery: null, charging: null };
  const total = Number(row.memTotal);
  const free = Number(row.memFree);
  const memory =
    Number.isFinite(total) && Number.isFinite(free) && total > 0
      ? Math.round(((total - free) / total) * 100)
      : null;
  const cpu = Number.isFinite(Number(row.cpu)) ? Math.round(Number(row.cpu)) : null;
  const battery = Number.isFinite(Number(row.battery)) ? Math.round(Number(row.battery)) : null;
  return {
    cpu,
    memory,
    battery,
    charging: typeof row.charging === "boolean" ? row.charging : null,
  };
}

/**
 * Build the argv for a control action. Returned as an array so the caller can
 * assert it exactly; numeric values are stringified only at the boundary and
 * only after `validateControl` has proven they are integers in range.
 */
export function controlArgv(verb, value) {
  const checked = validateControl(verb, value);
  if (!checked.ok) throw new Error(checked.error);
  const base = HELPER_CONTROL[checked.verb];
  if (!base) throw new Error(`unmapped control verb: ${checked.verb}`);
  return checked.value === null ? [...base] : [...base, String(checked.value)];
}

/** Verbs declared by the contract but not mapped here (must stay empty). */
export function unmappedVerbs() {
  return CONTROL_VERBS.filter((v) => !HELPER_CONTROL[v]);
}

/**
 * Create the Windows provider.
 * @param {object} opts
 * @param {(file:string,args:string[])=>Promise<{stdout:string}>} opts.exec
 * @param {string} [opts.helperPath] path to WinDockHelper.exe
 */
export function createWindowsProvider({ exec, helperPath = "WinDockHelper.exe" } = {}) {
  if (typeof exec !== "function") throw new Error("windows provider requires exec");

  const ps = (script) => exec(POWERSHELL, [...PS_FLAGS, script]);
  const helper = (args) => exec(helperPath, args);

  return {
    id: "windows",
    displayName: "Windows",

    async listInstalledApps() {
      const { stdout } = await ps(INVENTORY_PS);
      return parseInstalled(stdout);
    },

    async listRunningApps() {
      const { stdout } = await ps(RUNNING_PS);
      return parseRunning(stdout);
    },

    async launchApp(app) {
      const target = typeof app === "string" ? app : app?.target;
      if (typeof target !== "string" || !target.trim()) {
        throw new Error("launchApp requires a target path");
      }
      // argv array: the target is one argument even if it contains spaces,
      // quotes, ampersands or newlines.
      await helper(["launch", target]);
    },

    async focusApp(running) {
      const pid = Number(running?.pid);
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error("focusApp requires a positive integer pid");
      }
      await helper(["focus", String(pid)]);
    },

    async closeApp(running) {
      const pid = Number(running?.pid);
      if (!Number.isInteger(pid) || pid <= 0) {
        throw new Error("closeApp requires a positive integer pid");
      }
      await helper(["close", String(pid)]);
    },

    async control(verb, value) {
      await helper(controlArgv(verb, value));
      return { ok: true, verb };
    },

    async nowPlaying() {
      const { stdout } = await helper(["nowplaying"]);
      const [row] = jsonArray(stdout);
      if (!row) return null;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      if (!title) return null;
      return {
        title,
        artist: typeof row.artist === "string" ? row.artist.trim() : "",
        playing: row.playing === true,
      };
    },

    async systemStats() {
      const { stdout } = await ps(STATS_PS);
      return parseStats(stdout);
    },
  };
}
