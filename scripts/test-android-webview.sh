#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/android
collect_results() {
  adb pull /sdcard/Android/data/cc.shenhan.pocketreader/files/native-daily-styled.png test-results/android/native-daily-styled.png || true
  adb logcat -d > test-results/android/logcat.txt || true
}
trap collect_results EXIT
./android/gradlew -p android --no-daemon connectedDebugAndroidTest
