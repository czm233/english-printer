import AppKit
import CoreText

struct Options: Decodable { let font, border, top, bottom, left, right: Double; let width, height: Double? }
struct Label: Decodable { let word, ipa: String; let settings: Options }
func render() throws {
    let label = try JSONDecoder().decode(Label.self, from: FileHandle.standardInput.readDataToEndOfFile())
    let c = label.settings, scale = 203.0 / 25.4, width = Int(((c.width ?? 30) * 8).rounded()), height = Int(((c.height ?? 12) * 8).rounded())
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: width * 4, bitsPerPixel: 32)!
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSColor.white.setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill()
    let font = NSFont(name: "Arial", size: c.font * 203 / 72)!
    let rowHeight = ((c.height ?? 12) - c.top - c.bottom) * scale / 2
    let boxWidth = ((c.width ?? 30) - c.left - c.right) * scale
    for (index, text) in [label.word, label.ipa].enumerated() {
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.black]
        let string = NSAttributedString(string: text, attributes: attrs)
        let glyphs = CTLineGetBoundsWithOptions(CTLineCreateWithAttributedString(string), [.useGlyphPathBounds])
        let size = (text as NSString).size(withAttributes: attrs)
        if size.width > boxWidth - c.border * scale || glyphs.height > rowHeight - c.border * scale {
            throw NSError(domain: "Label", code: 1, userInfo: [NSLocalizedDescriptionKey: "内容超出标签，请减小字号或缩短文字。"])
        }
        let box = NSRect(x: c.left * scale, y: c.bottom * scale + Double(index == 0 ? 1 : 0) * rowHeight, width: boxWidth, height: rowHeight)
        NSGraphicsContext.saveGraphicsState(); box.clip()
        (text as NSString).draw(at: NSPoint(x: box.midX - size.width / 2, y: box.midY - size.height / 2), withAttributes: attrs)
        NSGraphicsContext.restoreGraphicsState()
    }
    if c.border > 0 {
        NSColor.black.setStroke()
        let inset = c.border * scale / 2
        let border = NSBezierPath(rect: NSRect(x: c.left * scale + inset, y: c.bottom * scale + inset, width: boxWidth - 2 * inset, height: rowHeight * 2 - 2 * inset))
        border.lineWidth = c.border * scale; border.stroke()
    }
    context.flushGraphics()
    let rgba = Data(bytes: bitmap.bitmapData!, count: width * height * 4)
    let png = bitmap.representation(using: .png, properties: [:])!
    let output = try JSONSerialization.data(withJSONObject: ["width": width, "height": height, "rgba": rgba.base64EncodedString(), "png": png.base64EncodedString()])
    FileHandle.standardOutput.write(output)
}
do { try render() } catch { fputs(error.localizedDescription + "\n", stderr); exit(2) }
