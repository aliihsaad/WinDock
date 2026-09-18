// Built-in panels use WMI; external monitors use DDC/CI brightness control.
using System.Management;
using System.Runtime.InteropServices;

namespace WinDock;

internal static class Brightness
{
    internal sealed record DisplayLevel(string name, string method, uint min, uint current, uint max)
    {
        public int percent => (int)Math.Round((current - min) * 100.0 / (max - min));
    }

    // Read-only diagnostic for support checks and preserving levels during tests.
    public static List<DisplayLevel> Read()
    {
        var displays = new List<DisplayLevel>();
        VisitWmi("WmiMonitorBrightness", monitor =>
            displays.Add(new DisplayLevel((string)monitor["InstanceName"], "wmi", 0,
                Convert.ToUInt32(monitor["CurrentBrightness"]), 100)));
        VisitPhysical((monitor, level) => displays.Add(level));
        return displays;
    }

    public static bool Set(int percent)
    {
        percent = Math.Clamp(percent, 0, 100);
        var applied = 0;
        var failed = 0;
        VisitWmi("WmiMonitorBrightnessMethods", monitor =>
        {
            var result = monitor.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)percent });
            if (result is not null && Convert.ToUInt32(result) == 0) applied++;
            else failed++;
        }, () => failed++);
        VisitPhysical((monitor, level) =>
        {
            // Monitor ranges are not necessarily 0..100.
            var value = level.min + (uint)Math.Round((level.max - level.min) * (percent / 100.0));
            var ok = level.method == "ddc-ci"
                ? SetMonitorBrightness(monitor.Handle, value)
                : SetVCPFeature(monitor.Handle, 0x10, value);
            if (ok) applied++;
            else
            {
                failed++;
                Console.Error.WriteLine($"brightness: {level.name} rejected the change ({Marshal.GetLastWin32Error()})");
            }
        });
        if (applied == 0)
            Console.Error.WriteLine("brightness: no display accepted brightness control; check monitor DDC/CI and picture-mode settings");
        else if (failed > 0)
            Console.Error.WriteLine("brightness: some displays could not be adjusted");
        return applied > 0 && failed == 0;
    }

    private static void VisitWmi(string className, Action<ManagementObject> visit, Action? onFailure = null)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(@"\\.\root\wmi",
                $"SELECT * FROM {className} WHERE Active = TRUE");
            using var results = searcher.Get();
            foreach (ManagementObject monitor in results)
            {
                using (monitor)
                {
                    try { visit(monitor); }
                    catch (Exception ex) when (ex is ManagementException or UnauthorizedAccessException or COMException)
                    {
                        onFailure?.Invoke();
                        Console.Error.WriteLine($"brightness: WMI panel: {ex.Message}");
                    }
                }
            }
        }
        catch (Exception ex) when (ex is ManagementException or UnauthorizedAccessException or COMException)
        {
            // External-only desktops normally lack WMI. Continue to DDC/CI.
        }
    }

    private static void VisitPhysical(Action<PhysicalMonitor, DisplayLevel> visit)
    {
        var logicalMonitors = new List<IntPtr>();
        if (!EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (monitor, dc, rect, data) =>
            { logicalMonitors.Add(monitor); return true; }, IntPtr.Zero)) return;
        foreach (var logicalMonitor in logicalMonitors)
        {
            if (!GetNumberOfPhysicalMonitorsFromHMONITOR(logicalMonitor, out var count) || count == 0 || count > 64) continue;
            var monitors = new PhysicalMonitor[count];
            if (!GetPhysicalMonitorsFromHMONITOR(logicalMonitor, count, monitors)) continue;
            try
            {
                foreach (var monitor in monitors)
                {
                    if (GetMonitorBrightness(monitor.Handle, out var min, out var current, out var max)
                        && ValidRange(min, current, max))
                        visit(monitor, new DisplayLevel(monitor.Description, "ddc-ci", min, current, max));
                    // Some firmware supports VCP luminance but not the high-level API.
                    else if (GetVCPFeatureAndVCPFeatureReply(monitor.Handle, 0x10, out var type, out current, out max)
                        && type == 1 && ValidRange(0, current, max))
                        visit(monitor, new DisplayLevel(monitor.Description, "ddc-ci-vcp", 0, current, max));
                }
            }
            finally { DestroyPhysicalMonitors(count, monitors); }
        }
    }

    private static bool ValidRange(uint min, uint current, uint max) => max > min && current >= min && current <= max;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PhysicalMonitor
    {
        public IntPtr Handle;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    }
    private delegate bool MonitorEnumProc(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr monitor, out uint count);
    [DllImport("dxva2.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr monitor, uint count, [Out] PhysicalMonitor[] monitors);
    [DllImport("dxva2.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyPhysicalMonitors(uint count, [In] PhysicalMonitor[] monitors);
    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorBrightness(IntPtr monitor, out uint min, out uint current, out uint max);
    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetMonitorBrightness(IntPtr monitor, uint value);
    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr monitor, byte code, out int type, out uint current, out uint max);
    [DllImport("dxva2.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetVCPFeature(IntPtr monitor, byte code, uint value);
}
