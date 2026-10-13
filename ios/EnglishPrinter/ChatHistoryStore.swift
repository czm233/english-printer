import Foundation

// A stable sandbox path survives application bundle replacement. No content is logged.
actor ChatHistoryStore {
    static let shared = ChatHistoryStore()
    private let file: URL
    init(file: URL? = nil) {
        self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ChatHistory", isDirectory: true).appendingPathComponent("history.json")
    }
    func access(method: String, body: [String: Any]) throws -> Any {
        do {
            if method == "GET" {
                guard FileManager.default.fileExists(atPath: file.path) else {return NSNull()}
                return try JSONSerialization.jsonObject(with: Data(contentsOf: file))
            }
            guard method == "POST", body["version"] as? Int == 1,
                  body["sessions"] is [Any], body["cards"] is [Any], body["choices"] is [Any] else {
                throw NSError(domain: "ChatHistory", code: 1)
            }
            let data = try JSONSerialization.data(withJSONObject: body)
            guard data.count <= 64 * 1024 * 1024 else {throw NSError(domain: "ChatHistory", code: 2)}
            let directory = file.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
            var excluded = directory
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            try excluded.setResourceValues(values)
            #if os(iOS)
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: file, options: [.atomic])
            #endif
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            return ["ok": true]
        } catch {
            // Generic text only; underlying errors may contain sandbox paths.
            throw NSError(domain: "ChatHistory", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "历史记录读写失败，请检查存储空间后重试。"])
        }
    }
}
