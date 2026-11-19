// Render the existing four-square Tara brand as an opaque iOS app icon.
import AppKit
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024,
                             bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false,
                             isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
NSColor(srgbRed: 0.06, green: 0.12, blue: 0.14, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: 1024, height: 1024)).fill()
let colors: [NSColor] = [
    NSColor(srgbRed: 0.51, green: 0.91, blue: 0.75, alpha: 1),
    NSColor(srgbRed: 0.78, green: 0.98, blue: 0.91, alpha: 1),
    NSColor(srgbRed: 0.50, green: 0.73, blue: 1, alpha: 1),
    NSColor(srgbRed: 0.41, green: 0.85, blue: 0.80, alpha: 1)
]
for i in 0..<4 {
    colors[i].setFill()
    NSBezierPath(roundedRect: NSRect(x: CGFloat(128 + (i % 2) * 420), y: CGFloat(548 - (i / 2) * 420),
                                   width: 348, height: 348), xRadius: 70, yRadius: 70).fill()
}
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"))
