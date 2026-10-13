import Foundation
import CoreBluetooth
import CryptoKit

@MainActor final class NativePrinter: NSObject, @preconcurrency CBCentralManagerDelegate, @preconcurrency CBPeripheralDelegate {
    let codec = PrinterCodec()
    lazy var central = CBCentralManager(delegate:self,queue:.main)
    var peripheral: CBPeripheral?, writer: CBCharacteristic?
    var ready = false, busy = false, connecting = false, dpi = 0, width = 0, printable = 0
    var connectWaiter: CheckedContinuation<Void,Error>?, writeWaiter: CheckedContinuation<Void,Error>?
    var connectTimeout: DispatchWorkItem?, writeTimeout: DispatchWorkItem?
    var packets: [Data] = [], packetIndex = 0
    var queries: [Int:CheckedContinuation<[String:Any],Error>] = [:]
    var queryTimeouts: [Int:DispatchWorkItem] = [:]
    var pageKey = Int.random(in:1..<65000)
    let service = CBUUID(string:"49535343-FE7D-4AE5-8FA9-9FAFD205E455")
    let states = [0:"可打印",1:"正在打印",2:"正在走纸",11:"标签未就绪",20:"设备未就绪",30:"电量不足",34:"纸仓盖未关闭",35:"缺纸",42:"未检测到标签",43:"标签不匹配",44:"标签已用尽"]
    var snapshot: [String:Any] {["connected":ready,"busy":busy,"name":"德佟 P0","detail":ready ? (states[printable] ?? "设备状态异常") : "未连接","dpi":dpi,"width":width,"printable":printable]}
    func connect() async throws {
        if ready {return}
        guard !connecting else {throw appError("设备正在连接。")}
        connecting = true
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void,Error>) in
            connectWaiter = continuation
            let timeout = DispatchWorkItem { [weak self] in self?.lost("连接超时，请开启 P0 并断开微打和电脑的蓝牙连接。") }
            connectTimeout = timeout; DispatchQueue.main.asyncAfter(deadline:.now()+20,execute:timeout)
            beginScan()
        }
    }
    func beginScan() {
        guard connecting else {return}
        switch central.state {
        case .poweredOn: central.scanForPeripherals(withServices:nil)
        case .poweredOff: lost("请开启手机蓝牙。")
        case .unauthorized: lost("请在 iPhone 设置中允许词签使用蓝牙。")
        case .unsupported: lost("此设备不支持蓝牙打印。")
        default: break
        }
    }
    func lost(_ message: String) {
        ready = false;connecting = false;writer = nil;central.stopScan();connectTimeout?.cancel();writeTimeout?.cancel();codec.reset()
        if let p = peripheral, p.state != .disconnected {central.cancelPeripheralConnection(p)}
        DiagnosticLog.shared.record("printer.disconnected",level:"warning",["state_code":central.state.rawValue,"pending":queries.count])
        let error = appError(message)
        connectWaiter?.resume(throwing:error);connectWaiter = nil
        writeWaiter?.resume(throwing:error);writeWaiter = nil;packets = []
        let waiting = queries;queries = [:];waiting.values.forEach {$0.resume(throwing:error)}
        queryTimeouts.values.forEach {$0.cancel()};queryTimeouts = [:]
    }
    func disconnect() throws {
        guard !busy else {throw appError("设备正在处理任务。")}
        if peripheral != nil || connecting {lost("设备已断开。")};peripheral = nil
    }
    func write(_ data: Data) async throws {
        guard ready, let p = peripheral, let _ = writer else {throw appError("打印机未连接。")}
        guard writeWaiter == nil else {throw appError("打印机正在接收数据。")}
        let size = min(100,p.maximumWriteValueLength(for:.withResponse));guard size > 0 else {throw appError("打印通道无效。")}
        packets = stride(from:0,to:data.count,by:size).map {data.subdata(in:$0..<min($0+size,data.count))};packetIndex = 0
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void,Error>) in
            writeWaiter = continuation
            let timeout = DispatchWorkItem { [weak self] in self?.lost("蓝牙写入超时，请先查看标签是否已出纸。") };writeTimeout = timeout;DispatchQueue.main.asyncAfter(deadline:.now()+15,execute:timeout)
            sendNext()
        }
    }
    func sendNext() {
        guard let p = peripheral, let writer = writer else {return}
        if packetIndex < packets.count {let packet = packets[packetIndex];packetIndex += 1;p.writeValue(packet,for:writer,type:.withResponse)}
        else {writeTimeout?.cancel();packets = [];let waiter = writeWaiter;writeWaiter = nil;waiter?.resume()}
    }
    func query(_ command: Int) async throws -> [String:Any] {
        guard queries[command] == nil else {throw appError("设备正在查询状态。")}
        let data = try codec.command(command)
        return try await withCheckedThrowingContinuation { continuation in
            queries[command] = continuation
            let timeout = DispatchWorkItem { [weak self] in self?.finishQuery(command,error:appError("打印机未返回状态，请重连。")) }
            queryTimeouts[command] = timeout;DispatchQueue.main.asyncAfter(deadline:.now()+4,execute:timeout)
            Task {do {try await write(data)} catch {finishQuery(command,error:error)}}
        }
    }
    func finishQuery(_ command: Int,packet: [String:Any]? = nil,error: Error? = nil) {
        queryTimeouts.removeValue(forKey:command)?.cancel()
        if let q = queries.removeValue(forKey:command) {if let packet = packet {q.resume(returning:packet)} else {q.resume(throwing:error ?? appError("状态无效。"))}}
    }
    func refresh() async throws -> [Int] {
        let packet = try await query(112);guard let data = packet["data"] as? [Int], let first = data.first else {throw appError("打印机状态无效。")}
        printable = first;return data
    }
    func ensureConnected() async throws {
        try await connect()
        dpi = (try await query(113))["value"] as? Int ?? 0
        let packet = try await query(114), data = packet["data"] as? [Int] ?? []
        width = data.count >= 5 ? data[0]*256+data[1] : (packet["value"] as? Int ?? 0)
        _ = try await refresh()
        guard dpi == 203 && width == 96 else {throw appError("设备尺寸与已验证的 P0 不一致，已停止打印。")}
        UserDefaults.standard.set(peripheral?.identifier.uuidString,forKey:"p0-device")
    }
    func operation(_ name: String,body: [String:Any]) async throws -> [String:Any] {
        if name == "status" {return snapshot}
        let trace = body["requestId"] as? String ?? UUID().uuidString,started = ProcessInfo.processInfo.systemUptime
        DiagnosticLog.shared.record("printer.start",["request":trace,"kind":name])
        defer {DiagnosticLog.shared.record("printer.end",["request":trace,"kind":name,"ms":DiagnosticLog.elapsed(started),"state_code":printable])}
        guard !busy else {throw appError("打印机正在处理任务，请稍后操作。")}
        if name == "disconnect" {try disconnect();return snapshot}
        busy = true;defer {busy = false}
        if name == "connect" {try await ensureConnected();var result = snapshot;result["busy"] = false;return result}
        guard name == "print" else {throw appError("未知打印操作。")}
        do {return try await printLabel(body)} catch {DiagnosticLog.shared.failure("printer.error",error:error,fields:["request":trace,"state_code":printable]);throw error}
    }
    func printLabel(_ body: [String:Any]) async throws -> [String:Any] {
        guard let id = body["requestId"] as? String, UUID(uuidString:id) != nil else {throw appError("打印任务编号无效。")}
        let folder = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("PrintJobs",isDirectory:true)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let file = folder.appendingPathComponent(id+".json")
        let encoded = try JSONSerialization.data(withJSONObject:body,options:.sortedKeys)
        let fingerprint = SHA256.hash(data:encoded).map {String(format:"%02x",$0)}.joined()
        if let bytes = try? Data(contentsOf:file), let record = try JSONSerialization.jsonObject(with:bytes) as? [String:Any] {
            guard record["fingerprint"] as? String == fingerprint else {throw appError("同一打印任务的内容不能改变。")}
            DiagnosticLog.shared.record("printer.stage",["request":id,"stage":"duplicate"])
            if var result = record["result"] as? [String:Any] {var device = snapshot;device["busy"] = false;result["device"] = device;result["duplicate"] = true;return result}
            throw appError("此任务结果未确认，请先检查出纸，避免重复打印。")
        }
        pageKey = pageKey%65534+1
        DiagnosticLog.shared.record("printer.stage",["request":id,"stage":"render"])
        let bytes = try codec.render(body,key:pageKey)
        if !ready {try await ensureConnected()}
        guard dpi == 203 && width == 96 else {throw appError("设备打印尺寸无效，请重新连接。")}
        _ = try await refresh();guard printable == 0 else {throw appError("打印机"+(states[printable] ?? "状态异常")+"，请处理后再打印。")}
        let freePacket = try await query(119), units = freePacket["value"] as? Int ?? 0
        guard !bytes.isEmpty && bytes.count <= 500*(units == 1 ? 2 : units) else {throw appError("打印机缓存不足，请稍后重试。")}
        func persist(_ state: String,_ result: [String:Any]? = nil) throws {var value: [String:Any] = ["fingerprint":fingerprint,"state":state];if let result = result {value["result"] = result};try JSONSerialization.data(withJSONObject:value).write(to:file,options:[.atomic,.completeFileProtection])}
        try persist("sending")
        DiagnosticLog.shared.record("printer.stage",["request":id,"stage":"sending","bytes":bytes.count])
        do {
            try await write(bytes)
            var state = "sent", sawMotor = false
            for i in 0..<25 {
                try await Task.sleep(nanoseconds:400_000_000)
                let data = try await refresh(), code = data[0]
                if code > 2 {throw appError("打印机"+(states[code] ?? "状态异常")+"。请先查看出纸，避免重复打印。")}
                if code == 1 || code == 2 {sawMotor = true}
                let matches = data.count >= 6 && data[1] == data[2] && (data[3]*256+data[4] == pageKey || data[4]*256+data[3] == pageKey)
                if code == 0 && (matches || sawMotor) {state = "printed";break}
                if code == 0 && i >= 3 {break}
            }
            var device = snapshot;device["busy"] = false
            let result: [String:Any] = ["requestId":id,"state":state,"copies":1,"device":device,"message":state == "printed" ? "已打印 1 张" : "已发送 1 张，请查看出纸。"]
            try persist(state,result);DiagnosticLog.shared.record("printer.stage",level:state == "printed" ? "info":"warning",["request":id,"stage":state]);return result
        } catch {DiagnosticLog.shared.failure("printer.error",error:error,fields:["request":id,"stage":"unknown_result","state_code":printable]);try? persist("unknown");throw appError("打印结果未确认，请先检查是否已出纸，避免重复打印。")}
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {DiagnosticLog.shared.record("printer.bluetooth",["state_code":central.state.rawValue]);if central.state != .poweredOn && ready {lost("蓝牙连接已断开。")};beginScan()}
    func centralManager(_ central: CBCentralManager,didDiscover p: CBPeripheral,advertisementData: [String:Any],rssi RSSI: NSNumber) {
        guard connecting && peripheral?.state != .connecting else {return}
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? p.name ?? "").uppercased()
        let saved = UserDefaults.standard.string(forKey:"p0-device")
        guard saved == p.identifier.uuidString || (saved == nil && name.hasPrefix("P0")) else {return}
        central.stopScan();peripheral = p;p.delegate = self;central.connect(p)
    }
    func centralManager(_ central: CBCentralManager,didConnect p: CBPeripheral) {p.discoverServices([service])}
    func centralManager(_ central: CBCentralManager,didFailToConnect p: CBPeripheral,error: Error?) {lost("P0 连接失败，请先断开微打和电脑连接。")}
    func centralManager(_ central: CBCentralManager,didDisconnectPeripheral p: CBPeripheral,error: Error?) {if peripheral === p {peripheral = nil;lost("打印机连接已断开。")}}
    func peripheral(_ p: CBPeripheral,didDiscoverServices error: Error?) {guard error == nil, let s = p.services?.first(where:{$0.uuid == service}) else {lost("未找到 P0 打印服务。");return};p.discoverCharacteristics(nil,for:s)}
    func peripheral(_ p: CBPeripheral,didDiscoverCharacteristicsFor s: CBService,error: Error?) {
        writer = s.characteristics?.first(where:{$0.properties.contains(.write)})
        guard error == nil, writer != nil, let notify = s.characteristics?.first(where:{$0.properties.contains(.notify)}) else {lost("未找到可用打印通道。");return};p.setNotifyValue(true,for:notify)
    }
    func peripheral(_ p: CBPeripheral,didUpdateNotificationStateFor ch: CBCharacteristic,error: Error?) {
        guard error == nil && ch.isNotifying else {lost("无法接收打印状态。");return}
        ready = true;connecting = false;connectTimeout?.cancel();let q = connectWaiter;connectWaiter = nil;q?.resume()
    }
    func peripheral(_ p: CBPeripheral,didWriteValueFor ch: CBCharacteristic,error: Error?) {if error != nil {lost("蓝牙写入失败，请先检查出纸。")}else{sendNext()}}
    func peripheral(_ p: CBPeripheral,didUpdateValueFor ch: CBCharacteristic,error: Error?) {guard error == nil, let data = ch.value else {return};for packet in codec.parse(data) {if let cmd = packet["cmd"] as? Int {finishQuery(cmd,packet:packet)}}}
}
