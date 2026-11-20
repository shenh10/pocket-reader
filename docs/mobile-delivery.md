# Mobile delivery

The app renders the same web source as GitHub Pages. The native bundle contains the reading UI and tutorials, never daily reports. Reports are fetched from the hosted Supabase Edge API, with a local cache of previously fetched content.

## Page updates

Every Pages deployment also builds `_mobile`, signs/encrypts a zip using the Capgo v2 protocol, and publishes `updates/latest.json` plus a content-addressed bundle. The app checks on launch; it downloads a compatible version, verifies its signature in native code, and activates it when backgrounded/restarted. It does not interrupt reading. If the new shell does not initialize within 20 seconds, the updater rolls back. Manual checking is available in Settings.

`POCKET_UPDATE_PRIVATE_KEY` lives only in GitHub Actions secrets. The matching RSA public key is pinned in `capacitor.config.json`. Never rotate it without arranging a new native release. No Capgo account or hosted service is used; telemetry is disabled. The checksum covers the plaintext zip. The encryption protocol authenticates releases; it is not intended to hide public website content.

The manifest requires an exact native `versionName` / `MARKETING_VERSION` match. Interface, tutorial, CSS and JS edits need only a Pages deployment. Native SDKs, permissions, app identity and signing changes require a new APK/iOS release and a bumped native version. Version 0.2 has no updater, so users must install 0.3 once. Only the latest native version receives new page releases in this first implementation.

## Push path

1. The user enables notifications in the installed app and grants OS permission.
2. The native plugin obtains a JPush registration ID on Android or an APNs device token on iOS.
3. `PUT /v1/push/devices/{installation UUID}` registers that device with a random per-install capability in the Authorization header. Tokens and capability hashes live in the private database schema, outside public APIs. DELETE unsubscribes. Invalid devices are retired on provider rejection.
4. The daily collector stores the completed issue, then enqueues only that latest issue. The unique device/date constraint prevents re-enqueueing the same issue during reruns/backfills. A lease prevents concurrent workers from sending the same row. Failed attempts retry with backoff, up to 5 attempts, and expire after 24 hours. A separate workflow retries without rerunning the collector.
5. The server sends a notification containing a date and short summary through JPush/APNs. Tapping it opens that date and fetches the report from the API. No report body is embedded in the app or the notification.

A successful provider response means accepted for delivery, not proof that the phone displayed it. A timeout after acceptance can result in a repeated alert on retry; this is not an exactly-once transport. APNs collapse IDs coalesce pending messages. Uninstall is detected when a provider rejects a token; stale subscriptions also stop being selected after 180 days without renewal.

## Database setup

Apply `ai-infra-board/db/push-schema.sql` once with the Supabase project administrator (`supabase db query --linked --file db/push-schema.sql` from ai-infra-board). The existing `aiinfra_app` role intentionally cannot create schemas. Runtime access is limited to the private push tables; anon/authenticated/service_role receive no grants. Normal `db:setup` continues to work without administrator privileges.

## Credentials and commissioning still required

Android uses JPush 6.3.1. Create an Android app for `cc.shenhan.pocketreader` and set GitHub Actions secrets `JPUSH_APP_KEY` and `JPUSH_MASTER_SECRET`. The app key is a public SDK identifier compiled into the Android package; the master secret stays server-side. Without the app key, the APK deliberately refuses to register rather than reporting false success.

Mainland Android background delivery also needs manufacturer channels (Huawei/Honor, Xiaomi, OPPO and vivo) appropriate to the target phones. Those vendor SDKs/app IDs and console bindings are not yet provisioned or included; the base JPush transport alone must not be presented as reliable delivery after the app is killed. Finish this integration once the accounts and target devices are known, before distributing the final APK.

For iOS, enable Push Notifications for `cc.shenhan.pocketreader`, supply a signing team/profile, and store `APNS_KEY_ID`, `APNS_TEAM_ID`, and the p8 contents in `APNS_PRIVATE_KEY` as GitHub Actions secrets. Debug uses development APNs, Release uses production. The backend sends directly to APNs over HTTP/2 with ES256 token authentication.

Once credentials and channels are verified, set Supabase Edge secret `POCKET_PUSH_PROVIDERS` to `apns`, `jpush`, or `apns,jpush`. Until then the settings UI accurately reports that the channel is awaiting configuration. Do not put server secrets into source, the APK, Pages, or chat.

Before marking push live, install a credentialed build, enable notifications, confirm device registration, deliver one test issue to that device, and verify notification taps both while the app is running and after it has been closed. Repeat with notifications disabled to verify unsubscribe. Web tests and an APK compile cannot establish actual delivery.

Official references: [JPush Android integration](https://docs.jiguang.cn/jpush/client/Android/android_guide), [JPush send API](https://docs.jiguang.cn/jpush/server/push/rest_api_v3_push), [APNs token connection](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns), [Capacitor Updater source](https://github.com/Cap-go/capacitor-updater).
