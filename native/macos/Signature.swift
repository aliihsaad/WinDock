// Signature export, mirroring native/win/Signature.cs: validated strokes in,
// a transparent 1600x600 PNG out, optionally pasted into the frontmost app.

import AppKit
import ImageIO
import UniformTypeIdentifiers

let signatureWidth = 1600
let signatureHeight = 600
private let maxBody = 65536

struct Signature {
    var strokes: [[CGPoint]]
    var color: String
}

/// Validate everything before allocating an image or creating any file.
func parseSignature(_ body: Data) throws -> Signature {
    let invalid = fail("Invalid signature.")
    guard let any = try? JSONSerialization.jsonObject(with: body, options: []),
          let object = any as? [String: Any], Set(object.keys) == ["strokes", "color"],
          let color = object["color"] as? String, ["black", "blue"].contains(color),
          let strokes = object["strokes"] as? [Any], (1...64).contains(strokes.count) else { throw invalid }
    var count = 0
    var parsed = [[CGPoint]]()
    for stroke in strokes {
        guard let points = stroke as? [Any], !points.isEmpty else { throw invalid }
        count += points.count
        if count > 2048 { throw invalid }
        var line = [CGPoint]()
        for point in points {
            guard let pair = point as? [Any], pair.count == 2, let x = jsonNumber(pair[0]), let y = jsonNumber(pair[1]),
                  x.isFinite, y.isFinite, (0...1).contains(x), (0...1).contains(y) else { throw invalid }
            line.append(CGPoint(x: x, y: y))
        }
        parsed.append(line)
    }
    return Signature(strokes: parsed, color: color)
}

func render(_ signature: Signature) throws -> CGImage {
    guard let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: signatureWidth, height: signatureHeight, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw fail("Could not allocate the signature image.")
    }
    context.clear(CGRect(x: 0, y: 0, width: signatureWidth, height: signatureHeight))
    let ink = signature.color == "blue"
        ? CGColor(srgbRed: 30 / 255, green: 64 / 255, blue: 175 / 255, alpha: 1)
        : CGColor(srgbRed: 24 / 255, green: 24 / 255, blue: 27 / 255, alpha: 1)
    context.setStrokeColor(ink)
    context.setFillColor(ink)
    context.setLineWidth(4)
    context.setLineCap(.round)
    context.setLineJoin(.round)
    context.setShouldAntialias(true)
    // Strokes arrive with y down; Core Graphics draws with y up.
    func scale(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x * CGFloat(signatureWidth - 1), y: CGFloat(signatureHeight - 1) - point.y * CGFloat(signatureHeight - 1))
    }
    for stroke in signature.strokes {
        if stroke.count == 1 {
            let dot = scale(stroke[0])
            context.fillEllipse(in: CGRect(x: dot.x - 2, y: dot.y - 2, width: 4, height: 4))
            continue
        }
        context.beginPath()
        context.move(to: scale(stroke[0]))
        for point in stroke.dropFirst() { context.addLine(to: scale(point)) }
        context.strokePath()
    }
    guard let image = context.makeImage() else { throw fail("Could not render the signature.") }
    return image
}

func encodePNG(_ image: CGImage) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else {
        throw fail("Could not encode the signature.")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw fail("Could not encode the signature.") }
    return data as Data
}

func timestamp(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd-HHmmss"
    return formatter.string(from: date)
}

func randomHex() -> String {
    (0..<16).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
}

private func readBody() throws -> Data {
    var body = Data()
    let input = FileHandle.standardInput
    while body.count <= maxBody {
        let chunk = input.readData(ofLength: 4096)
        if chunk.isEmpty { break }
        body.append(chunk)
    }
    if body.count > maxBody { throw fail("Signature too large.") }
    return body
}

func saveSignature(dir: String, insert: Bool) throws {
    guard dir.hasPrefix("/") else { throw fail("The signature folder must be an absolute path.") }
    // The app that was in front when the user pressed Insert.
    let target = insert ? Focus.frontmostPid() : 0

    // Read a bounded payload from the private parent pipe, never a client path.
    let png = try encodePNG(try render(try parseSignature(try readBody())))

    // Create the WinDock folder and Signatures each with 0700; intermediate
    // directories otherwise get the default mask.
    let parent = (dir as NSString).deletingLastPathComponent
    for folder in [parent, dir] where !FileManager.default.fileExists(atPath: folder) {
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }
    let name = "Signature-\(timestamp())-\(randomHex()).png"
    let path = (dir as NSString).appendingPathComponent(name)
    let fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
    guard fd >= 0 else { throw fail("Could not create \(name): \(String(cString: strerror(errno)))") }
    defer { close(fd) }
    try png.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
        var offset = 0
        while offset < bytes.count {
            let written = write(fd, bytes.baseAddress! + offset, bytes.count - offset)
            if written < 0 { throw fail("Could not write \(name): \(String(cString: strerror(errno)))") }
            offset += written
        }
    }
    fsync(fd)

    var pasteRequested = false
    if insert {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        guard let image = NSImage(data: png), pasteboard.writeObjects([image]), pasteboard.data(forType: .png) != nil || pasteboard.data(forType: .tiff) != nil else {
            throw fail("Could not copy the signature to the clipboard.")
        }
        // Keep the PNG on disk and clipboard even if focus moved or paste is not possible.
        if target > 0, target == Focus.frontmostPid(), AXIsProcessTrusted() {
            do { try Keyboard.paste(); pasteRequested = true } catch { pasteRequested = false }
        }
    }
    emit([
        "type": "saved", "path": path, "name": name, "width": signatureWidth, "height": signatureHeight,
        "clipboard": insert, "pasteRequested": pasteRequested,
    ])
}
