import UIKit
import CoreText
import JavaScriptCore

@MainActor final class PrinterCodec {
    let context = JSContext()!
    init() {
        if let url = Bundle.main.url(forResource:"lpapi",withExtension:"cjs"), let script = try? String(contentsOf:url,encoding:.utf8) {context.evaluateScript(script)}
        context.evaluateScript("""
        var rx=[], starts=[];
        function command(n){return Array.from(new LPAPI.DzPackage(n).getBytes())}
        function parse(bytes){return LPAPI.DeviceConnection.parsePackageList(new Uint8Array(bytes),rx,starts).map(p=>({cmd:p.cmd,data:Array.from(p.Data),value:p.cmd===119?p.popEBV():p.popShort()}))}
        function reset(){rx=[];starts=[]}
        function encode(rgba,key,width,height){return LPAPI.PrintPackage.encodeImageData({imageData:{width,height,data:new Uint8ClampedArray(rgba)},orientation:90,gapType:2,gapLength:3,printDarkness:255,printSpeed:255,pageKey:key,enableSuperBitmap:false},{printerDPI:203,printerWidth:96,hardwareFlags:0,softwareFlags:0}).flatMap(p=>Array.from(p))}
        """)
    }
    func command(_ n: Int) throws -> Data { try bytes("command",[n]) }
    func parse(_ data: Data) -> [[String:Any]] {context.objectForKeyedSubscript("parse").call(withArguments:[Array(data)])?.toArray() as? [[String:Any]] ?? []}
    func reset() {context.objectForKeyedSubscript("reset").call(withArguments:[])}
    func bytes(_ method: String,_ args: [Any]) throws -> Data {
        context.exception = nil
        guard let numbers = context.objectForKeyedSubscript(method).call(withArguments:args)?.toArray() as? [NSNumber], context.exception == nil, !numbers.isEmpty else {throw appError("打印指令生成失败。")}
        return Data(numbers.map { $0.uint8Value })
    }
    func render(_ body: [String:Any], key: Int) throws -> Data {
        guard let word = body["word"] as? String, let rawIpa = body["ipa"] as? String, !word.isEmpty, !rawIpa.isEmpty, word.count <= 120, rawIpa.count <= 240, let settings = body["settings"] as? [String:Double] else {throw appError("英文或音标内容无效。")}
        let inner = rawIpa.trimmingCharacters(in:.whitespacesAndNewlines).trimmingCharacters(in:CharacterSet(charactersIn:"/")).components(separatedBy:CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn:";；"))).filter { !$0.isEmpty }.joined(separator:" ")
        guard !inner.isEmpty else {throw appError("音标内容无效。")}
        let ipa = "/" + inner + "/"
        let ranges:[String:(Double,Double,Double)] = ["font":(6,12,0.5),"border":(0,0.5,0.1),"top":(0,4,0.5),"bottom":(0,4,0.5),"left":(0,5,0.5),"right":(0,5,0.5)]
        for (name,(low,high,step)) in ranges {guard let value = settings[name], value.isFinite, value >= low, value <= high, abs(value / step - (value / step).rounded()) < 0.00001 else {throw appError("标签参数无效。")}}
        let scale = 203.0 / 25.4, top = settings["top"]!, left = settings["left"]!, bottom = settings["bottom"]!, right = settings["right"]!, border = settings["border"]!
        let labelWidth = settings["width"] ?? 30, labelHeight = settings["height"] ?? 12
        guard labelWidth.isFinite,labelHeight.isFinite,(10...100).contains(labelWidth),(6...12).contains(labelHeight),
              labelWidth*2 == (labelWidth*2).rounded(),labelHeight*2 == (labelHeight*2).rounded(),
              labelWidth > left+right,labelHeight > top+bottom else {throw appError("标签尺寸或边距无效。")}
        let pixelWidth = Int((labelWidth*8).rounded()), pixelHeight = Int((labelHeight*8).rounded())
        let width = (labelWidth-left-right)*scale, height = (labelHeight-top-bottom)*scale/2
        let font = UIFont(name:"Arial",size:settings["font"]!*203/72) ?? UIFont.systemFont(ofSize:settings["font"]!*203/72)
        let attrs: [NSAttributedString.Key:Any] = [.font:font,.foregroundColor:UIColor.black]
        for text in [word,ipa] {
            let string = NSAttributedString(string:text,attributes:attrs), size = (text as NSString).size(withAttributes:attrs)
            let glyph = CTLineGetBoundsWithOptions(CTLineCreateWithAttributedString(string),.useGlyphPathBounds)
            if size.width > width-border*scale || glyph.height > height-border*scale {throw appError("内容超出标签，请减小字号或缩短文字。")}
        }
        let format = UIGraphicsImageRendererFormat();format.scale = 1;format.opaque = true
        let image = UIGraphicsImageRenderer(size:CGSize(width:pixelWidth,height:pixelHeight),format:format).image { renderer in
            UIColor.white.setFill();renderer.fill(CGRect(x:0,y:0,width:pixelWidth,height:pixelHeight))
            for (index,text) in [word,ipa].enumerated() {
                let rect = CGRect(x:left*scale,y:top*scale+Double(index)*height,width:width,height:height)
                let size = (text as NSString).size(withAttributes:attrs)
                renderer.cgContext.saveGState();renderer.cgContext.clip(to:rect)
                (text as NSString).draw(at:CGPoint(x:rect.midX-size.width/2,y:rect.midY-size.height/2),withAttributes:attrs)
                renderer.cgContext.restoreGState()
            }
            if border > 0 {UIColor.black.setStroke();let inset = border*scale/2;let path = UIBezierPath(rect:CGRect(x:left*scale+inset,y:top*scale+inset,width:width-2*inset,height:2*height-2*inset));path.lineWidth = border*scale;path.stroke()}
        }
        var rgba = [UInt8](repeating:255,count:pixelWidth*pixelHeight*4)
        let bitmap = CGContext(data:&rgba,width:pixelWidth,height:pixelHeight,bitsPerComponent:8,bytesPerRow:pixelWidth*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
        bitmap.draw(image.cgImage!,in:CGRect(x:0,y:0,width:pixelWidth,height:pixelHeight))
        return try bytes("encode",[rgba,key,pixelWidth,pixelHeight])
    }
}
