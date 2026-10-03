# فعال‌سازی آنلاین واقعی

نسخه 4.2 کلاینت آنلاین/آفلاین را آماده کرده و اگر `DAFTAR_CLOUD_ENDPOINT` خالی باشد، رفتار آفلاین قبلی حفظ می‌شود.

## فعال‌سازی
در ابتدای `app/src/main/assets/index.html` مقدار زیر را به URL عمومی Backend تغییر دهید:

```js
window.DAFTAR_CLOUD_ENDPOINT="https://YOUR-DOMAIN";
```

سپس APK جدید را بسازید.

Backend آماده در پوشه `backend/` قرار دارد و APIهای ثبت‌نام، ورود، pull/push همگام‌سازی و آپلود فایل را ارائه می‌کند.

## نکته تولیدی
برای انتشار واقعی از HTTPS، PostgreSQL پایدار و Object Storage (S3-compatible) استفاده کنید. فایل‌های پوشه `backend/uploads` برای محیط موقت هستند و برای مقیاس بالا باید به فضای ابری منتقل شوند.
