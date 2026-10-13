import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

// Compile the production classes against an in-memory CoreBluetooth surface.
// No CBCentralManager from Apple's framework is linked or started by this test.
const bluetooth = `
import Foundation
protocol CBCentralManagerDelegate: AnyObject {}
protocol CBPeripheralDelegate: AnyObject {}
enum CBManagerState: Int {case unknown,resetting,unsupported,unauthorized,poweredOff,poweredOn}
enum CBPeripheralState {case disconnected,connecting,connected,disconnecting}
enum CBCharacteristicWriteType {case withResponse}
struct CBCharacteristicProperties: OptionSet {
 let rawValue: Int
 static let write = Self(rawValue:1), notify = Self(rawValue:2)
}
struct CBUUID: Equatable {let uuidString: String;init(string:String) {uuidString=string}}
let CBAdvertisementDataLocalNameKey = "name"
final class CBCharacteristic {
 let uuid = CBUUID(string:"fixture")
 var properties: CBCharacteristicProperties = [.write,.notify]
 var isNotifying = true
 var value: Data?
}
final class CBService {
 let uuid = CBUUID(string:"49535343-FE7D-4AE5-8FA9-9FAFD205E455")
 var characteristics: [CBCharacteristic]?
}
final class CBPeripheral {
 let identifier: UUID
 let name: String? = "P0 fixture"
 var state: CBPeripheralState = .connected
 weak var delegate: AnyObject?
 var services: [CBService]?
 var onWrite: ((Data,CBCharacteristic) -> Void)?
 init(_ identifier: UUID = UUID()) {self.identifier=identifier}
 func maximumWriteValueLength(for type:CBCharacteristicWriteType) -> Int {100}
 func writeValue(_ data:Data,for characteristic:CBCharacteristic,type:CBCharacteristicWriteType) {onWrite?(data,characteristic)}
 func discoverServices(_ services:[CBUUID]?) {}
 func discoverCharacteristics(_ characteristics:[CBUUID]?,for service:CBService) {}
 func setNotifyValue(_ enabled:Bool,for characteristic:CBCharacteristic) {}
}
final class CBCentralManager {
 var state: CBManagerState = .poweredOn
 var connections: [UUID] = []
 init(delegate:AnyObject?,queue:DispatchQueue?) {}
 func stopScan() {}
 func scanForPeripherals(withServices services:[CBUUID]?) {}
 func cancelPeripheralConnection(_ peripheral:CBPeripheral) {peripheral.state = .disconnected}
 func connect(_ peripheral:CBPeripheral) {connections.append(peripheral.identifier)}
}
func appError(_ message:String) -> NSError {NSError(domain:"Fixture",code:1,userInfo:[NSLocalizedDescriptionKey:message])}
final class DiagnosticLog {
 static let shared = DiagnosticLog()
 func record(_ event:String,level:String="info",_ fields:[String:Any]) {}
 func failure(_ event:String,error:Error,fields:[String:Any]) {}
 static func elapsed(_ start:Double) -> Int {0}
}
@MainActor final class PrinterCodec {
 func command(_ value:Int) throws -> Data {Data([UInt8(value)])}
 func render(_ body:[String:Any],key:Int) throws -> Data {Data([0])}
 func reset() {}
 func parse(_ data:Data) -> [[String:Any]] {[["cmd":Int(data[0]),"value":Int(data[1]),"data":[Int(data[1])]]]}
}
`;

