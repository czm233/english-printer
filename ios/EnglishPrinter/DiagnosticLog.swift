import Foundation

// Metadata only. Never pass request/response bodies, headers, URLs, errors or user text.
final class DiagnosticLog: @unchecked Sendable {
    static let shared = DiagnosticLog()
    #if DEBUG
    static let verbose = true
    #else
    static let verbose = false
    #endif
    static let events: Set<String> = ["app.start","app.active","app.background","app.terminate","app.memory_warning","app.previous_session","app.stall","app.thermal","web.ready","web.error","web.rejection","web.long_task","web.action","web.navigation","web.visibility","web.terminated","web.load_error","bridge.start","bridge.end","bridge.error","bridge.delivery_error","model.start","model.headers","model.first_text","model.complete","model.error","model.cancel","model.background_expired","printer.start","printer.stage","printer.end","printer.error","printer.disconnected","printer.bluetooth","speech.start","speech.end","speech.error","metric.crash","metric.hang","metric.cpu","metric.disk","metric.summary","diagnostic.test","history.read","history.write"]
    static let tokens: Set<String> = ["native","web","server","active","inactive","background","unknown","clean","unclosed","chat","print","settings","label","model","start","connect","disconnect","status","render","sending","sent","printed","unknown_result","duplicate","request","config","translation","dictionary","history","cancelChat","speechStart","speechStop","speechCancel","navigation","chat_fetch","headers","stream","tools","complete","timeout","cancelled","expired","network","app","webkit","posix","cocoa","other","not-allowed","service-not-allowed","audio-capture","Error","TypeError","RangeError","ReferenceError","SyntaxError","URIError","EvalError","AbortError","UnhandledRejection","resource","js","nominal","fair","serious","critical"]
    static let sources: Set<String> = ["index.html","app.js","assistant.js","chat-store.js","choice-cards.js","ios-bridge.js","custom-print.js","print-cards.js","phonetics.js","sse.js","chat-input.js","interactions.js","markdown.js","pronunciation-audio.js","diagnostics.js","diagnostic-schema.js","marked.umd.js","purify.min.js"]
    static let actions: Set<String> = ["clear","speak","customPrint","printAgain","translatePrint","settingsTab","printTab","chatTab","chatBack","newChat","chatHistory","sendChat","retryChat","saveConfig","connect","confirmCustom","cancelCustom","clearCustom","retryMeaning","speakCustom","speakSample","voiceToggle","holdToTalk","choosePhoto","removePhoto","labelSettingsTab","modelSettingsTab","confirm_card","choose_option","audio"]
    static func clean(_ fields: [String:Any]) -> [String:Any] {
        var result: [String:Any] = [:]
        let numbers: Set<String> = ["ms","first_ms","count","bytes","characters","tools","status","code","line","column","queue","dropped","pending","state_code","signal","exception","report_start","report_end","duration_ms","peak_mb","foreground_exits","background_exits"]
        for (key,value) in fields {
            if key == "frames",let frames = value as? [[String:Any]] {
                result[key] = frames.prefix(32).compactMap { frame -> [String:Any]? in
                    guard let raw = frame["uuid"] as? String,let uuid = UUID(uuidString:raw),let offset = frame["offset"] as? NSNumber,offset.doubleValue.isFinite,offset.doubleValue >= 0 else {return nil}
                    return ["uuid":uuid.uuidString,"offset":offset]
                };continue
            }
            if numbers.contains(key), let number = value as? NSNumber, number.doubleValue.isFinite {result[key] = max(-1_000_000_000_000,min(1_000_000_000_000,number.doubleValue))}
            else if ["request","previous","parent"].contains(key),let value = value as? String,let uuid = UUID(uuidString:value) {result[key] = uuid.uuidString}
            else if ["stage","kind","page","state","reason","domain","error_type"].contains(key),let value = value as? String,tokens.contains(value) {result[key] = value}
            else if key == "source",let value = value as? String,sources.contains(value) {result[key] = value}
            else if key == "action",let value = value as? String,actions.contains(value) {result[key] = value}
        }
        return result
    }
    let session = UUID().uuidString
    let folder: URL
    private let queue = DispatchQueue(label:"englishprinter.diagnostics",qos:.utility)
    private let slots = DispatchSemaphore(value:128)
    private let lock = NSLock()
    private var dropped = 0
    private let maxBytes: Int, fileCount: Int, retention: TimeInterval, debug: Bool
    private let metadata: [String:Any]
    init(folder: URL? = nil, debug: Bool = DiagnosticLog.verbose, maxBytes: Int? = nil, fileCount: Int? = nil) {
        self.folder = folder ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Diagnostics",isDirectory:true)
        self.debug = debug;self.maxBytes = maxBytes ?? (debug ? 1_048_576 : 262_144);self.fileCount = fileCount ?? (debug ? 5 : 2);retention = Double(debug ? 7 : 3)*86400
        metadata = ["version":Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "test","build":Bundle.main.object(forInfoDictionaryKey:"CFBundleVersion") as? String ?? "test","mode":debug ? "debug":"release","os":ProcessInfo.processInfo.operatingSystemVersionString]
    }
    func record(_ event: String, level: String = "info", _ fields: [String:Any] = [:]) {
        guard Self.events.contains(event),["debug","info","warning","error"].contains(level),debug || ["warning","error"].contains(level) || event == "app.start" else {return}
        guard slots.wait(timeout:.now()) == .success else {lock.lock();dropped += 1;lock.unlock();return}
        let clean = Self.clean(fields),time = Date(),uptime = ProcessInfo.processInfo.systemUptime
        queue.async { [self] in
            defer {slots.signal()}
            var row = metadata;row["schema"] = 1;row["time"] = ISO8601DateFormatter().string(from:time);row["uptime_ms"] = Int(uptime*1000);row["session"] = session;row["event"] = event;row["level"] = level;row["fields"] = clean
            lock.lock();let lost = dropped;dropped = 0;lock.unlock();if lost > 0 {row["dropped"] = lost}
            do {
                try prepare(time)
                let data = try JSONSerialization.data(withJSONObject:row,options:[.sortedKeys])+Data([10])
                let file = folder.appendingPathComponent("events.jsonl")
                let size = (try? file.resourceValues(forKeys:[.fileSizeKey]).fileSize) ?? 0
                if size+data.count > maxBytes {try rotate()}
                if !FileManager.default.fileExists(atPath:file.path) {FileManager.default.createFile(atPath:file.path,contents:nil,attributes:[.posixPermissions:0o600])}
                #if os(iOS)
                try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:file.path)
                #endif
                let handle = try FileHandle(forWritingTo:file);defer {try? handle.close()};try handle.seekToEnd();try handle.write(contentsOf:data)
                if ["warning","error"].contains(level) {try handle.synchronize()}
            } catch {lock.lock();dropped += 1;lock.unlock()} // Logging must not fail the operation or recurse.
        }
    }
    private func prepare(_ now: Date) throws {
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        var dir = folder;var values = URLResourceValues();values.isExcludedFromBackup = true;try dir.setResourceValues(values)
        for i in fileCount..<5 {try? FileManager.default.removeItem(at:folder.appendingPathComponent("events.\(i).jsonl"))}
        for i in 0..<fileCount {
            let file = folder.appendingPathComponent(i == 0 ? "events.jsonl":"events.\(i).jsonl")
            if let date = try? file.resourceValues(forKeys:[.contentModificationDateKey]).contentModificationDate,now.timeIntervalSince(date)>retention {try? FileManager.default.removeItem(at:file)}
        }
    }
    private func rotate() throws {
        let fm = FileManager.default
        try? fm.removeItem(at:folder.appendingPathComponent("events.\(fileCount-1).jsonl"))
        if fileCount>1 {for i in stride(from:fileCount-2,through:0,by:-1) {
            let old = folder.appendingPathComponent(i == 0 ? "events.jsonl":"events.\(i).jsonl")
            if fm.fileExists(atPath:old.path) {try fm.moveItem(at:old,to:folder.appendingPathComponent("events.\(i+1).jsonl"))}
        }}
    }
    func flush() { queue.sync {} } // Tests / orderly shutdown only; never on the UI hot path.
    func failure(_ event: String, error: Error, fields: [String:Any] = [:]) {
        let e = error as NSError;var data = fields;data["code"] = e.code
        data["domain"] = [NSURLErrorDomain:"network","EnglishPrinter":"app",NSCocoaErrorDomain:"cocoa",NSPOSIXErrorDomain:"posix","WKErrorDomain":"webkit"][e.domain] ?? "other"
        record(event,level:"error",data)
    }
    static func elapsed(_ start: TimeInterval) -> Int {Int((ProcessInfo.processInfo.systemUptime-start)*1000)}
}
