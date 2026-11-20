import Foundation
import Capacitor
import UserNotifications
import UIKit

public final class PocketNotificationDelegate:NSObject, UNUserNotificationCenterDelegate {
    public static let shared = PocketNotificationDelegate()
    public func userNotificationCenter(_ center:UNUserNotificationCenter, willPresent notification:UNNotification, withCompletionHandler completionHandler:@escaping (UNNotificationPresentationOptions)->Void) {
        completionHandler([.banner,.sound,.list])
    }
    public func userNotificationCenter(_ center:UNUserNotificationCenter, didReceive response:UNNotificationResponse, withCompletionHandler completionHandler:@escaping ()->Void) {
        if let date=response.notification.request.content.userInfo["date"] as? String, date.range(of:"^\\d{4}-\\d{2}-\\d{2}$",options:.regularExpression) != nil {
            UserDefaults.standard.set(date,forKey:"pocket-pending-notification")
            NotificationCenter.default.post(name:Notification.Name("pocketNotificationOpened"),object:date)
        }
        completionHandler()
    }
}
@objc(PocketPushPlugin)
public class PocketPushPlugin:CAPPlugin, CAPBridgedPlugin {
    public let identifier="PocketPushPlugin"
    public let jsName="PocketPush"
    public let pluginMethods:[CAPPluginMethod]=[
        CAPPluginMethod(name:"status",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"register",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"unregister",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"pendingNotification",returnType:CAPPluginReturnPromise)]
    private var pending:CAPPluginCall?
    private var observers:[NSObjectProtocol]=[]
    public override func load() {
        observers.append(NotificationCenter.default.addObserver(forName:.capacitorDidRegisterForRemoteNotifications,object:nil,queue:.main){[weak self] n in
            guard let self=self,let data=n.object as? Data else {return}
            let token=data.map{String(format:"%02x",$0)}.joined()
            self.pending?.resolve(["provider":"apns","token":token,"environment":self.environment()]);self.pending=nil
        })
        observers.append(NotificationCenter.default.addObserver(forName:.capacitorDidFailToRegisterForRemoteNotifications,object:nil,queue:.main){[weak self] _ in
            self?.pending?.reject("无法连接 Apple 推送服务，请稍后重试。");self?.pending=nil
        })
        observers.append(NotificationCenter.default.addObserver(forName:Notification.Name("pocketNotificationOpened"),object:nil,queue:.main){[weak self] n in
            if let date=n.object as? String {self?.notifyListeners("notificationOpened",data:["date":date])}
        })
    }
    deinit {for observer in observers {NotificationCenter.default.removeObserver(observer)}}
    private func environment()->String {return Bundle.main.object(forInfoDictionaryKey:"PocketPushEnvironment") as? String ?? "development"}
    @objc func status(_ call:CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["configured":true,"enabled":UserDefaults.standard.bool(forKey:"pocket-push-enabled"),"permission":settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional])
        }
    }
    @objc func register(_ call:CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound,.badge]) { granted,_ in
            guard granted else {call.reject("请在系统设置中允许通知。");return}
            DispatchQueue.main.async {
                self.pending?.reject("新的注册请求已替代旧请求。")
                self.pending=call;UserDefaults.standard.set(true,forKey:"pocket-push-enabled")
                UIApplication.shared.registerForRemoteNotifications()
                DispatchQueue.main.asyncAfter(deadline:.now()+25) { [weak self] in
                    if self?.pending === call {self?.pending?.reject("注册推送超时，请稍后重试。");self?.pending=nil}
                }
            }
        }
    }
    @objc func unregister(_ call:CAPPluginCall) {
        DispatchQueue.main.async {
            UserDefaults.standard.set(false,forKey:"pocket-push-enabled")
            UIApplication.shared.unregisterForRemoteNotifications();call.resolve()
        }
    }
    @objc func pendingNotification(_ call:CAPPluginCall) {
        let date=UserDefaults.standard.string(forKey:"pocket-pending-notification")
        UserDefaults.standard.removeObject(forKey:"pocket-pending-notification")
        call.resolve(date.map{["date":$0]} ?? [:])
    }
}
