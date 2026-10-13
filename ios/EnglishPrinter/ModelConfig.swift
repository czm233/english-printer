import Foundation
import Security

struct ModelConfig: Codable {
    var url = "", model = "", apiKey = "", effort = "low"
    static let efforts = ["low","high","max"]
    func requestOptions(_ options: [String:[String:Any]]) -> [String:Any] {
        guard var value = options[model] else {return [:]}
        var output = value["output_config"] as? [String:Any] ?? [:];output["effort"] = effort;value["output_config"] = output;return value
    }
    var publicValue: [String: Any] { ["url":url,"model":model,"effort":effort,"keyConfigured": !apiKey.isEmpty,"configured": !url.isEmpty && !model.isEmpty && !apiKey.isEmpty] }
    static let query: [String: Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:(Bundle.main.bundleIdentifier ?? "com.example.englishprinter"),kSecAttrAccount as String:"anthropic"]
    static func load() throws -> Self {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return Self() }
        guard status == errSecSuccess, let data = result as? Data else { throw appError("无法读取大模型配置，请解锁手机后重试。") }
        return try JSONDecoder().decode(Self.self, from:data)
    }
    func save() throws {
        let data = try JSONEncoder().encode(self)
        let attrs: [String:Any] = [kSecValueData as String:data,kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(Self.query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var q = Self.query; attrs.forEach { q[$0] = $1 }
            guard SecItemAdd(q as CFDictionary,nil) == errSecSuccess else { throw appError("配置保存失败，请重试。") }; return
        }
        guard status == errSecSuccess else { throw appError("配置保存失败，请重试。") }
    }
    static func endpoint(_ text: String) throws -> URL {
        guard var u = URLComponents(string:text), u.scheme == "https", let host = u.host, !host.isEmpty, u.user == nil, u.password == nil, u.query == nil, u.fragment == nil else { throw appError("请填写有效的 HTTPS API URL。") }
        var path = u.path; while path.hasSuffix("/") {path.removeLast()}
        if !path.hasSuffix("/messages") {path += path.hasSuffix("/v1") ? "/messages" : "/v1/messages"}
        u.path = path; guard let url = u.url else {throw appError("API URL 无效。")}; return url
    }
    static func update(_ body: [String:Any]) throws -> Self {
        let old = try load(); var next = Self(url:(body["url"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines),model:(body["model"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines),apiKey:(body["apiKey"] as? String ?? "").trimmingCharacters(in:.whitespacesAndNewlines))
        if let value = body["effort"] {
            guard let value = value as? String, Self.efforts.contains(value) else {throw appError("请选择有效的思考强度。")};next.effort = value
        } else {next.effort = old.effort}
        let endpoint = try Self.endpoint(next.url)
        guard next.url.count <= 2048, !next.model.isEmpty, next.model.count <= 200, next.model.rangeOfCharacter(from:.whitespacesAndNewlines) == nil else {throw appError("请填写有效的模型 ID。")}
        if next.apiKey.isEmpty, (try? Self.endpoint(old.url)) == endpoint {next.apiKey = old.apiKey}
        guard !next.apiKey.isEmpty, next.apiKey.count <= 8192, !next.apiKey.contains("\n"), !next.apiKey.contains("\r") else {throw appError("请填写 API Key；更换 API URL 后需要重新填写。")}
        try next.save(); return next
    }
}
// Keep existing Keychain configurations readable when the new field is absent.
extension ModelConfig {
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy:CodingKeys.self)
        self.init(url:try values.decode(String.self,forKey:.url),model:try values.decode(String.self,forKey:.model),apiKey:try values.decode(String.self,forKey:.apiKey),effort:values.contains(.effort) ? try values.decode(String.self,forKey:.effort) : "low")
        guard Self.efforts.contains(effort) else {throw DecodingError.dataCorruptedError(forKey:.effort,in:values,debugDescription:"Invalid effort")}
    }
}
