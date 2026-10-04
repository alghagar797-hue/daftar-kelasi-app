# دفتر کلاسی من — نسخه 5.1.0

نسخه پایدار آماده ساخت APK.

## اصلاح اصلی این نسخه

- خطای `The requested version (4) is less than the existing version (5)` اصلاح شده است.
- نسخه پایگاه داده IndexedDB حساب‌ها از درخواست نسخه 4 به نسخه 5 ارتقا داده شده و دیگر برنامه در دستگاه‌هایی که DB نسخه 5 دارند با خطای Downgrade باز نمی‌شود.
- نگهداری فهرست دانش‌آموزان در مسیر مستقل و پشتیبان محلی حفظ شده است.
- ارتقای APK افزایشی است: برای نصب نسخه جدید، برنامه قبلی را حذف یا Clear Data نکنید.

## مشخصات APK

- Version name: 5.1.0
- Version code: 17
- Application ID: com.classroom.daftar
- Min SDK: 23
- Target SDK: 36
- Compile SDK: 36
- Java: 17
- Gradle: 8.13
- Android Gradle Plugin: 8.13.2

## ساخت APK در GitHub Actions

1. کل پوشه را در ریشه یک Repository قرار دهید.
2. Secrets زیر را در Repository نگه دارید/تنظیم کنید:
   - KEYSTORE_BASE64
   - KEYSTORE_PASSWORD
   - KEY_ALIAS
   - KEY_PASSWORD
3. از Actions، workflow با نام `Build Android Release APK v5.1.0` را اجرا کنید.
4. بعد از سبز شدن Build، Artifact با نام `DaftarKelasi-APK-v5.1.0` را دانلود کنید.

## نکته مهم برای اطلاعات قبلی

نسخه جدید را روی نسخه قبلی نصب کنید و برنامه قبلی را uninstall نکنید. حذف برنامه یا Clear Data می‌تواند اطلاعات محلی WebView/IndexedDB را از بین ببرد.
