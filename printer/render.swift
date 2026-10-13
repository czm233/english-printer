import AppKit
let word=CommandLine.arguments.count>1 ? CommandLine.arguments[1] : "hello"
let ipa=CommandLine.arguments.count>2 ? CommandLine.arguments[2] : "həˈləʊ"
let dpi=203.0, scale=203.0/25.4
let width=240, height=96
let bitmap=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:width,pixelsHigh:height,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:width*4,bitsPerPixel:32)!
let context=NSGraphicsContext(bitmapImageRep:bitmap)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current=context
NSColor.white.setFill(); NSRect(x:0,y:0,width:width,height:height).fill()
let font=NSFont(name:"Arial",size:10*dpi/72)!
for (idx,text) in [word,ipa].enumerated() {
 let attrs:[NSAttributedString.Key:Any]=[.font:font,.foregroundColor:NSColor.black]
 let size=(text as NSString).size(withAttributes:attrs)
 guard size.width <= 28*scale else { fputs("Text too wide for 10pt; shorten text.\n",stderr); exit(2) }
 let box=NSRect(x:scale,y:Double(idx == 0 ? 6 : 2)*scale,width:28*scale,height:4*scale)
 NSGraphicsContext.saveGraphicsState(); box.clip()
 (text as NSString).draw(at:NSPoint(x:box.midX-size.width/2,y:box.midY-size.height/2),withAttributes:attrs)
 NSGraphicsContext.restoreGraphicsState()
}
context.flushGraphics(); NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"preview.png"))
try Data(bytes:bitmap.bitmapData!,count:width*height*4).write(to:URL(fileURLWithPath:"label.rgba"))
print("Rendered 30x12mm, 10pt, Arial; two 28x4mm centered boxes")
