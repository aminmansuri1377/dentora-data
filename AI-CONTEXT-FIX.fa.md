# ظرفیت زمینهٔ Ollama برای درس ۱۰۸۲

مبنای patch: کامیت `b4daa12` شاخه main ریپوی dentora-data.

خطای ثبت‌شده می‌گوید درخواست ۸۵۱۲ توکن دارد و ظرفیت تنظیم‌شده ۸۱۹۲ توکن است. کوچک‌کردن تصویر به‌تنهایی کافی نبود. این اصلاح گزینهٔ `--ai-context-size` را هم به کرولر و هم به تست محلی درس اضافه می‌کند و آن را به `options.num_ctx` درخواست Ollama می‌رساند.

پیش‌فرض همچنان ۸۱۹۲ است. برای این درس ۱۲۲۸۸ انتخاب کن. اعداد صحیح از ۸۱۹۲ تا ۳۲۷۶۸، مضرب ۱۰۲۴ پذیرفته می‌شوند. افزایش ظرفیت مصرف حافظه را بالا می‌برد و ممکن است بر زمان پردازش اثر بگذارد؛ این اصلاح تضمین سرعت یا دقت پاسخ نیست. متن اصلی، تصاویر، ترتیب صفحات و منطق تأیید پاسخ از سایت تغییر نمی‌کنند. فایل‌های داده یا نشست ورود در patch نیستند.

## اعمال

فایل patch را در ریشهٔ پروژه قرار بده:

```powershell
git apply --check .\Dentora-ai-context-fix.patch
git apply .\Dentora-ai-context-fix.patch
npm run typecheck
```

وابستگی جدیدی اضافه نشده و نسخهٔ package تغییر نمی‌کند. اصلاح‌های قبلی، از جمله رفع گزینه‌های NULL، بازگردانده نمی‌شوند.

## تست محلی بدون مصرف قلب

```powershell
npm run ai:check:lesson -- --lesson 1082 --output .\output-implant-prosthetics --model qwen3-vl:2b-instruct --ai-image-max-edge 768 --ai-context-size 12288
```

باید در `AI_REQUEST` مقدار `contextSize:12288` را ببینی. در صورت موفقیت `AI_LESSON_CHECK_OK` نمایش داده می‌شود. این تست فقط درخواست محلی و قالب پاسخ را بررسی می‌کند؛ پاسخ تأیید علمی یا تأیید سایت نیست.

## ادامه

```powershell
npm run crawl -- --auth .\auth\dentigo-auth.json --answer-mode ai --ai-model qwen3-vl:2b-instruct --ai-reference-chars 600 --ai-image-max-edge 768 --ai-context-size 12288 --resume --auto-refill --max-gems 960 --keep-open-on-error --output .\output-implant-prosthetics
```

تخصص پروتز ایمپلنت را در فهرست درس‌ها انتخاب کن و در ترمینال Enter بزن. از همان خروجی قبلی استفاده کن؛ `--force` اضافه نکن. بودجهٔ ۹۶۰ الماس برای هر اجرای جدید است.

اگر دوباره خطایی آمد، پیام کامل `AI_HTTP_ERROR` و `AI_LESSON_CHECK_FAILED` را بفرست. در این محیط به Ollama رایانهٔ کاربر دسترسی نیست؛ انتقال تنظیم ظرفیت با درخواست شبیه‌سازی‌شده و داده‌های واقعی درس بررسی شده است.
