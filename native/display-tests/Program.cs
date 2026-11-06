using System.Runtime.InteropServices;
using WinDock;

var count = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception(name); count++; }
void Size<T>(int size) => Check(Marshal.SizeOf<T>() == size, $"Native layout: {typeof(T).Name}");
Size<DisplayColor.Luid>(8);
Size<DisplayColor.PathSource>(20);
Size<DisplayColor.PathTarget>(48);
Size<DisplayColor.DisplayPath>(72);
Size<DisplayColor.DisplayMode>(64);
Size<DisplayColor.DeviceHeader>(20);
Size<DisplayColor.AdvancedColorInfo>(32);
Size<DisplayColor.AdvancedColorInfo2>(36);
Check(Marshal.OffsetOf<DisplayColor.DisplayPath>("Target").ToInt32() == 20, "Target offset");
Check(Marshal.OffsetOf<DisplayColor.AdvancedColorInfo2>("ActiveColorMode").ToInt32() == 32, "Color mode offset");
Check(DisplayColor.ModernHdr(0) == false, "SDR does not warn");
Check(DisplayColor.ModernHdr(1) == false, "WCG alone does not warn");
Check(DisplayColor.ModernHdr(2) == true, "Active HDR warns");
Check(DisplayColor.ModernHdr(99) is null, "Unknown future mode is unknown");
Check(!DisplayColor.LegacyHdr(1), "HDR support alone does not warn");
Check(DisplayColor.LegacyHdr(3), "Legacy active HDR warns");
Check(!DisplayColor.LegacyHdr(7), "Legacy wide-color enforced mode does not warn");
Check(DisplayColor.Combine([]) is null, "No active displays is unknown");
Check(DisplayColor.Combine([false, false]) == false, "All SDR is false");
Check(DisplayColor.Combine([false, null]) is null, "Incomplete diagnostics is unknown");
Check(DisplayColor.Combine([false, null, true]) == true, "Any HDR display warns in mixed setups");
// This is a read-only API smoke check, not evidence of a physical brightness change.
var live = DisplayColor.IsHdrActive();
Console.WriteLine($"DisplayConfig read-only smoke: hdrActive={live?.ToString() ?? "unknown"}");
Console.WriteLine($"DISPLAY TESTS OK: {count} assertions");
