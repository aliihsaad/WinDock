// WinDockHelper — the Win32 surface WinDock needs, behind an argv interface.
//
// Every argument arrives as a separate argv entry from Node's execFile, so no
// string is ever parsed by a shell. The helper validates each verb against a
// fixed switch and never concatenates user input into a command.
//
// Verbs:
//   launch <absolutePath> [args] start a process with the shortcut's argument string
//   focus  <pid>                 bring a process's main window to the foreground
//   close  <pid>                 ask the main window to close
//   control <verb> [value]       volume / media / brightness / power
//   nowplaying                   print the current media session as JSON
//
// Exit codes: 0 success, 1 usage error, 2 runtime failure.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace WinDock;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("usage: WinDockHelper <launch|focus|close|control|nowplaying> [...]");
            return 1;
        }

        try
        {
            return args[0] switch
            {
                "launch" => Launch(args),
                "launch-packaged" => LaunchPackaged(args),
                "icon-packaged" => PackagedIcon(args),
                "focus" => Focus(args),
                "close" => Close(args),
                "control" => Control(args),
                "nowplaying" => NowPlaying(),
                "volume" => ReadVolume(),
                "brightness" => ReadBrightness(args),
                "capture" => ScreenCapture.Run(args),
                "icon" => ReadIcon(args),
                _ => Usage($"unknown verb: {args[0]}"),
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 2;
        }
    }

    private static int Usage(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }

    // ---- launch ----------------------------------------------------------

    private static int Launch(string[] args)
    {
        if (args.Length is < 2 or > 3) return Usage("usage: launch <path> [arguments]");
        var target = args[1];
        if (string.IsNullOrWhiteSpace(target)) return Usage("launch: empty target");

        // UseShellExecute lets Windows resolve the verb for the file type and
        // launches with the user's own token. The path is passed as FileName,
        // never as part of a command string.
        var psi = new ProcessStartInfo
        {
            FileName = target,
            Arguments = args.Length == 3 ? args[2] : string.Empty,
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(target) ?? string.Empty,
        };
        using var proc = Process.Start(psi);
        return proc is null ? 2 : 0;
    }

    // ---- window activation ----------------------------------------------

    private static int LaunchPackaged(string[] args)
    {
        if (args.Length != 2 || !PackagedApp.IsValid(args[1])) return Usage("launch-packaged: invalid app identifier");
        PackagedApp.Launch(args[1]);
        return 0;
    }

    private static int PackagedIcon(string[] args)
    {
        if (args.Length != 2 || !PackagedApp.IsValid(args[1])) return Usage("icon-packaged: invalid app identifier");
        Console.Out.Write(JsonSerializer.Serialize(new { png = PackagedApp.Icon(args[1]) }));
        return 0;
    }

    private const int SW_RESTORE = 9;

    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    private static int Focus(string[] args)
    {
        if (args.Length != 2) return Usage("usage: focus <pid>");
        if (!int.TryParse(args[1], out var pid) || pid <= 0) return Usage("focus: pid must be a positive integer");

        using var proc = GetProcess(pid);
        if (proc is null) return 2;

        var hWnd = proc.MainWindowHandle;
        if (hWnd == IntPtr.Zero)
        {
            Console.Error.WriteLine("focus: process has no main window");
            return 2;
        }

        if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);

        // Windows refuses SetForegroundWindow from a process that does not own
        // the foreground. Attaching to the foreground thread's input queue is
        // the documented way to make the call succeed for a legitimate
        // user-initiated activation.
        var foreground = GetForegroundWindow();
        var foreThread = GetWindowThreadProcessId(foreground, out _);
        var thisThread = GetCurrentThreadId();

        if (foreThread != thisThread) AttachThreadInput(thisThread, foreThread, true);
        var ok = SetForegroundWindow(hWnd);
        if (foreThread != thisThread) AttachThreadInput(thisThread, foreThread, false);

        return ok ? 0 : 2;
    }

    private const uint WM_CLOSE = 0x0010;
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private static int Close(string[] args)
    {
        if (args.Length != 2) return Usage("usage: close <pid>");
        if (!int.TryParse(args[1], out var pid) || pid <= 0) return Usage("close: pid must be a positive integer");

        using var proc = GetProcess(pid);
        if (proc is null) return 2;

        // WM_CLOSE asks politely, so the app can prompt to save. It is never
        // escalated to Kill(): losing a user's unsaved work from a phone tap is
        // not an acceptable failure mode.
        if (proc.MainWindowHandle != IntPtr.Zero)
        {
            SendMessage(proc.MainWindowHandle, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            return 0;
        }
        Console.Error.WriteLine("close: process has no main window");
        return 2;
    }

    private static Process? GetProcess(int pid)
    {
        try
        {
            var proc = Process.GetProcessById(pid);
            proc.Refresh();
            return proc;
        }
        catch (ArgumentException)
        {
            Console.Error.WriteLine($"no process with pid {pid}");
            return null;
        }
    }

    // ---- control ---------------------------------------------------------

    [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    private const uint KEYEVENTF_KEYUP = 0x0002;

    private const byte VK_VOLUME_MUTE = 0xAD;
    private const byte VK_VOLUME_DOWN = 0xAE;
    private const byte VK_VOLUME_UP = 0xAF;
    private const byte VK_MEDIA_NEXT_TRACK = 0xB0;
    private const byte VK_MEDIA_PREV_TRACK = 0xB1;
    private const byte VK_MEDIA_STOP = 0xB2;
    private const byte VK_MEDIA_PLAY_PAUSE = 0xB3;

    private static void Tap(byte vk)
    {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static int Control(string[] args)
    {
        if (args.Length < 2) return Usage("usage: control <verb> [value]");
        var verb = args[1];

        int? value = null;
        if (args.Length == 3)
        {
            if (!int.TryParse(args[2], out var parsed)) return Usage("control: value must be an integer");
            if (parsed is < 0 or > 100) return Usage("control: value must be 0..100");
            value = parsed;
        }
        else if (args.Length > 3)
        {
            return Usage("control: too many arguments");
        }

        switch (verb)
        {
            case "volume-up": Tap(VK_VOLUME_UP); return 0;
            case "volume-down": Tap(VK_VOLUME_DOWN); return 0;
            case "mute-toggle": Tap(VK_VOLUME_MUTE); return 0;
            case "media-play-pause": Tap(VK_MEDIA_PLAY_PAUSE); return 0;
            case "media-next": Tap(VK_MEDIA_NEXT_TRACK); return 0;
            case "media-previous": Tap(VK_MEDIA_PREV_TRACK); return 0;
            case "media-stop": Tap(VK_MEDIA_STOP); return 0;

            case "volume-set":
                if (value is null) return Usage("volume-set requires a value");
                return Audio.SetMasterVolume(value.Value / 100f) ? 0 : 2;

            case "brightness-set":
                if (value is null) return Usage("brightness-set requires a value");
                return Brightness.Set(value.Value) ? 0 : 2;

            case "lock":
                return LockWorkStation() ? 0 : 2;

            case "sleep":
                // false, false => suspend (not hibernate), do not force apps.
                return SetSuspendState(false, false, false) ? 0 : 2;

            case "shutdown":
                return RunShutdown("/s", "/t", "0");

            case "restart":
                return RunShutdown("/r", "/t", "0");

            default:
                return Usage($"control: unknown verb {verb}");
        }
    }

    [DllImport("user32.dll")] private static extern bool LockWorkStation();
    [DllImport("powrprof.dll", SetLastError = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

    /// <summary>
    /// shutdown.exe is invoked with a fixed argument list. The arguments are
    /// compile-time constants chosen by the switch above; no caller input
    /// reaches this method.
    /// </summary>
    private static int RunShutdown(params string[] flags)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "shutdown.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var flag in flags) psi.ArgumentList.Add(flag);

        using var proc = Process.Start(psi);
        if (proc is null) return 2;
        proc.WaitForExit(10_000);
        return proc.HasExited ? proc.ExitCode : 2;
    }

    // ---- now playing -----------------------------------------------------

    private static int NowPlaying()
    {
        var session = MediaSession.Current();
        Console.Out.Write(JsonSerializer.Serialize(session ?? new { }));
        return 0;
    }

    // Read-only diagnostic, also used to restore volume during native checks.
    private static int ReadVolume()
    {
        var level = Audio.GetMasterVolume();
        Console.Out.Write(JsonSerializer.Serialize(new { volume = level }));
        return level is null ? 2 : 0;
    }

    private static int ReadBrightness(string[] args)
    {
        if (args.Length != 1) return Usage("usage: brightness");
        var displays = Brightness.Read();
        Console.Out.Write(JsonSerializer.Serialize(new { displays }));
        return displays.Count > 0 ? 0 : 2;
    }

    private static int ReadIcon(string[] args)
    {
        if (args.Length != 3) return Usage("usage: icon <target> <icon-location>");
        Console.Out.Write(JsonSerializer.Serialize(new { png = AppIcon.Extract(args[1], args[2]) }));
        return 0;
    }
}
