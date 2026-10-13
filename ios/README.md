# iOS 开发版

手机独立运行：本地打包 `web/` 界面和词典，WKWebView 与 Swift 原生层通信。手机直接请求翻译/Anthropic 服务，使用 CoreBluetooth 连接 P0，使用 Speech 与 AVAudioEngine 转文字；不依赖 Mac 网页服务或局域网后端。

模型 Key 仅保存到手机钥匙串，不打包 Mac 的 `.local/` 配置。首次使用在手机设置中重新填写模型配置。系统相册选择由 WKWebView 的文件选择器提供。

## 构建与安装

先读取项目与用户级 AGENTS.md，确认手机已配对、解锁、开启开发者模式；Xcode 中已有自己的开发者账号。复制 `Signing.example.xcconfig` 为 `Signing.local.xcconfig`，填写自己的团队 ID 和唯一 Bundle ID；本机签名文件不提交。原安装用户应保持原 Bundle ID，以保留钥匙串与聊天历史。

```sh
python3 ios/generate-project.py
xcodebuild -project ios/EnglishPrinter.xcodeproj -scheme EnglishPrinter \
  -configuration Debug -destination 'generic/platform=iOS' \
  -derivedDataPath ios/build -allowProvisioningUpdates build
xcrun devicectl list devices
xcrun devicectl device install app --device YOUR_DEVICE \
  ios/build/Build/Products/Debug-iphoneos/EnglishPrinter.app
xcrun devicectl device process launch --device YOUR_DEVICE YOUR_BUNDLE_ID
```

首次安装个人开发版需在 iPhone 设置 → 通用 → VPN 与设备管理中信任自己的开发者账号。个人团队签名有效期以 provisioning profile 为准，到期后重新构建安装。

蓝牙首次由手机按 P0 名称发现，连接并确认 203dpi / 96点后记录手机自己的 peripheral ID；Mac 的蓝牙 UUID 不能用于 iPhone。连接前在微打及 Mac 网页中断开。标签模板、官方编码 SDK 和完成状态判定保持一致；请求编号在 App 沙盒中落盘，结果不明时禁止自动补打。

`ios/build/`、IPA、签名 profile、用户设置及证书不进入 Git。首次真机的蓝牙出纸、语音、照片和模型调用需要验收；安装成功不等于这些均已通过。

## 首屏加载检查

内置资源目录与页面路径必须先统一解析符号链接，再校验路径归属。真机 App 容器可能分别以 `/private/var` 和 `/var` 表示，直接比较会误判资源不存在。页面通过 `loadFileURL` 加载，找不到资源时显示明确错误；不能静默保留空白页。SVG 遮罩使用内联 data URL，保证文件来源下图标正常显示。

## 调试日志与性能诊断（2026-10-12）

自 1.0（build 2）起启用手机本地诊断。Debug 编译时打开详细操作与请求阶段日志、WebKit 检查和前台卡顿监测；Release 编译时关闭详细日志与周期卡顿监测，保留启动元数据、错误、警告、慢请求及系统诊断。Release 仍生成 dSYM，优化等级沿用 `-O`。

日志为 JSONL，位于 App 沙盒 `Library/Application Support/Diagnostics/`，串行异步写盘，写入失败不影响业务。每条包含时间、进程运行时间、随机会话/请求编号、版本/构建号、级别和白名单字段。Debug 单文件 1 MiB、最多 5 个文件、最长 7 天；Release 单文件 256 KiB、最多 2 个文件、最长 3 天。容量先到则提前轮转，保留天数不是保证；升级与重启后继续保留未过期文件。目录排除系统备份，文件权限 0600，使用首次解锁后可写保护以支持短暂后台请求。排队超限丢弃事件并在后续条目标记 dropped；不承诺强杀瞬间最后一条一定写入。

覆盖启动/前后台/上次会话状态、页面加载与 WebKit 进程退出、网页异常位置与 Promise 拒绝、固定操作按钮、原生桥、模型 HTTP 状态/首字时间/总耗时/流中断/后台到期、打印渲染/发送/结果/防重/蓝牙状态、语音启动/结束/错误、内存与温度警告。网页与原生模型请求共用编号，打印编号与桥请求通过 parent 关联。常规设备状态轮询不记成功日志。请求失败记录系统错误域和错误码；模型协议错误 5101–5113、工具参数错误 6101–6110 可直接在源码定位。

