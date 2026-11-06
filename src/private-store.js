/** User-only state. Never store these files beside distributable binaries. */
import { mkdir, lstat, chmod } from "node:fs/promises";
import { writeFileSync, renameSync, unlinkSync, lstatSync, openSync, fsyncSync, closeSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { resolve, parse } from "node:path";

const exec = promisify(execFile);
export async function privateDirectory(path) {
  path = resolve(path);
  if (path === parse(path).root) throw new Error("Private state requires a dedicated directory.");
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink())
    throw new Error("Private state directory must not be a link.");
  if (process.platform === "win32") {
    // PowerShell 5.1 is built into Windows. No interpolation of paths into code.
    const script = `$ErrorActionPreference='Stop'; $p=$env:WINDOCK_PRIVATE_DIRECTORY; $a=New-Object System.Security.AccessControl.DirectorySecurity; $a.SetAccessRuleProtection($true,$false); $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; foreach($i in @($u,(New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))) { $a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($i,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))) }; [System.IO.Directory]::SetAccessControl($p,$a)`;
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15000, env: { ...process.env, WINDOCK_PRIVATE_DIRECTORY: path } });
  } else await chmod(path, 0o700);
  return path;
}

export function writePrivateJson(path, value) {
  try { if (lstatSync(path).isSymbolicLink()) throw new Error("Private state file must not be a link."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(value) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path);
  } finally { try { unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}
