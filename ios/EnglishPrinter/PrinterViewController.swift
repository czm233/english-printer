import UIKit
import WebKit
import UniformTypeIdentifiers

final class PrinterWebView: WKWebView {
    override var inputAccessoryView: UIView? { nil }
}

final class BundleScheme: NSObject, WKURLSchemeHandler {
    static func resource(_ path: String) -> URL? {
        guard let base = Bundle.main.resourceURL?.appendingPathComponent("web",isDirectory:true).resolvingSymlinksInPath().standardizedFileURL else {return nil}
        let url = base.appendingPathComponent(path.trimmingCharacters(in:CharacterSet(charactersIn:"/"))).resolvingSymlinksInPath().standardizedFileURL
        return url.path.hasPrefix(base.path+"/") ? url : nil
    }
    func webView(_ webView: WKWebView,start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url, let file = Self.resource(requestURL.path), let data = try? Data(contentsOf:file) else {urlSchemeTask.didFailWithError(appError("页面资源缺失。"));return}
        let mime = UTType(filenameExtension:file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        urlSchemeTask.didReceive(URLResponse(url:requestURL,mimeType:mime,expectedContentLength:data.count,textEncodingName:"utf-8"));urlSchemeTask.didReceive(data);urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView,stop urlSchemeTask: WKURLSchemeTask) {}
}
@MainActor final class PrinterViewController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate, UIScrollViewDelegate {
    static func isBundledPage(_ url: URL?) -> Bool {
        guard let url = url, url.isFileURL, let expected = BundleScheme.resource("index.html") else {return false}
        return url.resolvingSymlinksInPath().standardizedFileURL.path == expected.resolvingSymlinksInPath().standardizedFileURL.path
    }
    var web: WKWebView!
    private var lastViewport = ""
    private let bottomBackground = UIView()
    private let topBackground = UIView()
    private lazy var backGesture = UIScreenEdgePanGestureRecognizer(target:self, action:#selector(edgeBack(_:)))
    lazy var printer = NativePrinter()
    let model = ModelService(), speech = SpeechService()
    override func viewDidLoad() {
        super.viewDidLoad();view.backgroundColor = UIColor(red:0.965,green:0.973,blue:0.988,alpha:1)
        let config = WKWebViewConfiguration();config.ignoresViewportScaleLimits = false;config.setURLSchemeHandler(BundleScheme(),forURLScheme:"englishprinter")
        config.userContentController.addScriptMessageHandler(self,contentWorld:.page,name:"native")
        if let file = BundleScheme.resource("ios-bridge.js"),let script = try? String(contentsOf:file,encoding:.utf8) {config.userContentController.addUserScript(WKUserScript(source:"window.P0DiagnosticsDebug = \(DiagnosticLog.verbose);\n"+script,injectionTime:.atDocumentStart,forMainFrameOnly:true))}
        web = PrinterWebView(frame:.zero,configuration:config);web.navigationDelegate = self;web.uiDelegate = self;web.isOpaque = false;web.backgroundColor = view.backgroundColor;web.scrollView.isScrollEnabled = false;web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.delegate = self
        web.scrollView.bounces = false
        web.scrollView.bouncesZoom = false
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.inputAssistantItem.leadingBarButtonGroups = []
        web.inputAssistantItem.trailingBarButtonGroups = []
        topBackground.backgroundColor = UIColor(red:246/255,green:248/255,blue:252/255,alpha:1)
        topBackground.isUserInteractionEnabled = false
        topBackground.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(topBackground)
        NSLayoutConstraint.activate([topBackground.leadingAnchor.constraint(equalTo:view.leadingAnchor),topBackground.trailingAnchor.constraint(equalTo:view.trailingAnchor),topBackground.topAnchor.constraint(equalTo:view.topAnchor),topBackground.bottomAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor)])
        bottomBackground.backgroundColor = .white
        bottomBackground.isUserInteractionEnabled = false
        bottomBackground.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bottomBackground)
        NSLayoutConstraint.activate([bottomBackground.leadingAnchor.constraint(equalTo:view.leadingAnchor),bottomBackground.trailingAnchor.constraint(equalTo:view.trailingAnchor),bottomBackground.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.bottomAnchor),bottomBackground.bottomAnchor.constraint(equalTo:view.bottomAnchor)])
        view.addSubview(web);web.translatesAutoresizingMaskIntoConstraints = false
        backGesture.edges = .left
        backGesture.isEnabled = false
        web.addGestureRecognizer(backGesture)
        NSLayoutConstraint.activate([web.leadingAnchor.constraint(equalTo:view.leadingAnchor),web.trailingAnchor.constraint(equalTo:view.trailingAnchor),web.topAnchor.constraint(equalTo:view.safeAreaLayoutGuide.topAnchor),web.bottomAnchor.constraint(equalTo:view.keyboardLayoutGuide.topAnchor)])
        #if DEBUG
        web.isInspectable = true
        #endif
        model.emit = {[weak self] id,event in self?.emit("chat",id,event)};speech.emit = {[weak self] id,event in self?.emit("speech",id,event)}
        NotificationCenter.default.addObserver(self,selector:#selector(background),name:UIApplication.didEnterBackgroundNotification,object:nil)
        NotificationCenter.default.addObserver(self,selector:#selector(foreground),name:UIApplication.didBecomeActiveNotification,object:nil)
        if let file = BundleScheme.resource("index.html") {web.loadFileURL(file,allowingReadAccessTo:file.deletingLastPathComponent())} else {showLoadError(appError("未找到内置页面。"))}
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        publishViewport()
    }
    private func publishViewport(force: Bool = false) {
        guard let web = web, web.bounds.height > 0 else { return }
        let keyboard = view.keyboardLayoutGuide.layoutFrame.minY < view.bounds.height - view.safeAreaInsets.bottom - 1
        let payload = "{height:\(web.bounds.height),keyboard:\(keyboard)}"
        guard force || payload != lastViewport else { return }
        lastViewport = payload
        web.evaluateJavaScript("window.P0Native?.setViewport(\(payload))", completionHandler:nil)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { publishViewport(force:true);DiagnosticLog.shared.record("web.ready");flushEvents() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {DiagnosticLog.shared.record("web.terminated",level:"error",["pending":pendingEvents.count])}
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { nil }
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        // Only the page's inner message/form containers scroll, never the WK root.
        if scrollView.contentOffset != .zero { scrollView.setContentOffset(.zero, animated:false) }
    }
    @objc private func edgeBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
        guard gesture.state == .ended else { return }
        let distance = gesture.translation(in:web)
        let velocity = gesture.velocity(in:web)
        guard distance.x > 60 || (distance.x > 20 && velocity.x > 450), abs(distance.y) < distance.x else { return }
        web.evaluateJavaScript("if (!document.querySelector('dialog[open]') && !document.getElementById('chatPage').hidden) document.getElementById('chatBack').click()", completionHandler:nil)
    }
    private var pendingEvents: [String] = []
    private var deliveringEvent = false
    @objc func foreground() { flushEvents() }
    @objc func background() {speech.cancel()}
    func emit(_ kind: String,_ id: String,_ event: [String:Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject:[kind,id,event]),let json = String(data:data,encoding:.utf8) else {return}
        pendingEvents.append(json)
        flushEvents()
    }
    private func flushEvents() {
        guard UIApplication.shared.applicationState == .active, !deliveringEvent, let json = pendingEvents.first else {return}
        deliveringEvent = true
        web.evaluateJavaScript("if (!window.P0Native) throw new Error('Bridge unavailable'); window.P0Native.receive(...\(json))") { [weak self] _,error in
            guard let self else {return}
            self.deliveringEvent = false
            if error == nil {self.pendingEvents.removeFirst();self.flushEvents()} else if let error {DiagnosticLog.shared.failure("bridge.delivery_error",error:error,fields:["pending":self.pendingEvents.count])}
        }
    }
    func userContentController(_ userContentController: WKUserContentController,didReceive message: WKScriptMessage,replyHandler: @escaping (Any?,String?) -> Void) {
        guard message.frameInfo.isMainFrame,Self.isBundledPage(message.frameInfo.request.url),let value = message.body as? [String:Any],let op = value["op"] as? String else {replyHandler(nil,"访问被拒绝。");return}
        let isStatus = op == "request" && URL(string:value["url"] as? String ?? "")?.path == "/api/printer/status"
        let started = ProcessInfo.processInfo.systemUptime
        let trace = value["traceId"] as? String ?? value["id"] as? String ?? UUID().uuidString
        Task {
            defer {if op != "diagnostic" && !isStatus {DiagnosticLog.shared.record("bridge.end",["request":trace,"kind":op,"ms":DiagnosticLog.elapsed(started)])}}
            do {
                let body = value["body"] as? [String:Any] ?? [:],id = value["id"] as? String ?? ""
                switch op {
                case "diagnostic":
                    if let event = body["event"] as? String,["web.ready","web.error","web.rejection","web.long_task","web.action","web.navigation","web.visibility","bridge.start","bridge.end","bridge.error","model.complete","model.error"].contains(event) {
                        DiagnosticLog.shared.record(event,level:body["level"] as? String ?? "info",body["fields"] as? [String:Any] ?? [:])
                    }
                    replyHandler(["ok":true],nil)
                case "navigation":
                    let isChat = value["page"] as? String == "chat"
                    backGesture.isEnabled = isChat
                    topBackground.backgroundColor = isChat ? UIColor(red:239/255,green:246/255,blue:1,alpha:1) : UIColor(red:246/255,green:248/255,blue:252/255,alpha:1)
                    bottomBackground.backgroundColor = isChat ? UIColor(red:226/255,green:239/255,blue:1,alpha:1) : .white
                    replyHandler(["ok":true],nil)
                case "chat":try model.start(id:id,body:body);replyHandler(["ok":true],nil)
                case "cancelChat":model.cancel(id);replyHandler(["ok":true],nil)
                case "speechStart":try await speech.start(id);replyHandler(["ok":true],nil)
                case "speechStop":speech.stop(id);replyHandler(["ok":true],nil)
                case "speechCancel":speech.cancel();replyHandler(["ok":true],nil)
                case "request":replyHandler(try await request(value),nil)
                default:throw appError("未知操作。")
                }
            } catch {DiagnosticLog.shared.failure("bridge.error",error:error,fields:["request":trace,"kind":op,"ms":DiagnosticLog.elapsed(started)]);replyHandler(nil,error.localizedDescription)}
        }
    }
    func request(_ value: [String:Any]) async throws -> Any {
        guard let text = value["url"] as? String,let url = URL(string:text) else {throw appError("地址无效。")}
        if url.scheme == "https",url.host == "api.mymemory.translated.net",url.path == "/get" {
            var req = URLRequest(url:url);req.timeoutInterval = 15
            let (data,response) = try await URLSession.shared.data(for:req)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {throw appError("翻译服务暂不可用。")};return try JSONSerialization.jsonObject(with:data)
        }
        guard url.scheme == "englishprinter",url.host == "app" else {throw appError("不允许访问此地址。")}
        let method = value["method"] as? String ?? "GET", body = value["body"] as? [String:Any] ?? [:]
        if url.path == "/api/translate" {
            guard method == "POST",let q = body["q"] as? String,
                  !q.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,q.count <= 120,
                  let direction = body["direction"] as? String,["zh-en","en-zh"].contains(direction)
            else {throw appError("翻译参数无效。")}
            // Preserve the existing phone translation provider; never bundle Mac credentials.
            var components = URLComponents(string:"https://api.mymemory.translated.net/get")!
            components.queryItems = [URLQueryItem(name:"q",value:q),URLQueryItem(name:"langpair",value:direction == "zh-en" ? "zh-CN|en" : "en|zh-CN")]
            var req = URLRequest(url:components.url!);req.timeoutInterval = 10
            let (data,response) = try await URLSession.shared.data(for:req)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let payload = try JSONSerialization.jsonObject(with:data) as? [String:Any],
                  let status = payload["responseStatus"] as? Int,status == 200,
                  let result = payload["responseData"] as? [String:Any],
                  let translated = result["translatedText"] as? String,!translated.isEmpty
            else {throw appError("翻译服务暂不可用，请重试。")}
            return ["text":translated]
        }
        if url.path == "/api/history" {return try await ChatHistoryStore.shared.access(method:method,body:body)}
        if url.path == "/api/config" {
            if method == "POST" {guard !model.active else {throw appError("请等待当前回复完成。")};return try ModelConfig.update(body).publicValue}
            return try ModelConfig.load().publicValue
        }
        if url.path.hasPrefix("/api/printer/") {
            if url.lastPathComponent == "print" {DiagnosticLog.shared.record("printer.start",["request":body["requestId"] as? String ?? "","parent":value["traceId"] as? String ?? ""])}
            return try await printer.operation(url.lastPathComponent,body:body)
        }
        guard method == "GET",["/pronunciations.json","/model-options.json"].contains(url.path),let file = BundleScheme.resource(url.path) else {throw appError("资源不存在。")}
        return try String(contentsOf:file,encoding:.utf8)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame, Self.isBundledPage(frame.request.url), presentedViewController == nil else {
            completionHandler(false); return
        }
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "删除", style: .destructive) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView,didFailProvisionalNavigation navigation: WKNavigation!,withError error: Error) {showLoadError(error)}
    func webView(_ webView: WKWebView,didFail navigation: WKNavigation!,withError error: Error) {showLoadError(error)}
    func showLoadError(_ error: Error) {DiagnosticLog.shared.failure("web.load_error",error:error);let label = UILabel();label.numberOfLines = 0;label.textAlignment = .center;label.text = "页面加载失败：" + error.localizedDescription;label.frame = view.bounds.insetBy(dx:24,dy:100);view.addSubview(label)}
    func webView(_ webView: WKWebView,decidePolicyFor navigationAction: WKNavigationAction,decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if Self.isBundledPage(navigationAction.request.url) {decisionHandler(.allow);return}
        if navigationAction.navigationType == .linkActivated,let url = navigationAction.request.url,url.scheme == "https" {UIApplication.shared.open(url)}
        decisionHandler(.cancel)
    }
}
