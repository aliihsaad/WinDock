# Native Windows focus smoke: root cause and test setup

Investigation: 30 October 2026, branch `play-store-integration-v0.2.6`.

**The failure predates the Play integration and is caused by Windows denying
foreground activation to an ineligible background helper.** It is not a missing
window, broken PID, failed thread attachment, or HTTPS/protocol regression.
The smoke test previously assumed that its background automation context always
had permission to activate another process. That assumption is not valid.

## Released baseline comparison

The native helper, original probe, smoke scripts and Windows provider were
identical between released v0.2.6 (`24500ac3beb95a8758c4a54511479d6c499aca00`)
and the Play integration before this investigation. The released native source
was extracted with `git archive` and compiled into a separate artifact directory;
the working branch and packaged integration helper were not replaced.

Original `native/win/Program.cs` SHA-256:
`279a900d9071a7cc45896dc14b1ed2ae0c9708d7e34ef3389d7c808fc7b6f602`.

| Reproduction/control | Released helper | Integrated helper |
| --- | --- | --- |
| Background attempts in the same desktop session | 10/10 denied, exit 2 | 10/10 denied, exit 2 |
| Explicit debugger eligibility, same helpers and probe | 5/5 passed | 5/5 passed |

The positive control checked the actual foreground PID against the owned probe,
not just a successful exit code. The initial unmodified full smoke also passed
once, demonstrating why this environment-dependent failure can appear intermittent.

## Diagnostic evidence

A separate diagnostic build instrumented the existing focus method. It did not
replace a shipped helper. Across 10 failing diagnostic attempts:

- The target process was running, enumerated, and had a nonzero main window.
- `AttachThreadInput` returned true, with error 0; detach also succeeded.
- `SetForegroundWindow` returned false. The foreground window remained unchanged
  immediately afterward and after a 100 ms observation interval.
- `AllowSetForegroundWindow` for the diagnostic helper's **own** PID returned
  false with `ERROR_ACCESS_DENIED` (5), confirming that the caller could not grant
  foreground eligibility. No other process was granted permission by this check.
- Foreground-thread GUI flags were 0: no menu/move-size state was active.
- `SPI_GETFOREGROUNDLOCKTIMEOUT` reported **2,147,483,647 ms** in the running
  session, while observed idle times were approximately 177–185 seconds.
  The stored registry value was 200,000 ms. The live value, not the saved default,
  applied during these tests. This investigation did not change either value and
  does not attribute the existing runtime override to a particular application.
- The existing foreground belonged to Edge or Explorer in the background-failure
  matrix. No window titles, browser content or user input were recorded.

Windows explicitly restricts `SetForegroundWindow`, including for background
callers. Being debugged is one of its documented eligibility conditions. Sharing
input queues is not a guarantee of foreground permission. Granting the new test
helper that documented debugger eligibility changed the outcome to success
without modifying the helper's focus implementation or system policy.
See [SetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow),
[AllowSetForegroundWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-allowsetforegroundwindow),
and [Microsoft's explanation of input-queue limitations](https://devblogs.microsoft.com/oldnewthing/20130607-00/?p=4143).

The precise observed failing operation is therefore Windows' foreground-policy
denial. `SetForegroundWindow` does not expose a detailed denial reason through
`GetLastError`; the separately measured eligibility denial and controlled positive
test establish the relevant precondition without inventing an undocumented error.

## Narrow test correction

Application behavior is unchanged. `native/win/Program.cs` only has its inaccurate
comment corrected; all executable focus logic, exit codes and protocols remain.
There is no simulated Alt key, global foreground-timeout change, permission grant
to every process, elevation requirement, or new application-side workaround.

The smoke-test changes are isolated to:

- `native/probe/Program.cs`: records actual window activation; routes the explicit
  test-only control mode.
- `native/probe/FocusDebugControl.cs`: starts only a new helper with
  `DEBUG_ONLY_THIS_PROCESS`, checks an owned smoke-probe target, services bounded
  debugger events, preserves helper failures, verifies the actual foreground PID,
  and releases its resources. It never attaches to an existing user application.
- `scripts/test-windows.ps1`: exposes the opt-in `-FocusDebugControl` switch.
- `scripts/smoke-windows.mjs`: waits for real activation, labels the controlled mode,
  and explains focus failures. Ordinary mode still fails if focus is denied.

The new runner is compiled into the **test probe only**. The Windows application
build and installer do not include it. The default test has no automatic fallback
to debugger mode and never converts a denied focus request into a pass.

Run ordinary acceptance from an eligible interactive foreground session:

```powershell
./scripts/test-windows.ps1
```

For a background automation environment, run the explicitly scoped positive
control to validate native focus mechanics separately from foreground eligibility:

```powershell
./scripts/test-windows.ps1 -FocusDebugControl
```

Its result is labelled `WINDOWS SMOKE OK (focus debugger positive control)`.
It does not prove that an ordinary background host can override Windows policy.
Do not weaken the operating system's focus settings to obtain a green test.
The debugger process-creation mode is documented in
[Microsoft's process creation flags](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).
The activation check also accounts for
[asynchronous cross-queue activation](https://devblogs.microsoft.com/oldnewthing/20161118-00/?p=94745).

## Final validation

| Check | Result | Local evidence |
| --- | --- | --- |
| Ordinary updated native smoke | **Passed**, including actual activation, polite close, volume preservation, now-playing and packaged tray startup/shutdown | `artifacts/focus-smoke-normal-final.log` |
| Controlled complete native smoke | **3 consecutive passes**, actual foreground target verified | `artifacts/focus-smoke-controlled-1.log` through `-3.log` |
| Runner guard checks | **3 passed**: non-probe target, invalid PID and missing helper refused before debugging | `artifacts/focus-runner-negative.json` |
| Full repository regression | **31/31 oracles passed**, including HTTPS/WSS, auth/pairing, v1/v2 discovery, clipboard/paste and updates | `artifacts/focus-repository-regression.log` |
| Native input/signature tests | **48 assertions passed**, no desktop input injected | `artifacts/focus-native-input.log` |
| Native update tests | **42 passed** | `artifacts/focus-native-updates.log` |
| Saved-port tests | **21 assertions passed** | `artifacts/focus-native-ports.log` |
| Probe compilation | **Passed** | `artifacts/focus-smoke-controlled-1.log` |

Reproduction records are under `artifacts/focus-investigation/`:
`default-desktop-results.json`, `eligibility-results.json`, and
`debug-control-results.json`. An exploratory non-input-desktop experiment was
inconclusive and was not used as passing evidence. The positive-control launcher
initially needed the repository-local .NET runtime configured; the recorded final
comparison above is from the successful run. The shipped test probe is self-contained.

No Android source, transport implementation, pairing, clipboard, update logic,
signing configuration or release workflow was changed during this investigation.
Android builds/device matrices from `PLAY_INTEGRATION.md` remain the prior evidence;
they were not needlessly rebuilt for this test-only change. All work remains
uncommitted. No merge, push, deployment, upload, publication or production signing
key operation was performed.

## Remaining acceptance gates

The unknown smoke failure is explained and ordinary/native controlled checks have
passed. **An ordinary host may still receive Windows' foreground denial**, including
when another application is active or locks foreground changes. That is an existing
v0.2.6 platform limitation, not something this test mode removes. Verify phone-driven
launch/focus against representative real applications in the intended user session;
do not infer that acceptance from a debugger-assisted test.

The existing clean-VM installer test, physical Wi-Fi/USB/OEM matrix, Linux/iOS native
checks, signing/migration approval, policy publication, Play declarations and closed
testing remain open as described in `PLAY_INTEGRATION.md`.
