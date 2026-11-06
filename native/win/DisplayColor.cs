using System.Runtime.InteropServices;

namespace WinDock;

// Read-only HDR diagnostics. Never change the user's display mode or make an
// otherwise successful brightness command fail if a driver cannot report it.
internal static class DisplayColor
{
    private const uint ActivePaths = 2;
    private const int InsufficientBuffer = 122;

    internal static bool? IsHdrActive()
    {
        try
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                if (GetDisplayConfigBufferSizes(ActivePaths, out var pathCount, out var modeCount) != 0) return null;
                if (pathCount > 1024 || modeCount > 4096) return null;
                var paths = new DisplayPath[pathCount];
                var modes = new DisplayMode[modeCount];
                var error = QueryDisplayConfig(ActivePaths, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero);
                if (error == InsufficientBuffer) continue; // A display was attached/detached between calls.
                if (error != 0) return null;
                var values = new List<bool?>();
                for (var i = 0; i < pathCount; i++)
                    if (paths[i].Target.Available != 0) values.Add(ReadTarget(paths[i].Target));
                return Combine(values);
            }
        }
        catch { /* Older OS, unavailable desktop session, or an unsupported driver. */ }
        return null;
    }

    private static bool? ReadTarget(PathTarget target)
    {
        var modern = new AdvancedColorInfo2 { Header = Header(15, 36, target) };
        if (GetAdvancedColorInfo2(ref modern) == 0) return ModernHdr(modern.ActiveColorMode);
        var legacy = new AdvancedColorInfo { Header = Header(9, 32, target) };
        return GetAdvancedColorInfo(ref legacy) == 0 ? LegacyHdr(legacy.Flags) : null;
    }

    // Windows 11 reports HDR separately from wide color gamut (WCG).
    internal static bool? ModernHdr(uint mode) => mode switch { 0 or 1 => false, 2 => true, _ => null };
    internal static bool LegacyHdr(uint flags) => (flags & 2) != 0 && (flags & 4) == 0;
    internal static bool? Combine(IEnumerable<bool?> states)
    {
        var any = false;
        var unknown = false;
        foreach (var state in states)
        {
            if (state == true) return true;
            any = true;
            unknown |= state is null;
        }
        return any && !unknown ? false : null;
    }

    private static DeviceHeader Header(uint type, uint size, PathTarget target) =>
        new() { Type = type, Size = size, Adapter = target.Adapter, Id = target.Id };

    // Layouts mirror Microsoft's wingdi.h, including the 48-byte mode union.
    [StructLayout(LayoutKind.Sequential)] internal struct Luid { internal uint Low; internal int High; }
    [StructLayout(LayoutKind.Sequential)] internal struct PathSource { internal Luid Adapter; internal uint Id, ModeIndex, Status; }
    [StructLayout(LayoutKind.Sequential)] internal struct PathTarget
    {
        internal Luid Adapter;
        internal uint Id, ModeIndex, Technology, Rotation, Scaling, RefreshNumerator, RefreshDenominator, Scanline;
        internal int Available;
        internal uint Status;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct DisplayPath { internal PathSource Source; internal PathTarget Target; internal uint Flags; }
    [StructLayout(LayoutKind.Explicit, Size = 64)] internal struct DisplayMode { }
    [StructLayout(LayoutKind.Sequential)] internal struct DeviceHeader { internal uint Type, Size; internal Luid Adapter; internal uint Id; }
    [StructLayout(LayoutKind.Sequential)] internal struct AdvancedColorInfo { internal DeviceHeader Header; internal uint Flags, Encoding, Bits; }
    [StructLayout(LayoutKind.Sequential)] internal struct AdvancedColorInfo2 { internal DeviceHeader Header; internal uint Flags, Encoding, Bits, ActiveColorMode; }

    [DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint pathCount, [Out] DisplayPath[] paths, ref uint modeCount, [Out] DisplayMode[] modes, IntPtr topology);
    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")] private static extern int GetAdvancedColorInfo(ref AdvancedColorInfo info);
    [DllImport("user32.dll", EntryPoint = "DisplayConfigGetDeviceInfo")] private static extern int GetAdvancedColorInfo2(ref AdvancedColorInfo2 info);
}
