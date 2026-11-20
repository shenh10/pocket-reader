#!/usr/bin/env bash
set -euo pipefail
mkdir -p test-results/android
collect_results() {
  adb pull /sdcard/Download/native-daily-styled.png test-results/android/native-daily-styled.png || true
  adb pull /sdcard/Download/native-daily-failure.png test-results/android/native-daily-failure.png || true
  adb logcat -d > test-results/android/logcat.txt || true
}
trap collect_results EXIT
./android/gradlew -p android --no-daemon connectedDebugAndroidTest
