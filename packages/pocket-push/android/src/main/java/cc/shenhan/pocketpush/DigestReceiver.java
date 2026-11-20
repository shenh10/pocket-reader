package cc.shenhan.pocketpush;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import cn.jpush.android.service.JPushMessageReceiver;
import cn.jpush.android.api.NotificationMessage;
import org.json.JSONObject;
public class DigestReceiver extends JPushMessageReceiver {
    @Override public void onNotifyMessageOpened(Context context, NotificationMessage message) {
        try {
            String date=new JSONObject(message.notificationExtras).optString("date");
            if(!date.matches("\\d{4}-\\d{2}-\\d{2}"))return;
            Intent intent=context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
            if(intent==null)return;
            intent.setAction(Intent.ACTION_VIEW).setData(Uri.parse("pocketreader://daily?date="+date));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
            context.startActivity(intent);
        } catch(Exception ignored) {}
    }
}