不记录真实 API Key、配置 URL、HTTP 头/正文、聊天内容、译文、打印英文/音标、音频、识别文本、照片、设备姓名或完整错误描述/堆栈。JS 仅保存白名单资源名和行列号。MetricKit 仅保存报告时间、数值和最多 32 个二进制 UUID/偏移帧，不保存原始异常字符串或整份报告。不自动上传日志。

手机需已配对、解锁、信任 Mac，并已启动过此版本。采集只复制诊断目录，不导出整个沙盒或 Keychain：

```sh
xcrun devicectl list devices
node scripts/collect-ios-logs.mjs DEVICE_ID
```

结果保存在 Git 忽略的 `.local/diagnostics/ios/<采集时间>/`，包含原 JSONL 和汇总 `summary.json`。遇到问题先记住大概时间和操作，尽快采集；手机不在 Mac 可访问范围时不能远程拉取。不读取或上传其他 App 的系统日志。覆盖安装通常保留沙盒；卸载会丢失应用日志。

每次安装/发布前保留与安装产物完全匹配的 dSYM；仅保留源码不足以解析崩溃地址：

```sh
node scripts/archive-ios-symbols.mjs Debug
# Release 构建后：
node scripts/archive-ios-symbols.mjs Release
# 模拟器 Debug 产物：
node scripts/archive-ios-symbols.mjs Debug --simulator
```

符号按 Mach-O UUID 保存在 `.local/diagnostics/symbols/`，属于 Mac 构建资料，不计入手机日志上限。源码和符号不自动上传。`MXMetricManager` 已订阅崩溃、卡顿、CPU、磁盘异常和内存汇总；报告由 iOS 提供，可能延迟或缺失。上次会话未正常关闭只表示需要排查，不能据此断言崩溃。系统强杀/内存回收可能需要另行检查本 App 的系统 `.ips` 报告；应用日志不能替代系统崩溃报告。没有安装此版之前的问题无法补记。

## 本地聊天历史

对话通过原生桥原子保存于 `Library/Application Support/ChatHistory/history.json`；正常覆盖安装保留，不依赖 WebView 的安装包 URL。文件权限 0600，首次解锁后可访问，排除系统备份，不写入诊断日志。卸载 App 会删除历史。网页预览的 IndexedDB 与手机各自独立。

2026-10-12：已获授权同步当前 Web 界面及输入交互。原生 `/api/translate` 将双向请求适配到既有 MyMemory 服务；手机不使用 Mac 的百度本地凭证。Debug 包已构建，因配对手机不可用尚未覆盖安装；真机键盘及打印须安装后复测。


2026-10-12：Debug 已同步按模型配置的低思考请求。`model-options.json` 随 Web 资源打包，`glm-5.3-flash` 显式传 `output_config.effort=low`，其他模型不追加。Mac 12次实测更快，但两次low出现infuser音标重音错误；详细方法、局限和复现实验见[开发指南](../docs/development.md#付费模型基准)。


2026-10-12：ModelConfig独立为Swift文件并兼容旧Keychain数据，新增effort字段默认low；大模型设置支持low/high/max保存，现有密钥与历史继续保留。Debug构建通过，Web资源已与当前源码逐项核对。真机原生选择菜单和键盘交互仍需现场确认。

本次Debug最终包已覆盖安装并成功启动。已补充原生model-options.json只读资源白名单；17:53:47启动会话确认web.ready、配置读取200且无error事件。符号已按启动器及实际Debug动态库UUID归档。真机原生下拉菜单/键盘现场交互与实际出纸仍未验证；Web服务10290保持运行，模拟测试端口已释放。

2026-10-12 17:59：思考强度改为一行等宽 low/high/max 原生 radio 单选按钮，替代下拉菜单。28项自动检查及浏览器设置、键盘、单选保存回归通过；Debug包已覆盖安装并启动，符号归档。真机触摸现场操作和打印未验证。
