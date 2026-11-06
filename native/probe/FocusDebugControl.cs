// Opt-in positive control for Windows' foreground-activation policy.
// Used only by the smoke-test probe; never included in the application package.
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

internal static class FocusDebugControl
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int size;
        public string? reserved, desktop, title;
        public int x, y, width, height, xChars, yChars, fill, flags;
        public short show, extraSize;
        public IntPtr extra, input, output, error;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder command,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags,
        IntPtr environment, string? directory, ref StartupInfo startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WaitForDebugEventEx(IntPtr debugEvent, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ContinueDebugEvent(int pid, int tid, uint status);
    [DllImport("kernel32.dll")] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);

    public static int Run(string[] args)
    {
        try
        {
            if (args.Length != 3 || !int.TryParse(args[2], out var targetPid) || targetPid <= 0)
                throw new ArgumentException("usage: --focus-debug-control <helper path> <owned probe pid>");
            var helper = Path.GetFullPath(args[1]);
            if (!File.Exists(helper) || !Path.GetFileName(helper).Equals("WinDockHelper.exe", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("A built WinDockHelper.exe is required.");
            using var target = Process.GetProcessById(targetPid);
            if (!string.Equals(target.MainModule?.FileName, Environment.ProcessPath, StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("The focus target must be another instance of this smoke-test probe.");
            if (!Environment.Is64BitProcess) throw new PlatformNotSupportedException("This test runner requires x64.");
            return RunHelper(helper, targetPid);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 2;
        }
    }

    private static int RunHelper(string helper, int targetPid)
    {
        var startup = new StartupInfo { size = Marshal.SizeOf<StartupInfo>(), flags = 1, show = 0 };
        // DEBUG_ONLY_THIS_PROCESS grants the documented foreground eligibility to
        // this new helper only. Never attach to an existing app, debug its children,
        // simulate input, change the global timeout, or grant ASFW_ANY.
        if (!CreateProcess(helper, new StringBuilder($"\"{helper}\" focus {targetPid}"),
            IntPtr.Zero, IntPtr.Zero, false, 0x2 | 0x08000000, IntPtr.Zero, null,
            ref startup, out var process))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        // DEBUG_EVENT's union begins at offset 16 on x64; this buffer covers its
        // largest member (EXCEPTION_DEBUG_INFO). Only documented fields are read.
        var buffer = Marshal.AllocHGlobal(176);
        var finished = false;
        var loaderBreakpointSeen = false;
        try
        {
            var until = Environment.TickCount64 + 10000;
            while (Environment.TickCount64 < until)
            {
                if (!WaitForDebugEventEx(buffer, 1000))
                {
                    var error = Marshal.GetLastWin32Error();
                    if (error != 121) throw new Win32Exception(error); // ERROR_SEM_TIMEOUT
                    continue;
                }
                var kind = Marshal.ReadInt32(buffer, 0);
                var pid = Marshal.ReadInt32(buffer, 4);
                var tid = Marshal.ReadInt32(buffer, 8);
                uint status = 0x00010002; // DBG_CONTINUE
                // Handle only the loader breakpoint; preserve all real exceptions.
                if (kind == 1)
                {
                    if (!loaderBreakpointSeen && unchecked((uint)Marshal.ReadInt32(buffer, 16)) == 0x80000003)
                        loaderBreakpointSeen = true;
                    else status = 0x80010001; // DBG_EXCEPTION_NOT_HANDLED
                }
                if (kind is 3 or 6) // CREATE_PROCESS_DEBUG_EVENT / LOAD_DLL_DEBUG_EVENT
                {
                    var file = Marshal.ReadIntPtr(buffer, 16);
                    if (file != IntPtr.Zero) CloseHandle(file);
                }
                var exit = kind == 5 ? Marshal.ReadInt32(buffer, 16) : -1;
                if (!ContinueDebugEvent(pid, tid, status)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (kind != 5) continue; // EXIT_PROCESS_DEBUG_EVENT
                finished = true;
                if (exit != 0) return exit;
                // Activation crosses input queues asynchronously. Verify the actual
                // target, not just SetForegroundWindow's return code.
                uint foregroundPid;
                var activationDeadline = Environment.TickCount64 + 1000;
                do
                {
                    GetWindowThreadProcessId(GetForegroundWindow(), out foregroundPid);
                    if (foregroundPid == targetPid) break;
                    Thread.Sleep(10);
                } while (Environment.TickCount64 < activationDeadline);
                if (foregroundPid != targetPid) throw new InvalidOperationException("Helper succeeded but the probe did not become foreground.");
                Console.WriteLine(JsonSerializer.Serialize(new { helperExit = exit, foregroundPid, targetPid }));
                return 0;
            }
            throw new TimeoutException("Owned focus helper timed out.");
        }
        finally
        {
            if (!finished) TerminateProcess(process.process, 124);
            CloseHandle(process.thread);
            CloseHandle(process.process);
            Marshal.FreeHGlobal(buffer);
        }
    }
}
