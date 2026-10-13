import Foundation
import CoreBluetooth

// JSON-lines over stdin/stdout. Keep CoreBluetooth and its delegate on the main run loop.
func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) {
        print(text); fflush(stdout)
    }
}
final class Bridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    var central: CBCentralManager!
    var printer: CBPeripheral?
    var writer: CBCharacteristic?
    var receiver: CBCharacteristic?
    var ready = false
    var connectID: String?
    var disconnectID: String?
    var writeID: String?
    var timer: DispatchWorkItem?
    var chunks: [Data] = []
    var index = 0
    let target = ProcessInfo.processInfo.environment["P0_DEVICE_ID"] ?? ((try? String(contentsOfFile: ".local/printer-device-id", encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

    func start() { central = CBCentralManager(delegate: self, queue: nil) }
    func reply(_ id: String, error: String? = nil) {
        var r: [String: Any] = ["id": id, "ok": error == nil]
        if let e = error { r["error"] = e }
        emit(r)
    }
    func lost(_ error: String) {
        ready = false; writer = nil; receiver = nil; chunks = []; timer?.cancel()
        central.stopScan()
        if let p = printer, p.state == .connected || p.state == .connecting { central.cancelPeripheralConnection(p) }
        if let id = connectID { connectID = nil; reply(id, error: error) }
        if let id = writeID { writeID = nil; reply(id, error: error) }
        emit(["event": "state", "connected": false, "error": error])
    }
    func beginConnect() {
        guard connectID != nil else { return }
        guard UUID(uuidString: target) != nil else { lost("请配置 P0_DEVICE_ID 或 .local/printer-device-id。"); return }
        if central.state == .poweredOn {
            central.scanForPeripherals(withServices: nil)
        } else if central.state == .poweredOff { lost("请开启 Mac 蓝牙。") }
        else if central.state == .unauthorized { lost("请在系统设置中允许本机服务使用蓝牙。") }
        else if central.state == .unsupported { lost("这台 Mac 不支持所需蓝牙功能。") }
    }
    func handle(_ request: [String: Any]) {
        guard let id = request["id"] as? String, let op = request["op"] as? String else { return }
        switch op {
        case "connect":
            if ready { reply(id); return }
            if connectID != nil || disconnectID != nil { reply(id, error: "设备正在连接或断开。"); return }
            connectID = id
            let timeout = DispatchWorkItem { [weak self] in
                guard let self = self, self.connectID != nil else { return }
                self.central.stopScan()
                if let p = self.printer { self.central.cancelPeripheralConnection(p) }
                self.lost("连接超时，请开机并断开微打连接。")
            }
            timer = timeout; DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
            beginConnect()
        case "disconnect":
            if writeID != nil { reply(id, error: "正在发送打印数据，请稍后断开。"); return }
            central.stopScan(); timer?.cancel()
            if let cid = connectID { connectID = nil; reply(cid, error: "连接已取消。") }
            guard let p = printer, p.state != .disconnected else { lost(""); reply(id); return }
            disconnectID = id; central.cancelPeripheralConnection(p)
        case "write":
            guard ready, let p = printer, let w = writer else { reply(id, error: "打印机未连接。"); return }
            guard writeID == nil else { reply(id, error: "打印机正在接收数据。"); return }
            guard let base64 = request["data"] as? String, let data = Data(base64Encoded: base64), !data.isEmpty, data.count <= 65536 else { reply(id, error: "打印数据无效。"); return }
            writeID = id; index = 0
            let size = min(100, p.maximumWriteValueLength(for: .withResponse))
            chunks = stride(from: 0, to: data.count, by: size).map { data.subdata(in: $0..<min($0 + size, data.count)) }
            send(p, w)
        default: reply(id, error: "未知设备操作。")
        }
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state != .poweredOn && ready { lost("蓝牙连接已断开。") }
        beginConnect()
    }
    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        guard connectID != nil, p.identifier.uuidString == target else { return }
        central.stopScan(); printer = p; p.delegate = self; central.connect(p)
    }
    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        p.discoverServices([CBUUID(string: "49535343-FE7D-4AE5-8FA9-9FAFD205E455")])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) { lost("P0 连接失败，请断开手机微打后重试。") }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        let id = disconnectID; disconnectID = nil
        lost(id == nil ? "打印机连接已断开。" : "")
        printer = nil
        if let id = id { reply(id) }
    }
    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil, let s = p.services?.first else { lost("未找到 P0 打印服务。"); return }
        p.discoverCharacteristics(nil, for: s)
    }
    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        guard error == nil else { lost("读取打印通道失败。"); return }
        writer = s.characteristics?.first(where: { $0.properties.contains(.write) })
        receiver = s.characteristics?.first(where: { $0.properties.contains(.notify) })
        guard writer != nil, let receiver = receiver else { lost("未找到可用打印通道。"); return }
        p.setNotifyValue(true, for: receiver)
    }
    func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor ch: CBCharacteristic, error: Error?) {
        guard error == nil, ch.isNotifying else { lost("无法接收打印机状态。"); return }
        ready = true; timer?.cancel()
        emit(["event": "state", "connected": true, "name": p.name ?? "德佟 P0"])
        if let id = connectID { connectID = nil; reply(id) }
    }
    func send(_ p: CBPeripheral, _ w: CBCharacteristic) {
        if index < chunks.count { p.writeValue(chunks[index], for: w, type: .withResponse); index += 1 }
        else if let id = writeID { writeID = nil; chunks = []; reply(id) }
    }
    func peripheral(_ p: CBPeripheral, didWriteValueFor ch: CBCharacteristic, error: Error?) {
        if error != nil { lost("蓝牙写入失败，请检查标签是否已出纸后再操作。"); central.cancelPeripheralConnection(p); return }
        guard writeID != nil else { return }; send(p, ch)
    }
    func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
        if error == nil, let data = ch.value { emit(["event": "data", "data": data.base64EncodedString()]) }
    }
}
let bridge = Bridge(); bridge.start()
DispatchQueue.global().async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
        DispatchQueue.main.async { bridge.handle(request) }
    }
    DispatchQueue.main.async { exit(0) } // Parent server closed: never leave an orphan Bluetooth connection.
}
RunLoop.main.run()
