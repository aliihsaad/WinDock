using System.Runtime.InteropServices;
using System.Text.Json;
using WinDock;

var checks = 0;
void Check(bool ok, string message) { checks++; if (!ok) throw new Exception(message); }
var events = new List<(uint flags, int x, int y, int data)>();
var batches = new List<Touchpad.Input[]>();
var sendResults = new Queue<uint>();
var controlHeld = false;
var zoom = new Touchpad.ZoomInput(inputs => { batches.Add(inputs); return sendResults.Count > 0 ? sendResults.Dequeue() : (uint)inputs.Length; }, () => controlHeld, () => 5);
var session = new Touchpad.Session((f, x, y, d) => events.Add((f, x, y, d)), zoom.Apply, zoom.Release);
void Apply(string json) { using var doc = JsonDocument.Parse(json); session.Apply(doc.RootElement); }
Check(Marshal.SizeOf<Touchpad.Input>() == (IntPtr.Size == 8 ? 40 : 28), "INPUT layout matches Win32");
Check(Marshal.OffsetOf<Touchpad.Input>("value").ToInt32() == (IntPtr.Size == 8 ? 8 : 4), "mouse and keyboard union has native alignment");
Apply("{\"type\":\"button\",\"button\":\"left\",\"down\":true}");
Apply("{\"type\":\"button\",\"button\":\"left\",\"down\":true}");
Check(events.Count == 1 && events[0].flags == 2, "repeated down is idempotent");
Apply("{\"type\":\"zoom\",\"steps\":1}");
Check(batches.Count == 0, "zoom cannot alter a held-button drag");
Apply("{\"type\":\"move\",\"dx\":-4,\"dy\":6}");
Check(events[^1] == (1u, -4, 6, 0), "relative movement preserves direction");
Apply("{\"type\":\"scroll\",\"dx\":120,\"dy\":-120}");
Check(events[^2].flags == 0x800 && events[^2].data == -120 && events[^1].flags == 0x1000, "two-axis scrolling uses correct native flags");
session.Release(); var released = events.Count;
Check(events[^1].flags == 4, "disconnect releases held left button");
session.Release(); Check(events.Count == released, "release does not disturb unowned physical buttons");
try { Apply("{\"type\":\"move\",\"dx\":9999,\"dy\":0}"); throw new Exception("Accepted bad delta"); } catch (ArgumentException) { checks++; }
Apply("{\"type\":\"zoom\",\"steps\":2}");
var batch = batches[^1];
Check(batch.Length == 3 && batch[0].type == 1 && batch[0].value.keyboard.key == 0xA2 && batch[0].value.keyboard.flags == 0, "zoom presses left Ctrl first");
Check(batch[1].type == 0 && batch[1].value.mouse.flags == 0x0800 && batch[1].value.mouse.data == 240, "zoom emits complete wheel notches");
Check(batch[2].type == 1 && batch[2].value.keyboard.key == 0xA2 && batch[2].value.keyboard.flags == 2, "Ctrl is released within the same batch");
controlHeld = true; Apply("{\"type\":\"zoom\",\"steps\":-1}");
Check(batches[^1].Length == 1 && unchecked((int)batches[^1][0].value.mouse.data) == -120, "physical Ctrl is preserved and negative zoom reverses wheel");
controlHeld = false;
foreach (var invalid in new[] { 0, 9, -9 })
{
    try { Apply($"{{\"type\":\"zoom\",\"steps\":{invalid}}}"); throw new Exception("Accepted bad zoom"); } catch (ArgumentException) { checks++; }
}
sendResults.Enqueue(1);
try { zoom.Apply(1); throw new Exception("Accepted partial injection"); } catch (System.ComponentModel.Win32Exception) { checks++; }
Check(batches[^1].Length == 1 && batches[^1][0].value.keyboard.flags == 2, "partial injection immediately releases owned Ctrl");
sendResults.Enqueue(2); sendResults.Enqueue(0);
try { zoom.Apply(1); throw new Exception("Accepted failed cleanup"); } catch (System.ComponentModel.Win32Exception) { checks++; }
var beforeRetry = batches.Count; session.Release();
Check(batches.Count == beforeRetry + 1 && batches[^1][0].value.keyboard.flags == 2, "session teardown retries a failed Ctrl release");
var afterRetry = batches.Count; session.Release();
Check(batches.Count == afterRetry, "successful cleanup never releases an unowned Ctrl");
sendResults.Enqueue(0); var beforeBlocked = batches.Count;
try { zoom.Apply(1); throw new Exception("Accepted blocked input"); } catch (System.ComponentModel.Win32Exception) { checks++; }
Check(batches.Count == beforeBlocked + 1, "fully blocked input does not release unrelated keys");
using var signature = JsonDocument.Parse("{\"strokes\":[[[0.1,0.2],[0.8,0.2]],[[0.5,0.7]]],\"color\":\"blue\"}");
var typing = new RemoteKeyboard(inputs => { batches.Add(inputs); return sendResults.Count > 0 ? sendResults.Dequeue() : (uint)inputs.Length; }, () => 5);
typing.Text("A🙂é");
Check(batches[^1].Length == 8, "Unicode injection includes both UTF-16 emoji surrogates");
Check(batches[^1].Where((_, i) => i % 2 == 0).Select(i => (char)i.value.keyboard.scan).SequenceEqual("A🙂é"), "Unicode preserves exact UTF-16 content");
Check(batches[^1].Where((_, i) => i % 2 == 1).All(i => i.value.keyboard.flags == 6), "every Unicode packet has a key-up");
typing.Press("Backspace");
Check(batches[^1][0].value.keyboard.key == 8 && batches[^1][1].value.keyboard.flags == 2, "Backspace is a complete key press");
try { typing.Press("Control"); throw new Exception("Accepted unsafe key"); } catch (ArgumentException) { checks++; }
try { typing.Text("\ud800"); throw new Exception("Accepted broken surrogate"); } catch (System.Text.EncoderFallbackException) { checks++; }
sendResults.Enqueue(1);
try { typing.Text("a"); throw new Exception("Accepted partial text"); } catch (System.ComponentModel.Win32Exception) { checks++; }
Check(batches[^1].Length == 1 && batches[^1][0].value.keyboard.flags == 6, "partial Unicode injection releases its packet");
using var bitmap = Signature.Render(signature.RootElement);
string? copied = null;
typing.Paste("first\nsecond\t🙂", () => true, text => copied = text);
Check(copied == "first\nsecond\t🙂", "clipboard paste preserves newlines, tabs and emoji without generating Enter presses");
Check(batches[^2].Select(i => i.value.keyboard.key).SequenceEqual(new ushort[] {17, 86, 86, 17}), "paste sends Ctrl+V as one bounded batch");
Check(batches[^1].All(i => i.value.keyboard.flags == 2), "paste always releases modifiers");
var beforePaste = batches.Count; copied = null;
try { typing.Paste("blocked", () => false, text => copied = text); throw new Exception("Accepted stale focus"); } catch (InvalidOperationException) { checks++; }
Check(copied == null && batches.Count == beforePaste, "stale target neither copies nor types");
var focusValid = true;
try { typing.Paste("race", () => focusValid, _ => focusValid = false); throw new Exception("Accepted changed focus"); } catch (InvalidOperationException) { checks++; }
Check(batches.Count == beforePaste, "focus is rechecked after clipboard work");
foreach (var invalid in new[] { "", new string('x', 32769), "bad\0text" }) {
    try { RemoteKeyboard.ValidatePaste(invalid); throw new Exception("Accepted invalid paste"); } catch (ArgumentException) { checks++; }
}
try { RemoteKeyboard.ValidatePaste("\ud800"); throw new Exception("Accepted broken paste surrogate"); } catch (System.Text.EncoderFallbackException) { checks++; }
RemoteKeyboard.ValidatePaste(new string('x', 32768)); Check(true, "bounded large clipboard item is accepted");
Check(bitmap.Width == 1600 && bitmap.Height == 600, "export dimensions are stable");
Check(bitmap.GetPixel(0, 0).A == 0, "background is transparent");
Check(bitmap.GetPixel(400, 120).A > 0 && bitmap.GetPixel(400, 120).B > bitmap.GetPixel(400, 120).R, "blue stroke renders at expected position");
Check(bitmap.GetPixel(800, 419).A > 0, "single-point strokes render");
using var png = new MemoryStream(); bitmap.Save(png, System.Drawing.Imaging.ImageFormat.Png);
Check(png.ToArray().Take(8).SequenceEqual(new byte[] {137, 80, 78, 71, 13, 10, 26, 10}), "export is real PNG");
Console.WriteLine($"{checks} assertions\nNATIVE INPUT CHECKS OK (no desktop input injected)");
