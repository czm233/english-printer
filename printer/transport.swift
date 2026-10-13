import Foundation
import CoreBluetooth
final class Probe: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
 var central: CBCentralManager!; var printer: CBPeripheral?; var pending = 0; var writer: CBCharacteristic?; var receiver: CBCharacteristic?
 func start() { central = CBCentralManager(delegate:self, queue:nil); DispatchQueue.main.asyncAfter(deadline:.now()+25) { print("ERROR: Bluetooth operation timed out"); exit(7) } }
 func centralManagerDidUpdateState(_ c:CBCentralManager) { print("Bluetooth state: \(c.state.rawValue)"); if c.state == .poweredOn { c.scanForPeripherals(withServices:nil) } else if c.state == .unauthorized { print("Bluetooth permission required"); exit(2) } }
 func centralManager(_ c:CBCentralManager,didDiscover p:CBPeripheral,advertisementData:[String:Any],rssi:NSNumber) { let name=p.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""; if p.identifier.uuidString == (ProcessInfo.processInfo.environment["P0_DEVICE_ID"] ?? ((try? String(contentsOfFile: "../.local/printer-device-id", encoding: .utf8)) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) { print("Found printer: \(name) \(p.identifier)"); if printer == nil { printer=p; c.stopScan(); p.delegate=self; c.connect(p) } } }
 func centralManager(_ c:CBCentralManager,didConnect p:CBPeripheral) { print("CONNECTED"); p.discoverServices(nil) }
 func centralManager(_ c:CBCentralManager,didFailToConnect p:CBPeripheral,error:Error?) { print("Connection failed: \(String(describing:error))"); exit(3) }
 func peripheral(_ p:CBPeripheral,didDiscoverServices error:Error?) { for s in p.services ?? [] { print("Service \(s.uuid)"); pending += 1; p.discoverCharacteristics(nil,for:s) } }
 func peripheral(_ p:CBPeripheral,didDiscoverCharacteristicsFor s:CBService,error:Error?) { for ch in s.characteristics ?? [] { print("Characteristic \(s.uuid)/\(ch.uuid) properties=\(ch.properties.rawValue)") }; if s.uuid.uuidString == "49535343-FE7D-4AE5-8FA9-9FAFD205E455" { for ch in s.characteristics ?? [] { if ch.properties.contains(.notify) { receiver=ch; p.setNotifyValue(true,for:ch) }; if ch.properties.contains(.write) { writer=ch } } }; pending -= 1 }
 func peripheral(_ p:CBPeripheral,didUpdateNotificationStateFor ch:CBCharacteristic,error:Error?) { guard error == nil, let w=writer else { print("Notify failed");exit(4) }; let path=CommandLine.arguments.count>1 ? CommandLine.arguments[1] : "work/query.bin"; guard let data=try? Data(contentsOf:URL(fileURLWithPath:path)) else {exit(5)}; let maxLen=min(100,p.maximumWriteValueLength(for:.withResponse)); chunks=stride(from:0,to:data.count,by:maxLen).map { data.subdata(in:$0..<min($0+maxLen,data.count)) }; send(p,w) }
 var chunks:[Data]=[]; var index=0
 func send(_ p:CBPeripheral,_ w:CBCharacteristic) { if index < chunks.count { p.writeValue(chunks[index],for:w,type:.withResponse); index += 1 } else { print("SENT all bytes"); DispatchQueue.main.asyncAfter(deadline:.now()+6) { self.central.cancelPeripheralConnection(p);exit(0) } } }
 func peripheral(_ p:CBPeripheral,didWriteValueFor ch:CBCharacteristic,error:Error?) { if let e=error { print("WRITE ERROR \(e)");exit(6) }; send(p,ch) }
 func peripheral(_ p:CBPeripheral,didUpdateValueFor ch:CBCharacteristic,error:Error?) { if let data=ch.value { print("RX " + data.map {String(format:"%02x",$0)}.joined()); fflush(stdout) } }
}
let probe=Probe(); probe.start(); RunLoop.main.run()
