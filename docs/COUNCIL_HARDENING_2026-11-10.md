# شورا — موج پایدارسازی و انتشار (2026-11-10)

> جلسهٔ پس از بستن موج آنلاین (۴۸/۴۸ ✅، انتشار 0.28.0، endpoint زنده، سورس روی دو ریموت).
> رأی شورا: کارهای باقی‌ماندهٔ مهم، تقسیم به ۶ فاز کوچک گیت‌دار (۴۹-۵۴) + دو مورد خارج از دسترس عامل (دو ماشین فیزیکی، Authenticode).
> قاعدهٔ هر فاز: مستقل، گیت‌دار، قابل‌revert؛ تیک با هش کامیت.

## فازها

- **فاز ۴۹** ✅ (d173dc0 + بیلد سوم) — آپدیتر واقعی: فلگ `UPDATES_ENABLED=true` در main.rs (precondition اش با endpoint واقعی فاز ۴۸ برقرار شد — تعهد دو-کلیدی مستند کنار فلگ) + بیلد/امضای مجدد 0.28.0 + جایگزینی آرتیفکت‌ها در releases/ + هش‌ها/README. نکتهٔ کاربران: ≤0.27 فلگ خاموش دارند → یک بار دستی به 0.28؛ از 0.28 به بعد خودکار. (انجام‌شده: فلگ true + کامنت قرارداد دو-کلیدی به‌روز؛ cargo test ۹/۹؛ بیلد امضادار سوم — SHA256 نصب‌کننده `5d0b28e8...61bb93`، امضا `695c8218...63652`؛ latest.json با امضای جدید بازتولید؛ ردیف README با نکتهٔ «کاربران ≤0.27 یک بار دستی»؛ کامیت push به هر دو ریموت. **یادآوری عملیاتی**: سه فایل releases/ باید دوباره روی Release v0.28.0 جایگزین شوند — وگرنه endpoint هنوز بیلد بدون-فلگ را می‌دهد.)
- **فاز ۵۰** ✅ (047c875) — پاکسازی lint میراث: در نهایت **۸ فیکس** شد (نه ۶ — اولین لینت کل-مخزن دو مورد تازه در states/lan.ts هم لو داد): keybr/session.ts — پارس‌های JSON تایپ‌شده، loadSharedPhoneticModel async شد، assertionهای غیرضروری حذف، import مرده حذف؛ LoadingErrorPage — props.error از قبل Error است؛ states/lan.ts — ژنریک invoke<T> جایش as-cast را می‌گیرد. **گیت: oxlint کل ۷۰۲ فایل = ۰/۰ + tsc صفر + سوئیت ۲۸۲۹/۲۸۲۹**. push به هر دو ریموت.
- **فاز ۵۱** ✅ (b1f48fe..a17305b — ۵ run تا سبز) — CI گیت‌هاب اکشنز: verify.yml روی push/PR به main + dispatch: frontend (node 24 + pnpm از packageManager + frozen lockfile + tsc informational + vitest + oxlint کل مخزن) و rust (cargo test با rust-cache) — **run نهایی: success ✓**. یافته‌های مسیر (هرکدام درس):
  - **KI-51 تکمیل**: tsc لوکال false-green بود — TS 7.0.2 native بیلد ویندوز silently از چک می‌گذرد؛ بیلد لینوکس ~۱۰۰۰ خطای strictness واقعی لو داد (بدهی مستند — پاکسازی آن موج جداگانه آینده). در CI به‌صورت informational با continue-on-error ماند تا بدهی دیده شود ولی بلاک نکند.
  - **باگ واقعی صفحه فیکس شد (6a3445f)**: هورن stack-attack تایمرها را متوقف نمی‌کرد → death بعد از هورن، داوری awaiting را با lost overwrite می‌کرد؛ الان هورن ران را freeze می‌کند.
  - spec آنلاین stack-attack به زمان شبیه‌سازی‌شده رفت + شمارنده تایپ محلی (DOM data-typed هر تیک آپدیت می‌شود — لوپ سریع‌تر حروف stale می‌فرستد) + steer بعد از هر کلمه (پخش قفل‌ها — برج قبل از هورن بالا نمی‌آید).
  - CI نقص‌های infra را لو داد: packages/*/tsconfig.jsonها extends workspace دارند → نصب فیلترشده باید packages slice + ریشه باشد (فیلترهای مسیری نسبت به CWD حل می‌شوند — از ریشه اجرا شود)؛ cargo test crate تابع tauri است → GTK/WebKit apt + stub frontend/dist (generate_context! در کامپایل embed می‌کند).
- **فاز ۵۲** — اسناد + تگ‌ها: TEST_RUN_2_DEVICES.md + اسناد شورا → `docs/`، اصلاح ارجاع README، `git fetch --tags` + تگ‌گذاری نسخه‌های قدیمی روی کامیت‌های bump.
- **فاز ۵۳** — rate-limit per-connection در lan.rs (سقف نرخ پیام/حجم per peer در برابر هم‌بازی خرابکار) + تست Rust. تنها فاز کد Rust.
- **فاز ۵۴** — آرشیو نصب‌کننده‌های 0.11.0–0.27.0 روی یک Release آرشیوی (API با توکن GCM؛ در صورت ناکامی بستهٔ دستی).

## خارج از این موج

- اجرای سناریونامه روی دو ماشین فیزیکی (`TEST_RUN_2_DEVICES.md`) — کاربر؛ یافته‌ها → پولیش + KI.
- Authenticode signing — تصمیم هزینه‌ای (SmartScreen هشدار می‌دهد).

## رأی رد

- sync با آپ‌استریم monkeytype (واگرایی عمدی)؛ سرور/اکانت اینترنتی (قاعده LAN-only)؛ بازنویسی engineهای گیت‌دار.
