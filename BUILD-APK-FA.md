# ساخت APK و نصب/بروزرسانی — دفتر کلاسی من v8.2.0

بدون Android Studio، فقط با گیت‌هاب. (جزئیات فنی: `app/build.gradle` — versionName 8.2.0 / versionCode 40، compileSdk 36، Java 17، Gradle 8.13)

---

## ۱. ساخت APK با GitHub Actions (روش رسمی)

1. محتویات این پوشه (فایل‌های داخل `daftar-kelasi-app-main`، نه خود پوشه) را در ریشهٔ مخزن گیت‌هاب بریزید و commit بزنید.
2. در مخزن به **Settings → Secrets and variables → Actions** بروید و این ۴ Secret را داشته باشید (اگر قبلاً ساخته‌اید، دست نزنید):
   - `KEYSTORE_BASE64` — فایل keystore امضا، به‌صورت Base64؛
   - `KEYSTORE_PASSWORD` · `KEY_ALIAS` · `KEY_PASSWORD`.
   
   اگر هنوز keystore ندارید، یک‌بار بسازید (روی هر رایانه‌ای با JDK):
   ```
   keytool -genkeypair -v -keystore daftar-release.keystore -alias daftar -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 daftar-release.keystore   # خروجی را در KEYSTORE_BASE64 بگذارید
   ```
   ⚠️ keystore را گم نکنید؛ بدون همان، بروزرسانی درون‌پذیر ممکن نیست و باید برنامه را از اول نصب کنید.
3. تب **Actions** → گردش‌کار **Build Android Release APK** → Run workflow (یا فقط push کنید).
4. پس از سبز شدن، از همان اجرا در بخش **Artifacts** فایل **`DaftarKelasi-APK-v8.2.0`** را دانلود کنید؛ داخلش `DaftarKelasi.apk` است.

گردش‌کار جدید یک گام **بازبینی سالم بودن جاوااسکریپت** دارد: اگر `index.html` خطای نحوی داشته باشد، ساخت به‌جای بسته‌بندیِ نسخهٔ خراب، شکست می‌خورد.

## ۲. نصب روی گوشی

1. فایل APK را به گوشی ببرید و بازش کنید؛ اگر پرسید، اجازهٔ «نصب از این منبع» را بدهید.
2. Play Protect ممکن است هشدار «برنامهٔ ناشناس» بدهد — «نصب به هر حال» را بزنید (برنامه امضای شخصی شما را دارد، فروشگاه نیست).

## ۳. بروزرسانی نسخهٔ نصب‌شده (حفظ کامل داده)

- **برنامه را حذف نکنید.** APK جدید را مستقیم نصب کنید؛ اندروید آن را جایگزین می‌کند و همهٔ داده‌ها (حساب، دانش‌آموزان، عکس‌ها) سر جایشان می‌ماند.
- اگر گوشی پیام «App not installed» داد: مطمئن شوید APK امضاشده با همان keystore قبلی است (Secrets تغییر نکرده باشند) و نسخهٔ جدید `versionCode` بزرگ‌تر است (40 > 39 ✔).
- پیش از بروزرسانی، طبق `BACKUP-GUIDE-FA.md` پشتیبان دستی بگیرید. پشتیبان خودکار روزانه هم در `Download/DaftarKelasiBackups` هست و با نصب جدید پاک نمی‌شود.

## ۴. سایت (Render) — اختیاری

این نسخه عمداً بدون اتصال خودکار به سرور است. اگر خواستید سرویس ابری/پنل آنلاین مدیر را دوباره فعال کنید:
1. پوشهٔ `backend` را به‌عنوان Root Directory سرویس Render بگذارید (Build: `npm install`، Start: `npm start`).
2. متغیرهای محیطی: `DATABASE_URL`، `TOKEN_SECRET` (≥۳۲ نویسه، بعداً تغییرش ندهید)، اختیاری `ADMIN_SETUP_KEY` (≥۲۰ نویسه) و اگر پشت پروکسی هستید `TRUST_PROXY=1`.
3. سلامت: `https://<سرویس>.onrender.com/api/health` باید `version: "3.2.0"` بدهد.
4. برای اتصال برنامه: در `index.html` مقدار `window.DAFTAR_CLOUD_ENDPOINT` را نشانی سرویس بگذارید و سه کپی (`index.html` ریشه، `backend/public/index.html`، `app/src/main/assets/index.html`) را همسان نگه دارید (گردش‌کار APK خودش همسان می‌کند).

## ۵. چه چیزهایی در این محیط ساخته/آزمون نشد

- APK واقعی اینجا ساخته نشد (به keystore امضای شما نیاز دارد) — گردش‌کار آماده و بازبینی‌شده است.
- میکروفون و تشخیص گفتار روی دستگاه واقعی باید توسط شما آزمون شود؛ پل بومی اندروید (fa-IR → fa → روی‌دستگاه) و مجوزها طبق کد بازبینی شده‌اند.
