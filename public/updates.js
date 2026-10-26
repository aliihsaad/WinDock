export function updateStatusText(result) {
  if (result.status === "current") return "You’re up to date.";
  if (result.status === "available") return "WinDock " + result.latestVersion + " is available.";
  if (result.status === "failed") return "Couldn’t check for updates. Check your internet connection and try again.";
  return "Check for the latest release when you’re ready.";
}
export function createUpdates({ api, get = id => document.getElementById(id), android = window.WinDockAndroid }) {
  let busy = false, result = { status: "unchecked" };
  const dialog = get("updates"), status = get("updates-status"), check = get("updates-check"), link = get("updates-download");
  function paint() {
    get("updates-version").textContent = result.installedVersion ? "Installed on your PC: " + result.installedVersion : "Installed version unavailable";
    status.textContent = busy ? "Checking for updates…" : updateStatusText(result);
    check.disabled = busy;
    check.textContent = busy ? "Checking…" : "Check for updates";
    // Construct a known repository URL instead of trusting a response-provided link.
    const version = result.latestVersion;
    const safe = typeof version === "string" && version.length <= 100 && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version);
    link.hidden = busy || result.status !== "available" || !safe;
    link.href = !link.hidden ? "https://github.com/aliihsaad/WinDock/releases/tag/v" + version : "https://github.com/aliihsaad/WinDock/releases";
  }
  async function load(manual) {
    if (busy) return;
    busy = true; paint();
    try { result = await api(manual ? "/api/updates/check" : "/api/updates", manual ? { method: "POST", body: "{}" } : {}); }
    catch { result = { status: "failed", installedVersion: result.installedVersion }; }
    finally { busy = false; paint(); }
  }
  check.addEventListener("click", () => load(true));
  link.addEventListener("click", event => {
    if (typeof android?.openPcRelease === "function") { event.preventDefault(); android.openPcRelease(result.latestVersion); }
    else if (android) { event.preventDefault(); status.textContent = "Open windock.vercel.app on your PC to download the update."; }
  });
  if (typeof android?.showUpdates === "function" && typeof android?.getAppVersion === "function") {
    get("updates-android").hidden = false;
    get("updates-android-version").textContent = "Installed on this phone: " + android.getAppVersion();
    get("updates-android-check").addEventListener("click", () => android.showUpdates());
  }
  return { open() { get("drawer").close(); get("settings").close(); if (!dialog.open) dialog.showModal(); load(false); } };
}
