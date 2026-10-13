import Foundation
import Security
import UIKit

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
@MainActor final class ModelService {
    let redirect = NoRedirect()
    lazy var session = URLSession(configuration:.ephemeral,delegate:redirect,delegateQueue:nil)
    var tasks: [String:Task<Void,Never>] = [:]
    var active: Bool { !tasks.isEmpty }
    var emit: ((String,[String:Any]) -> Void)?
    func start(id: String, body: [String:Any]) throws {
        guard !active else {throw appError("已有请求正在处理，请稍后重试。")}
        let config = try ModelConfig.load(); guard !config.apiKey.isEmpty else {throw appError("请先在设置中配置大模型。",code:5113)}
        let url = try ModelConfig.endpoint(config.url)
        guard let messages = body["messages"] as? [[String:Any]], !messages.isEmpty, messages.count <= 40, messages.last?["role"] as? String == "user" else {throw appError("对话格式无效，请新建对话。")}
        guard let agentFile = BundleScheme.resource("agent-config.json"), var requestBody = try JSONSerialization.jsonObject(with:Data(contentsOf:agentFile)) as? [String:Any] else {throw appError("打印助手配置缺失。",code:5112)}
        guard let optionsFile = BundleScheme.resource("model-options.json"), let modelOptions = try JSONSerialization.jsonObject(with:Data(contentsOf:optionsFile)) as? [String:[String:Any]] else {throw appError("模型参数配置缺失。",code:5112)}
        // Only explicitly supported model IDs get provider-specific options.
        for (key,value) in config.requestOptions(modelOptions) {requestBody[key] = value}
        requestBody["model"] = config.model;requestBody["max_tokens"] = 2048;requestBody["stream"] = true;requestBody["messages"] = messages
        let data = try JSONSerialization.data(withJSONObject:requestBody)
        guard data.count <= 17_000_000 else {throw appError("对话中的照片过多，请新建对话。")}
        var req = URLRequest(url:url); req.httpMethod = "POST"; req.httpBody = data; req.timeoutInterval = 120
        req.setValue("application/json",forHTTPHeaderField:"Content-Type"); req.setValue(config.apiKey,forHTTPHeaderField:"x-api-key");req.setValue("2023-06-01",forHTTPHeaderField:"anthropic-version")
        let started = ProcessInfo.processInfo.systemUptime
        DiagnosticLog.shared.record("model.start",["request":id,"count":messages.count,"bytes":data.count])
        var expired = false
        var backgroundID = UIBackgroundTaskIdentifier.invalid
        backgroundID = UIApplication.shared.beginBackgroundTask(withName:"Model reply") { [weak self] in
            expired = true
            DiagnosticLog.shared.record("model.background_expired",level:"warning",["request":id,"ms":DiagnosticLog.elapsed(started)])
            self?.tasks[id]?.cancel()
            if backgroundID != .invalid {UIApplication.shared.endBackgroundTask(backgroundID);backgroundID = .invalid}
        }
        tasks[id] = Task {
            var stage = "headers",firstText = false
            defer {
                tasks[id] = nil
                if backgroundID != .invalid {UIApplication.shared.endBackgroundTask(backgroundID);backgroundID = .invalid}
            }
            do {
                let (bytes,response) = try await session.bytes(for:req)
                guard let http = response as? HTTPURLResponse else {throw appError("模型服务响应无效。",code:5101)}
                DiagnosticLog.shared.record("model.headers",level:(200..<300).contains(http.statusCode) ? "info":"error",["request":id,"status":http.statusCode,"ms":DiagnosticLog.elapsed(started)])
                guard (200..<300).contains(http.statusCode) else {
                    let hints = [400:"请检查模型是否支持当前消息和照片。",401:"API Key 无效或已过期。",403:"API Key 无权访问该模型。",404:"接口或模型不存在。",429:"请求过于频繁或额度不足。"]
                    throw appError("模型服务返回 \(http.statusCode)：" + (hints[http.statusCode] ?? "请检查接口或稍后重试。"))
                }
                guard http.value(forHTTPHeaderField:"Content-Type")?.contains("text/event-stream") == true else {throw appError("模型未返回流式响应，请检查 Anthropic 协议。",code:5102)}
                stage = "stream"
                var eventLines: [String] = [], total = 0, stopReason: String?, lastBlock: Int?
                var lineBytes: [UInt8] = [], toolCount = 0, toolBytes = 0
                for try await byte in bytes {
                    try Task.checkCancellation()
                    if byte != 10 {lineBytes.append(byte);guard lineBytes.count <= 262144 else {throw appError("模型流式事件过长。",code:5103)};continue}
                    if lineBytes.last == 13 {lineBytes.removeLast()}
                    guard let line = String(bytes:lineBytes,encoding:.utf8) else {throw appError("模型文本编码无效。",code:5104)};lineBytes.removeAll(keepingCapacity:true)
                    if line.hasPrefix("data:") {eventLines.append(String(line.dropFirst(5)).trimmingCharacters(in:.whitespaces));continue}
                    if !line.isEmpty || eventLines.isEmpty {continue}
                    let raw = eventLines.joined(separator:"\n");eventLines.removeAll()
                    guard let d = try JSONSerialization.jsonObject(with:Data(raw.utf8)) as? [String:Any] else {throw appError("模型流式格式无效。",code:5105)}
                    let type = d["type"] as? String, delta = d["delta"] as? [String:Any], block = d["content_block"] as? [String:Any]
                    if type == "error" {throw appError("模型服务中断，请稍后重试。",code:5106)}
                    var text: String?
                    if type == "content_block_start", block?["type"] as? String == "text" {text = block?["text"] as? String}
                    if type == "content_block_delta", delta?["type"] as? String == "text_delta" {text = delta?["text"] as? String}
                    if var part = text, !part.isEmpty {
                        let index = d["index"] as? Int
                        if lastBlock != nil && index != lastBlock {part = "\n" + part};lastBlock = index; total += part.count
                        guard total <= 64000 else {throw appError("回复过长，请缩小问题范围。",code:5107)}
                        if !firstText {firstText = true;DiagnosticLog.shared.record("model.first_text",level:DiagnosticLog.elapsed(started)>5000 ? "warning":"info",["request":id,"first_ms":DiagnosticLog.elapsed(started)])}
                        emit?(id,["type":"delta","text":part])
                    }
                    if type == "content_block_start", block?["type"] as? String == "tool_use" {
                        toolCount += 1;guard toolCount <= 12 else {throw appError("一次最多生成 12 张打印卡片。",code:5108)}
                        emit?(id,["type":"tool_start","index":d["index"] ?? -1,"id":block?["id"] ?? "","name":block?["name"] ?? "","input":block?["input"] ?? [:]])
                    }
                    if type == "content_block_delta", delta?["type"] as? String == "input_json_delta" {
                        let part = delta?["partial_json"] as? String ?? "";toolBytes += part.utf8.count
                        guard toolBytes <= 49152 else {throw appError("打印参数过长。",code:5109)}
                        emit?(id,["type":"tool_delta","index":d["index"] ?? -1,"json":part])
                    }
                    if type == "content_block_stop" {emit?(id,["type":"tool_end","index":d["index"] ?? -1])}
                    if type == "message_delta" {stopReason = delta?["stop_reason"] as? String}
                    if type == "message_stop" {
                        guard total > 0 || toolCount > 0 else {throw appError("模型未返回文字内容。",code:5110)}
                        DiagnosticLog.shared.record("model.complete",level:DiagnosticLog.elapsed(started)>30000 ? "warning":"info",["request":id,"ms":DiagnosticLog.elapsed(started),"characters":total,"tools":toolCount])
                        emit?(id,["type":"done","stopReason":stopReason as Any? ?? NSNull()]); return
                    }
                }
                throw appError("回复中途断开，请重试。",code:5111)
            } catch {
                DiagnosticLog.shared.failure("model.error",error:error,fields:["request":id,"stage":stage,"ms":DiagnosticLog.elapsed(started),"reason":expired ? "expired" : Task.isCancelled ? "cancelled":"other"])
                emit?(id,["type":"error","message":expired ? "后台运行时间已结束，可重试或继续发送消息。" : Task.isCancelled ? "已停止，可重试。" : ((error as NSError).domain == "EnglishPrinter" ? error.localizedDescription : "无法连接模型服务或请求超时，请检查网络。")])
            }
        }
    }
    func cancel(_ id: String) { DiagnosticLog.shared.record("model.cancel",["request":id]);tasks[id]?.cancel() }
}
