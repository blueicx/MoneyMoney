@echo off
title Build MoneyMoney APK
cd /d "E:\MYC\predict-fun-trader"

echo.
echo  ==========================================
echo    Building Android APK...
echo  ==========================================
echo.

set ANDROID_HOME=C:\Users\blueice\AppData\Local\Android\Sdk
cd android
call gradlew assembleDebug

if exist "app\build\outputs\apk\debug\app-debug.apk" (
    echo.
    echo  ==========================================
    echo    SUCCESS! APK created at:
    echo    android\app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo    Transfer to your phone and install it.
    echo  ==========================================
) else (
    echo.
    echo  Build failed. Check errors above.
)
pause
