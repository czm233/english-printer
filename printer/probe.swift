import Foundation
import CoreBluetooth
final class Probe: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
 var central: CBCentralManager!; var printer: CBPeripheral?; var pending = 0
 func start() { central = CBCentralManager(delegate:self, queue:nil); DispatchQueue.main.asyncAfter(deadline:.now()+25) { print("Probe finished"); exit(0) } }
 func centralManagerDidUpdateState(_ c:CBCentralManager) { print("Bluetooth state: \(c.state.rawValue)"); if c.state == .poweredOn { c.scanForPeripherals(withServices:nil) } else if c.state == .unauthorized { print("Bluetooth permission required"); exit(2) } }
 func centralManager(_ c:CBCentralManager,didDiscover p:CBPeripheral,advertisementData:[String:Any],rssi:NSNumber) { let name=p.name ?? advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""; if name.uppercased().contains("P0") { print("Found printer: \(name) \(p.identifier)"); if printer == nil { printer=p; c.stopScan(); p.delegate=self; c.connect(p) } } }
 func centralManager(_ c:CBCentralManager,didConnect p:CBPeripheral) { print("CONNECTED"); p.discoverServices(nil) }
 func centralManager(_ c:CBCentralManager,didFailToConnect p:CBPeripheral,error:Error?) { print("Connection failed: \(String(describing:error))"); exit(3) }
 func peripheral(_ p:CBPeripheral,didDiscoverServices error:Error?) { for s in p.services ?? [] { print("Service \(s.uuid)"); pending += 1; p.discoverCharacteristics(nil,for:s) } }
 func peripheral(_ p:CBPeripheral,didDiscoverCharacteristicsFor s:CBService,error:Error?) { for ch in s.characteristics ?? [] { print("Characteristic \(s.uuid)/\(ch.uuid) properties=\(ch.properties.rawValue)") }; pending -= 1; if pending == 0 { central.cancelPeripheralConnection(p); exit(0) } }
}
let probe=Probe(); probe.start(); RunLoop.main.run()
