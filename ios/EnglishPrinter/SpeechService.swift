import Foundation
import Speech
import AVFoundation

@MainActor final class SpeechService {
    var id: String?, cancelled = false, finishing = false, tapped = false
    let engine = AVAudioEngine()
    var task: SFSpeechRecognitionTask?, request: SFSpeechAudioBufferRecognitionRequest?
    var emit: ((String,[String:Any]) -> Void)?
    func start(_ token: String) async throws {
        cancel();DiagnosticLog.shared.record("speech.start",["request":token]);id = token;cancelled = false;finishing = false
        let status = await withCheckedContinuation { continuation in SFSpeechRecognizer.requestAuthorization {continuation.resume(returning:$0)} }
        guard id == token, !cancelled else {return}
        guard status == .authorized else {finish(error:"not-allowed");return}
        let mic = await withCheckedContinuation { continuation in AVAudioApplication.requestRecordPermission {continuation.resume(returning:$0)} }
        guard id == token, !cancelled else {return}
        guard mic else {finish(error:"not-allowed");return}
        guard let recognizer = SFSpeechRecognizer(locale:Locale(identifier:"zh-CN")),recognizer.isAvailable else {finish(error:"service-not-allowed");return}
        if finishing {finish();return}
        do {
            let audio = AVAudioSession.sharedInstance();try audio.setCategory(.record,mode:.measurement,options:.duckOthers);try audio.setActive(true)
            let request = SFSpeechAudioBufferRecognitionRequest();request.shouldReportPartialResults = true;self.request = request
            let input = engine.inputNode, format = input.outputFormat(forBus:0)
            guard format.sampleRate > 0 && format.channelCount > 0 else {finish(error:"audio-capture");return}
            input.installTap(onBus:0,bufferSize:1024,format:format) {buffer,_ in request.append(buffer)};tapped = true
            task = recognizer.recognitionTask(with:request) { [weak self] result,error in
                Task { @MainActor in
                    guard let self = self,self.id == token else {return}
                    if let result = result {self.emit?(token,["type":"result","text":result.bestTranscription.formattedString])}
                    if result?.isFinal == true {self.finish()}else if error != nil {self.finish(error:self.finishing ? nil : "network")}
                }
            }
            engine.prepare();try engine.start();emit?(token,["type":"start"])
        } catch {finish(error:"audio-capture")}
    }
    func stop(_ token: String) {guard id == token else {return};finishing = true;engine.stop();if tapped {engine.inputNode.removeTap(onBus:0);tapped = false};request?.endAudio();if request != nil {Task {try? await Task.sleep(nanoseconds:3_000_000_000);if self.id == token {self.finish()}}}}
    func cancel() {cancelled = true;finish()}
    func finish(error: String? = nil) {
        let old = id;id = nil;engine.stop();if tapped {engine.inputNode.removeTap(onBus:0);tapped = false};request?.endAudio();request = nil;task?.cancel();task = nil
        try? AVAudioSession.sharedInstance().setActive(false,options:.notifyOthersOnDeactivation)
        if let old = old {DiagnosticLog.shared.record(error == nil ? "speech.end":"speech.error",level:error == nil ? "info":"error",["request":old,"reason":error ?? "complete"]);if let error = error {emit?(old,["type":"error","error":error])};emit?(old,["type":"end"])}
    }
}
