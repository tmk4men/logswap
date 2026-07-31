import UIKit
import Capacitor
#if canImport(AppTrackingTransparency)
import AppTrackingTransparency
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// ATT の要求を1回だけ出すためのフラグ。
    private var didRequestTracking = false

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.

        // App Tracking Transparency（App Store 審査 5.1.2(i)）。
        // 以前は WebView 側（js/ads.js）から AdMob プラグイン経由で呼んでいたが、
        // WebView の読み込み状況やプラグインの登録状況に左右されるため、ネイティブで
        // 起動直後に必ず1回出す。ここが許諾ダイアログの唯一の起点。
        requestTrackingAuthorizationIfNeeded()
    }

    /// 未回答のときだけ ATT の許諾ダイアログを表示する。
    /// iOS はアプリが active でない間に要求するとダイアログを出さずに完了してしまうため、
    /// active になってから少し待って要求し、その時点で active でなければ次回に持ち越す。
    private func requestTrackingAuthorizationIfNeeded() {
        #if canImport(AppTrackingTransparency)
        if #available(iOS 14, *) {
            if didRequestTracking { return }
            if ATTrackingManager.trackingAuthorizationStatus != .notDetermined { return }
            didRequestTracking = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                guard UIApplication.shared.applicationState == .active else {
                    self?.didRequestTracking = false
                    return
                }
                ATTrackingManager.requestTrackingAuthorization { _ in }
            }
        }
        #endif
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
