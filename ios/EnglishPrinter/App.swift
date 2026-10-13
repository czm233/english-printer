import UIKit
import WebKit

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey:Any]?) -> Bool {AppDiagnostics.shared.start();return true}
    func applicationWillTerminate(_ application: UIApplication) {AppDiagnostics.shared.terminate()}
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = PrinterViewController()
        self.window = window
        window.makeKeyAndVisible()
    }
}
func appError(_ text: String, code: Int = 1) -> NSError { NSError(domain:"EnglishPrinter",code:code,userInfo:[NSLocalizedDescriptionKey:text]) }