const checks = `
@MainActor func fixture() -> (NativePrinter,CBPeripheral,CBCharacteristic) {
 let printer = NativePrinter(), peripheral = CBPeripheral(), writer = CBCharacteristic()
 printer.ready=true;printer.peripheral=peripheral;printer.writer=writer
 return (printer,peripheral,writer)
}
@MainActor func queryOrder(notificationFirst:Bool) async throws {
 let (printer,peripheral,writer) = fixture()
 var writes: [Int] = [], acknowledgements=0, notifications=0
 peripheral.onWrite = { data,_ in
  let command = Int(data[0]);writes.append(command)
  let notify = {
   let characteristic=CBCharacteristic();characteristic.value=Data([UInt8(command),203])
   notifications += 1;printer.peripheral(peripheral,didUpdateValueFor:characteristic,error:nil)
  }
  let acknowledge = {acknowledgements += 1;printer.peripheral(peripheral,didWriteValueFor:writer,error:nil)}
  DispatchQueue.main.asyncAfter(deadline:.now()+0.01,execute:notificationFirst ? notify : acknowledge)
  DispatchQueue.main.asyncAfter(deadline:.now()+0.03,execute:notificationFirst ? acknowledge : notify)
 }
 for command in [113,114,112,119] {
  let packet = try await printer.query(command)
  precondition(packet["value"] as? Int == 203)
  precondition(acknowledgements == writes.count && notifications == writes.count,"query returned before both callbacks")
  precondition(printer.writeWaiter == nil && printer.queries.isEmpty && printer.queryTimeouts.isEmpty)
 }
 precondition(writes == [113,114,112,119])
}
@MainActor func queryFailures() async throws {
 // A response followed by a failed write must fail, not report the response as success.
 let (printer,peripheral,writer) = fixture()
 peripheral.onWrite = {data,_ in
  let characteristic=CBCharacteristic();characteristic.value=Data([data[0],203])
  printer.peripheral(peripheral,didUpdateValueFor:characteristic,error:nil)
  DispatchQueue.main.asyncAfter(deadline:.now()+0.01) {printer.peripheral(peripheral,didWriteValueFor:writer,error:appError("fixture write failure"))}
 }
 do {_ = try await printer.query(113);fatalError("write failure accepted")} catch {}
 precondition(!printer.ready && printer.writeWaiter == nil && printer.queries.isEmpty && printer.queryTimeouts.isEmpty)

 // Drive the production timeout handler without waiting four seconds.
 let (waiting,pending,channel) = fixture()
 pending.onWrite = {data,_ in
  waiting.peripheral(pending,didWriteValueFor:channel,error:nil)
  DispatchQueue.main.asyncAfter(deadline:.now()+0.01) {waiting.queryTimeouts[Int(data[0])]?.perform()}
 }
 do {_ = try await waiting.query(112);fatalError("missing response accepted")}
 catch {precondition(error.localizedDescription.contains("未返回状态"))}
 precondition(waiting.queries.isEmpty && waiting.queryTimeouts.isEmpty && waiting.writeWaiter == nil)

 // A completion from an older write cannot cancel a new query with the same command.
 var staleID: UUID?
 pending.onWrite = {data,_ in
  if let staleID=staleID {waiting.finishQuery(Int(data[0]),id:staleID,error:appError("late write failure"))}
  staleID=waiting.queries[Int(data[0])]!.id
  waiting.peripheral(pending,didWriteValueFor:channel,error:nil)
  let characteristic=CBCharacteristic();characteristic.value=Data([data[0],203])
  waiting.peripheral(pending,didUpdateValueFor:characteristic,error:nil)
 }
 for _ in 0..<2 {let packet=try await waiting.query(112);precondition(packet["value"] as? Int == 203)}
 precondition(waiting.queries.isEmpty && waiting.queryTimeouts.isEmpty)
}
func checkUUID(_ mode:String,_ expected:Bool) {
 let device=CBPeripheral(UUID(uuidString:"ABC12345-1234-1234-1234-123456789ABC")!), other=CBPeripheral(UUID(uuidString:"ABC12345-1234-1234-1234-123456789ABD")!)
 let central=CBCentralManager(delegate:nil,queue:nil)
 if mode == "bridge" {
  let bridge=Bridge();bridge.central=central;bridge.connectID="fixture"
  bridge.centralManager(central,didDiscover:other,advertisementData:[:],rssi:0)
  precondition(central.connections.isEmpty)
  bridge.centralManager(central,didDiscover:device,advertisementData:[:],rssi:0)
 } else {
  let probe=Probe();probe.central=central
  probe.centralManager(central,didDiscover:other,advertisementData:[:],rssi:0)
  precondition(central.connections.isEmpty)
  probe.centralManager(central,didDiscover:device,advertisementData:[:],rssi:0)
 }
 precondition(central.connections == (expected ? [device.identifier] : []))
}
@main struct Check {
 static func main() async throws {
  if CommandLine.arguments[1] == "queries" {
   try await queryOrder(notificationFirst:true)
   try await queryOrder(notificationFirst:false)
   try await queryFailures()
  } else {checkUUID(CommandLine.arguments[1],CommandLine.arguments[2] == "match")}
  print("PASS")
 }
}
`;

test('native printer waits for response and write ACK; failures stop queries; Mac UUIDs match independent of case',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'p0-native-printer-'));
 try {
  const native=await readFile(resolve('ios/EnglishPrinter/PrinterService.swift'),'utf8');
  const bridge=await readFile(resolve('printer/bridge.swift'),'utf8');
  const probe=await readFile(resolve('printer/transport.swift'),'utf8');
  const withoutBluetooth=source=>source.replace('import CoreBluetooth','');
  const source=[bluetooth,withoutBluetooth(native),withoutBluetooth(bridge.slice(0,bridge.indexOf('\nlet bridge ='))),withoutBluetooth(probe.slice(0,probe.indexOf('\nlet probe='))),checks].join('\n');
  const main=join(dir,'main.swift'),exe=join(dir,'native-printer-check');
  await writeFile(main,source);
  execFileSync('swiftc',['-parse-as-library',main,'-o',exe],{stdio:'pipe',timeout:60_000});
  assert.equal(execFileSync(exe,['queries'],{encoding:'utf8',timeout:10_000}).trim(),'PASS');
  await mkdir(join(dir,'.local'));await mkdir(join(dir,'printer'));
  const upper='ABC12345-1234-1234-1234-123456789ABC';
  for(const mode of ['bridge','probe']) {
   const cwd=mode==='bridge'?dir:join(dir,'printer');
   for(const value of [upper,upper.toLowerCase(),'aBc12345-1234-1234-1234-123456789AbC',' \n'+upper.toLowerCase()+'\n']) {
    for(const location of ['environment','file']) {
     await writeFile(join(dir,'.local/printer-device-id'),location==='file'?value:'not-a-uuid');
     const env={...process.env};delete env.P0_DEVICE_ID;
     if(location==='environment')env.P0_DEVICE_ID=value;
     assert.match(execFileSync(exe,[mode,'match'],{cwd,env,encoding:'utf8',timeout:5000}),/PASS\s*$/);
    }
   }
   // An invalid environment value must not fall back to a valid file or match any device.
   await writeFile(join(dir,'.local/printer-device-id'),upper);
   assert.match(execFileSync(exe,[mode,'no-match'],{cwd,env:{...process.env,P0_DEVICE_ID:'invalid'},encoding:'utf8',timeout:5000}),/PASS\s*$/);
  }
 } finally {await rm(dir,{recursive:true,force:true})}
});
