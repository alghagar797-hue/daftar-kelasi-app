# سرور ابری دفتر کلاسی — v3.0.0

سرور کامل و سازگار با اپلیکیشن «دفتر کلاسی من» (کلاینت v7.5.1 و نسخهٔ اصلاح‌شدهٔ همراه این بسته).

## امکانات
- ثبت‌نام و ورود با توکن امن (هش scrypt + توکن امضاشدهٔ HMAC — بدون وابستگی خارجی)
- تفکیک کامل دادهٔ هر مدرسه با «کد عضویت»؛ اولین حسابِ ثبت‌نام‌شدهٔ بدون کد = مدیر مدرسه
- همگام‌سازی داده با تشخیص تعارض (پاسخ ۴۰۹) مطابق پروتکل `X-Daftar-Protocol: 1`
- API پنل مدیر: آمار مدرسه، پروندهٔ معلمان، بازخورد
- ساخت خودکار جداول در اولین اجرا (رفع علت خطای `SERVER_ERROR` سرور قبلی)
- دو درایور ذخیره‌سازی: PostgreSQL (تولیدی) و فایل JSON (تست محلی)

## اجرای سریع محلی
```bash
npm install
npm start          # http://localhost:3000/api/health
```

## استقرار روی Render (تولیدی)
1. در داشبورد Render یک **PostgreSQL** رایگان بسازید و `Internal Database URL` را کپی کنید.
2. یک **Web Service** (Node) بسازید؛ Build: `npm install` ، Start: `npm start`.
3. در Environment این متغیرها را بدهید:
   - `DATABASE_URL` = آدرس دیتابیس مرحلهٔ ۱
   - `TOKEN_SECRET` = یک رشتهٔ تصادفی طولانی (بعد از استقرار تغییرش ندهید)
   - `PORT` = 3000 (Render خودش مدیریت می‌کند)
4. سرویس را Deploy کنید و سلامت را با `/api/health` بررسی کنید.

> ⚠️ PostgreSQL رایگان Render پس از ۳۰ روز حذف می‌شود؛ برای دادهٔ واقعی تمدید کنید یا به سرویس دیگری منتقل کنید. بدون `DATABASE_URL` سرور با ذخیرهٔ فایلی بالا می‌آید که فقط برای تست است.

## قرارداد API (سازگار با کلاینت)
| مسیر | توضیح |
|---|---|
| `POST /api/auth/register` | `{username,password,schoolCode?}` — بدون کد: ساخت مدرسه + نقش admin؛ با کد: عضویت معلم |
| `POST /api/auth/login` | `{username,password}` → `{token, teacher:{role,schoolId}}` |
| `GET /api/auth/me` | استعلام نقش و مدرسهٔ کاربر جاری (Bearer) |
| `POST /api/school/join` | اتصال حساب به مدرسه با کد (Bearer) |
| `GET /api/sync/pull` | دریافت آخرین اسنپ‌شات دادهٔ معلم |
| `POST /api/sync/push` | ارسال اسنپ‌شات `{revision,baseRevision,payload}`؛ تعارض → ۴۰۹ |
| `GET /api/admin/overview` | آمار مدرسه + فهرست معلمان همان مدرسه (فقط admin) |
| `GET /api/admin/teacher/:id/snapshot` | پروندهٔ دادهٔ یک معلم (فقط admin همان مدرسه) |
| `GET/POST /api/admin/teacher/:id/feedback` | خواندن/ثبت بازخورد مدیر برای معلم |

## تست
یک مجموعهٔ تست کامل ۱۴ مرحله‌ای (سلامت، ثبت‌نام مدیر، عضویت معلم، push/pull، تعارض، دسترسی‌ها، بازخورد) در هنگام تحلیل اجرا و تأیید شده است.
