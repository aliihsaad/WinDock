using System.Text.Json;
using Windows.ApplicationModel.DataTransfer;
using Clipboard = Windows.ApplicationModel.DataTransfer.Clipboard;

namespace WinDock;

internal static class ClipboardHistory
{
    // Runs in a short-lived helper. No history is persisted or logged by WinDock.
    internal static int Read()
    {
        if (!Clipboard.IsHistoryEnabled()) return Emit("disabled", [], 0);
        var result = Clipboard.GetHistoryItemsAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2)).GetAwaiter().GetResult();
        if (result.Status != ClipboardHistoryItemsResultStatus.Success) return Emit("unavailable", [], 0);
        var items = new List<object>();
        var total = 0;
        var skipped = 0;
        foreach (var item in result.Items.OrderByDescending(item => item.Timestamp).Take(20))
        {
            if (!item.Content.Contains(StandardDataFormats.Text)) continue;
            try
            {
                var text = item.Content.GetTextAsync().AsTask().WaitAsync(TimeSpan.FromMilliseconds(500)).GetAwaiter().GetResult();
                if (text.Length == 0) continue;
                if (text.Length > 32768 || total + text.Length > 131072) { skipped++; continue; }
                total += text.Length;
                items.Add(new { text });
            }
            catch { skipped++; }
        }
        return Emit("ready", items, skipped);
    }

    private static int Emit(string status, IEnumerable<object> items, int skipped)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(new { status, items, skipped }));
        return 0;
    }
}
