import UIKit
import Capacitor
#if canImport(AppTrackingTransparency)
import AppTrackingTransparency
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// ATT の要求が進行中かどうか（多重に呼ばないためのガード）。
    private var trackingRequestInFlight = false
    /// ATT の要求を試した回数。ダイアログが出せずに終わったときだけ増える。
    private var trackingRequestAttempts = 0

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
        // 起動直後に出す。ここが自動表示の起点。
        // 手動の導線はプロフィール画面の「広告のトラッキング設定」にもある
        // （回答済み・端末側でトラッキング要求が禁止されていると自動では何も出ないため）。
        requestTrackingAuthorizationIfNeeded()
    }

    /// 未回答のときだけ ATT の許諾ダイアログを表示する。
    ///
    /// iOS はアプリが active でない間に要求するとダイアログを出さずに完了してしまう。
    /// さらに、active でも起動直後のウインドウ生成前だと「呼んだのに出ない」ことがあり、
    /// そのとき完了ハンドラには .notDetermined のまま返ってくる（＝出せなかった合図）。
    /// なので出せなかったら諦めずに数回やり直す。
    private func requestTrackingAuthorizationIfNeeded() {
        #if canImport(AppTrackingTransparency)
        if #available(iOS 14, *) {
            if trackingRequestInFlight { return }
            // 回答済み（許可/拒否/制限）なら OS がもうダイアログを出さないので何もしない。
            if ATTrackingManager.trackingAuthorizationStatus != .notDetermined { return }
            if trackingRequestAttempts >= 5 { return }
            trackingRequestInFlight = true
            trackingRequestAttempts += 1
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                guard UIApplication.shared.applicationState == .active else {
                    // まだ active でない＝出しても無視される。次の active でやり直す。
                    self?.trackingRequestInFlight = false
                    self?.trackingRequestAttempts -= 1
                    return
                }
                ATTrackingManager.requestTrackingAuthorization { status in
                    DispatchQueue.main.async {
                        self?.trackingRequestInFlight = false
                        // 未回答のまま返った＝ダイアログを出せていない。少し待って再挑戦。
                        if status == .notDetermined {
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                                self?.requestTrackingAuthorizationIfNeeded()
                            }
                        }
                    }
                }
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
