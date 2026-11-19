const RELEASE_PAGE = "https://github.com/yeshwanthkumardomala/WinDock/releases/tag/upgrades-latest";

export function updateStatusText(result) {
  if (result.status === "current") return "You’re up to date.";
  if (result.status === "available") return "WinDock " + result.latestVersion + " is available.";
  if (result.status === "failed") return "Couldn’t check for updates. Check your internet connection and try again.";
  return "Check for the latest release when you’re ready.";
}

export function phoneStatusText(phone) {
  switch (phone.status) {
    case "checking": return "Checking for updates…";
    case "current": return "You’re up to date.";
    case "available": return "WinDock " + phone.version + " is available for this phone.";
    case "downloading": return "Downloading… " + (Number.isFinite(phone.percent) ? Math.max(0, Math.min(100, Math.round(phone.percent))) + "%" : "");
    case "installing": return "Ready. Tap Install when Android asks.";
    case "permission": return "Allow WinDock to install updates in the screen that just opened, then come back and tap Update again.";
    case "failed": return phone.message || "Couldn’t check for phone updates. Check your internet connection and try again.";
    default: return "Check for the latest release when you’re ready.";
  }
}

export function createUpdates({ api, get = id => document.getElementById(id), android = window.WinDockAndroid }) {
  let busy = false, result = { status: "unchecked" }, pcInstalling = false, pcError = "";
  let phone = { status: "unchecked" };
  const hasPhoneUpdater = typeof android?.checkAppUpdate === "function" && typeof android?.installAppUpdate === "function";
  const dialog = get("updates"), status = get("updates-status"), check = get("updates-check"), link = get("updates-download"), install = get("updates-install");

  function paint() {
    get("updates-version").textContent = result.installedVersion ? "Installed on your PC: " + result.installedVersion : "Installed version unavailable";
    status.textContent = pcInstalling ? "Installing the update. WinDock will close and reopen on your PC, so this phone may disconnect for about a minute."
      : pcError ? pcError : busy ? "Checking for updates…" : updateStatusText(result);
    const phoneBusy = phone.status === "checking" || phone.status === "downloading";
    check.disabled = busy || phoneBusy || pcInstalling;
    check.textContent = busy || phone.status === "checking" ? "Checking…" : "Check for updates";
    // A host that cannot install by itself still points at the release page.
    const version = result.latestVersion;
    const safe = typeof version === "string" && version.length <= 100 && /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version);
    const available = !busy && result.status === "available" && safe;
    install.hidden = !available || !result.canInstall || pcInstalling;
    install.disabled = pcInstalling;
    link.hidden = !available || result.canInstall === true;
    link.href = RELEASE_PAGE;
    if (hasPhoneUpdater) {
      get("updates-phone-status").textContent = phoneStatusText(phone);
      get("updates-phone-install").hidden = !(phone.status === "available" || phone.status === "permission" || phone.status === "failed" && phone.retry);
      get("updates-phone-install").disabled = phone.status === "downloading";
    }
  }

  async function checkPc(manual) {
    if (busy) return;
    busy = true; pcError = ""; paint();
    try { result = await api(manual ? "/api/updates/check" : "/api/updates", manual ? { method: "POST", body: "{}" } : {}); }
    catch { result = { status: "failed", installedVersion: result.installedVersion }; }
    finally { busy = false; paint(); }
  }
  function checkPhone() {
    if (!hasPhoneUpdater || phone.status === "downloading") return;
    phone = { status: "checking" }; paint();
    try { android.checkAppUpdate(); } catch { phone = { status: "failed" }; paint(); }
  }
  async function installPc() {
    if (pcInstalling || !result.canInstall) return;
    pcInstalling = true; pcError = ""; paint();
    try { await api("/api/updates/install", { method: "POST", body: "{}" }); }
    catch (error) { pcInstalling = false; pcError = error?.message || "The update couldn’t be installed."; }
    paint();
  }

  check.addEventListener("click", () => { checkPc(true); checkPhone(); });
  install.addEventListener("click", installPc);
  link.addEventListener("click", event => {
    if (typeof android?.openPcRelease === "function") { event.preventDefault(); android.openPcRelease(result.latestVersion); }
    else if (android) { event.preventDefault(); status.textContent = "Open " + RELEASE_PAGE + " on your PC to download the update."; }
  });
  if (hasPhoneUpdater) {
    get("updates-android").hidden = false;
    get("updates-android-version").textContent = "Installed on this phone: " + android.getAppVersion();
    get("updates-phone-install").addEventListener("click", () => { phone = { status: "downloading", percent: 0 }; paint(); try { android.installAppUpdate(); } catch { phone = { status: "failed" }; paint(); } });
    // Called by the Android app as the check and download progress.
    window.windockAppUpdate = json => {
      try { const next = JSON.parse(json); if (next && typeof next.status === "string") { phone = { ...next, retry: next.status === "failed" && !!next.retry }; paint(); } } catch { /* ignore malformed native messages */ }
    };
  } else if (typeof android?.showUpdates === "function" && typeof android?.getAppVersion === "function") {
    // Older Android builds keep their own dialog.
    get("updates-android").hidden = false;
    get("updates-android-version").textContent = "Installed on this phone: " + android.getAppVersion();
    get("updates-android-check").hidden = false;
    get("updates-android-check").addEventListener("click", () => android.showUpdates());
  }
  return { open() { get("drawer").close(); get("settings").close(); if (!dialog.open) dialog.showModal(); paint(); checkPc(false); } };
}
