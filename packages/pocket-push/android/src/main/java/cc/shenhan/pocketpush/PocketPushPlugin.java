package cc.shenhan.pocketpush;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.content.pm.PackageManager;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import cn.jpush.android.api.JPushInterface;

@CapacitorPlugin(name="PocketPush", permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class PocketPushPlugin extends Plugin {
    private boolean configured() {
        try {
            String key=getContext().getPackageManager().getApplicationInfo(getContext().getPackageName(),PackageManager.GET_META_DATA).metaData.getString("JPUSH_APPKEY", "");
            return key.matches("[a-fA-F0-9]{24}") && !key.equals("000000000000000000000000");
        } catch(Exception e) {return false;}
    }
    private boolean allowed() {return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();}
    private boolean enabled() {return getContext().getSharedPreferences("pocket-push",0).getBoolean("enabled",false);}
    private void enabled(boolean value) {getContext().getSharedPreferences("pocket-push",0).edit().putBoolean("enabled",value).apply();}
    private void initialize() {
        if(Build.VERSION.SDK_INT>=26) {
            NotificationChannel channel=new NotificationChannel("daily-digest","每日日报",NotificationManager.IMPORTANCE_DEFAULT);
            getContext().getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        JPushInterface.setDebugMode(false);
        JPushInterface.setStatisticsEnable(false);
        JPushInterface.setGeofenceEnable(getContext(),false);
        JPushInterface.setDataInsightsEnable(getContext(),false);
        JPushInterface.init(getContext());
        JPushInterface.resumePush(getContext());
    }
    @Override public void load() {if(configured() && enabled() && allowed())initialize();}
    @PluginMethod public void status(PluginCall call) {
        JSObject result=new JSObject(); result.put("configured",configured());result.put("enabled",enabled());result.put("permission",allowed());call.resolve(result);
    }
    @PluginMethod public void register(PluginCall call) {
        if(!configured()) {call.reject("推送应用尚未配置");return;}
        if(Build.VERSION.SDK_INT>=33 && getPermissionState("notifications")!=PermissionState.GRANTED) {
            requestPermissionForAlias("notifications",call,"permissionResult");return;
        }
        beginRegistration(call);
    }
    @PermissionCallback private void permissionResult(PluginCall call) {beginRegistration(call);}
    private void beginRegistration(PluginCall call) {
        if(!allowed()) {call.reject("请在系统设置中允许通知");return;}
        enabled(true);initialize();
        Handler handler=new Handler(Looper.getMainLooper());
        handler.post(new Runnable() {
            int remaining=40;
            @Override public void run() {
                if(!enabled()) {call.reject("已关闭推送");return;}
                String token=JPushInterface.getRegistrationID(getContext());
                if(token!=null && !token.isEmpty()) {
                    JSObject result=new JSObject();result.put("provider","jpush");result.put("token",token);result.put("environment","production");call.resolve(result);
                } else if(--remaining>0)handler.postDelayed(this,500);
                else call.reject("未能连接推送服务，请稍后重试");
            }
        });
    }
    @PluginMethod public void unregister(PluginCall call) {enabled(false);if(configured())JPushInterface.stopPush(getContext());call.resolve();}
    @PluginMethod public void pendingNotification(PluginCall call) {call.resolve(new JSObject());}
}
