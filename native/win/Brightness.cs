// Display brightness via WMI (WmiMonitorBrightnessMethods).
//
// This works on panels that expose the WMI brightness interface — laptops and
// many all-in-ones. Most desktop monitors connected over HDMI/DisplayPort do
// not, and there the call fails cleanly rather than pretending to succeed.

using System.Management;

namespace WinDock;

internal static class Brightness
{
    /// <param name="percent">0 to 100</param>
    public static bool Set(int percent)
    {
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;

        try
        {
            using var scope = new ManagementScope(@"\\.\root\wmi");
            scope.Connect();

            using var searcher = new ManagementObjectSearcher(
                scope, new ObjectQuery("SELECT * FROM WmiMonitorBrightnessMethods"));
            using var results = searcher.Get();

            var applied = false;
            foreach (ManagementObject monitor in results)
            {
                using (monitor)
                {
                    // WmiSetBrightness(timeout, brightness); 1s timeout.
                    monitor.InvokeMethod("WmiSetBrightness", new object[] { (uint)1, (byte)percent });
                    applied = true;
                }
            }

            if (!applied) Console.Error.WriteLine("brightness: no WMI-controllable display found");
            return applied;
        }
        catch (ManagementException ex)
        {
            Console.Error.WriteLine($"brightness: {ex.Message}");
            return false;
        }
        catch (UnauthorizedAccessException ex)
        {
            Console.Error.WriteLine($"brightness: {ex.Message}");
            return false;
        }
    }
}
