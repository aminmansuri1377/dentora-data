# اصلاح ۳٫۳٫۱ — پاسخ ناقص Ollama

فایل‌ها را روی پروژه فعلی جایگزین کنید و auth و .session و خروجی‌ها را نگه دارید. AI_INCOMPLETE_RESPONSE در نسخه قبلی پس از پاسخ موفق HTTP ولی نبودن جواب نهایی یا done=true رخ می‌داد؛ دلیل دقیق قبلاً گزارش نمی‌شد. سقف خروجی ۲۵۶ ممکن بود قبل از رسیدن به جواب نهایی تمام شود. اکنون سقف ۲۰۴۸ و در تلاش دوم ۴۰۹۶ است. درخواست حداکثر ۱۰ دقیقه مهلت دارد و هر ۱۵ ثانیه AI_WAITING نشان می‌دهد. افزایش مهلت تضمین رفع مشکل نیست و سرعت به سخت‌افزار وابسته است.

```powershell
npm install
npm run ai:check
```

این تست فقط API محلی را با یک سؤال حساب ساده آزمایش می‌کند؛ مرورگر سایت باز نمی‌شود و قلب یا الماسی مصرف نمی‌شود. پیام AI_OK یعنی پاسخ JSON معتبر و پاسخ حساب درست بود. دقت تخصصی را تضمین نمی‌کند. AI_RESPONSE شامل doneReason، outputTokens، hasThinking و answerChars است؛ متن تفکر ذخیره یا چاپ نمی‌شود. گزارش در output-ai-check/ai-diagnostic.json است.

اگر AI_OK دیدید، ابتدا یک درس را آزمایش کنید:

```powershell
npm run crawl -- --auth .\auth\dentigo-auth.json --answer-mode ai --ai-model qwen3-vl:4b --force --max-lessons 1 --keep-open-on-error --output .\output-restorative
```

در این تست خرید خودکار غیرفعال است. برای اجرای کامل با خرید مجاز تا سقف ۹۶۰ الماس:

```powershell
npm run crawl -- --auth .\auth\dentigo-auth.json --answer-mode ai --ai-model qwen3-vl:4b --force --auto-refill --max-gems 960 --max-lessons 184 --keep-open-on-error --output .\output-restorative
```

--keep-open-on-error بعد از اجرای ناقص منتظر Enter می‌ماند تا مرورگر برای بررسی بسته نشود. در headless یا --no-prompt این توقف غیرفعال است. سقف الماس در هر شروع دستور از نو محاسبه می‌شود. دفتر خرید نامشخص همچنان جلوی کلیک تکراری را می‌گیرد.

اگر ai:check خطا داد، خطوط AI_RESPONSE و AI_CHECK_FAILED یا فایل ai-diagnostic.json همان تست را ارسال کنید؛ متن message.thinking یا کوکی‌ها لازم نیست. در اجرای سایت، گزارش AI داخل پوشه specialty مربوط ذخیره می‌شود. هیچ خطای AI باعث انتخاب حدسی گزینه اول نمی‌شود.

تشخیص خطاها: AI_OUTPUT_LIMIT یعنی خروجی به سقف رسیده؛ AI_THINKING_WITHOUT_FINAL_ANSWER یعنی مدل فقط خروجی تفکر داده؛ AI_EMPTY_FINAL_ANSWER یعنی جواب نهایی خالی؛ AI_TIMEOUT یعنی مهلت درخواست تمام شده؛ AI_HTTP_404 معمولاً نیازمند بررسی نصب مدل و نسخه Ollama است. علت نهایی را با گزارش واقعی تعیین کنید.
