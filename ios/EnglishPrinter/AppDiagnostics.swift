import UIKit
import MetricKit

@MainActor final class AppDiagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = AppDiagnostics()
    private var timer: Timer?
    private var lastTick: TimeInterval = 0
    private let log = DiagnosticLog.shared
    func start() {
        let defaults = UserDefaults.standard
        if let previous = defaults.string(forKey:"diagnostic.session"),let state = defaults.string(forKey:"diagnostic.state") {
            log.record("app.previous_session",level:state == "active" ? "warning":"info",["previous":previous,"state":state])
        }
        defaults.set(log.session,forKey:"diagnostic.session");defaults.set("inactive",forKey:"diagnostic.state")
        log.record("app.start")
        let center = NotificationCenter.default
        center.addObserver(self,selector:#selector(active),name:UIApplication.didBecomeActiveNotification,object:nil)
        center.addObserver(self,selector:#selector(inactive),name:UIApplication.willResignActiveNotification,object:nil)
        center.addObserver(self,selector:#selector(background),name:UIApplication.didEnterBackgroundNotification,object:nil)
        center.addObserver(self,selector:#selector(memory),name:UIApplication.didReceiveMemoryWarningNotification,object:nil)
        center.addObserver(self,selector:#selector(thermal),name:ProcessInfo.thermalStateDidChangeNotification,object:nil)
        MXMetricManager.shared.add(self)
    }
    @objc private func active() {
        UserDefaults.standard.set("active",forKey:"diagnostic.state");log.record("app.active")
        #if DEBUG
        timer?.invalidate();lastTick = ProcessInfo.processInfo.systemUptime
        timer = Timer.scheduledTimer(withTimeInterval:1,repeats:true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self,self.timer != nil else {return};let now = ProcessInfo.processInfo.systemUptime,delay = now-self.lastTick-1;self.lastTick = now
                if delay>0.5 {self.log.record("app.stall",level:"warning",["ms":Int(delay*1000)])}
            }
        }
        #endif
    }
    @objc private func inactive() {timer?.invalidate();timer = nil;UserDefaults.standard.set("inactive",forKey:"diagnostic.state")}
    @objc private func background() {UserDefaults.standard.set("background",forKey:"diagnostic.state");log.record("app.background")}
    @objc private func memory() {log.record("app.memory_warning",level:"warning")}
    @objc private func thermal() {log.record("app.thermal",level:ProcessInfo.processInfo.thermalState.rawValue>=2 ? "warning":"info",["state_code":ProcessInfo.processInfo.thermalState.rawValue])}
    func terminate() {UserDefaults.standard.set("clean",forKey:"diagnostic.state");log.record("app.terminate")}
    nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for payload in payloads {
            let reportStart = payload.timeStampBegin.timeIntervalSince1970,reportEnd = payload.timeStampEnd.timeIntervalSince1970
            for item in payload.crashDiagnostics ?? [] {
                DiagnosticLog.shared.record("metric.crash",level:"error",["report_start":reportStart,"report_end":reportEnd,"signal":item.signal ?? 0,"exception":item.exceptionType ?? 0,"frames":frames(item.callStackTree)])
            }
            for item in payload.hangDiagnostics ?? [] {DiagnosticLog.shared.record("metric.hang",level:"warning",["report_start":reportStart,"report_end":reportEnd,"duration_ms":item.hangDuration.converted(to:.milliseconds).value,"frames":frames(item.callStackTree)])}
            for item in payload.cpuExceptionDiagnostics ?? [] {DiagnosticLog.shared.record("metric.cpu",level:"warning",["report_start":reportStart,"report_end":reportEnd,"frames":frames(item.callStackTree)])}
            for item in payload.diskWriteExceptionDiagnostics ?? [] {DiagnosticLog.shared.record("metric.disk",level:"warning",["report_start":reportStart,"report_end":reportEnd,"frames":frames(item.callStackTree)])}
        }
    }
    nonisolated func didReceive(_ payloads: [MXMetricPayload]) {
        for payload in payloads {
            if let memory = payload.memoryMetrics {DiagnosticLog.shared.record("metric.summary",level:"warning",["peak_mb":memory.peakMemoryUsage.converted(to:.megabytes).value])}
        }
    }
    // Store only symbolication identifiers and offsets. No exception text, paths or report metadata.
    nonisolated private func frames(_ tree: MXCallStackTree) -> [[String:Any]] {
        guard let object = try? JSONSerialization.jsonObject(with:tree.jsonRepresentation()) else {return []}
        var output: [[String:Any]] = []
        func visit(_ value: Any,depth: Int) {
            guard depth<32,output.count<32 else {return}
            if let value = value as? [String:Any] {
                if let uuid = value["binaryUUID"] as? String,let offset = value["offsetIntoBinaryTextSegment"] as? NSNumber {output.append(["uuid":uuid,"offset":offset])}
                for key in ["callStackTree","callStacks","callStackRootFrames","subFrames"] {if let child = value[key] {visit(child,depth:depth+1)}}
            } else if let value = value as? [Any] {for child in value {visit(child,depth:depth+1)}}
        }
        visit(object,depth:0);return output
    }
}
