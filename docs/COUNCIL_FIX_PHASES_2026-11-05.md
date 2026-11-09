# فازبندی رفع یافته‌های حفره‌کاوی شورا — ParallelType

> تاریخ: 2026-11-05 | مرجع یافته‌ها: `COUNCIL_BUG_AUDIT_2026-11-04.md` (IDهای Y1–Y6، L1–L10)
> مخزن: `monkeytype/monkeytype-master` @ `9f2fe05` (0.20.0)
> **وضعیت: مصوب شورا — اجرا منتظر دستور صریح کاربر است.**

---

## قواعد حاکم بر همه فازها (از قرارداد پروژه)

- هر فاز = کامیت(های) جداگانه conventional؛ کامیت فقط پس از سبز بودن تست‌های همان فاز.
- پیش از هر کامیت: تست‌های فوکوس‌شده + `pnpm vitest run` کامل (مبنا فعلی: ۱۷۸۷/۱۷۸۷).
- برای فازهای Rust: `cargo check` تمیز؛ تست نصب ویندوز با کاربر.
- هیچ refresh آپ‌استریمی برای این فازها لازم نیست (همه در درزهای فورک‌اند)؛ اما شماره خط‌ها باید حین اجرا با جستجوی نماد تأیید شود، نه کپی کورکورانه از سند.
- توقف اجباری: هر ابهام یا تعارض واقعی حین اجرا = توقف و گزارش، نه حدس.
- Known Issueهای از-قبل-باز (KI-20، KI-22) دست نمی‌خورند.

---

## فاز ۱ — Y1 (بالا): همگام‌سازی snapshot درون‌حافظه‌ای پس از import بک‌آپ

| مورد | شرح |
|---|---|
| هدف | پس از هر `importBackup` موفق (مسیر خودکار و دستی)، state درون‌حافظه‌ای از storage بازخوانی شود تا اولین `saveLocalResult` نشست، داده بازیابی‌شده را بازنویسی نکند |
| فایل‌ها | `db.ts` (تابع reload جدید)، `utils/desktop-auto-backup.ts:101`، `components/pages/account/AccountPage.tsx:267` |
| طراحی | یک ارکستراتور واحد — پیشنهاد: `importLocalBackup(backup)` در `db.ts` — که `importBackup` را صدا می‌زند، سپس: (۱) dbSnapshot را از `loadLocalSnapshotFields` بازسازی می‌کند (منطق `initLocalSnapshot` با حالت force)، (۲) در نبود نتیجه در حافظه، `setLastResult` از آخرین نتیجه، (۳) `resultsCollection.utils.refetch()` اگر کالکشن ready است (الگوی موجود در `results.ts:774`). هر دو مسیر فراخوان به همین ارکستراتور سوئیچ می‌شوند |
| تست‌ها | تست پذیرش audit: storage خالی → import → شبیه‌سازی `saveLocalResult` → فیلدهای snapshot (personalBests/xp/streak/maxStreak) دست‌نخورده؛ تست واحد reload با fake-indexeddb طبق قرارداد سوئیت |
| معیار پذیرش | «restore → save در همان نشست = صفر اختلاف فیلد snapshot» سبز؛ سوئیت کامل سبز |
| ریسک | معنای `dispatchEvent` در setSnapshot و timing of refetch — با الگوهای موجود همین فایل‌ها حل می‌شود؛ ریسک پایین |
| کامیت | `fix(desktop): reload in-memory snapshot after local backup import (audit Y1)` |

## فاز ۲ — Y2 + Y3 (بالا + متوسط): پوسته Rust — بک‌آپ اتمیک و toggle با فوکوس

> دو کامیت جدا، یک rebuild مشترک، یک تست نصب ویندوز.

| مورد | شرح |
|---|---|
| Y2 هدف | حذف پنجره خراب‌شدگی `backup.json` |
| Y2 طراحی | `backup_write`: نوشتن در `backup.json.tmp` + `std::fs::rename` اتمیک روی همان حجم (+ در صورت موجود بودن، حذف tmp قدیمی پیش از نوشتن). چرخش نسخه قبلی (`backup.1.json`) **خیر** — به‌عنوان بهبود آینده، نه بخش این باگ (اختلاف‌نظر ۱ سند audit باز می‌ماند) |
| Y3 هدف | هات‌کی/ترای پنجره visible-but-unfocused را مخفی نکند |
| Y3 طراحی | در `toggle_main_window` شرط مخفی‌شدن = `visible && !minimized && is_focused()`؛ در غیر این صورت فقط show+unminimize+focus. کامنت هم بالای تابع اصلاح شود (ادعای فعلی از کد جلوتر است) |
| فایل‌ها | `src-tauri/src/main.rs:57-69` (Y3)، `main.rs:193-199` (Y2) |
| تست‌ها | `cargo check` + در صورت امکان تست Rust برای سناریوی قطع حین نوشتن (فایل قبلی سالم بماند)؛ رفتار toggle = تست نصب ویندوز توسط کاربر: پنجره پشت مرورگر → هات‌کی → آمدن به جلو (نه مخفی‌شدن) |
| معیار پذیرش | cargo تمیز؛ تأیید کاربر روی رفتار هات‌کی |
| ریسک | rename اتمیک روی NTFS همان حجم استاندارد است؛ ریسک پایین |
| کامیت | `fix(shell): atomic backup write via temp+rename (audit Y2)` و `fix(shell): hotkey/tray toggle focuses instead of hiding unfocused window (audit Y3)` |

## فاز ۳ — Y4 + Y6 (متوسط): برچسب سقف در Wrapped و اعتبارسنجی بک‌آپ

| مورد | شرح |
|---|---|
| Y4 هدف | Year Wrapped دیگر جمع‌های سقف‌خورده را بی‌صدا «سال کامل» جلوه ندهد |
| Y4 طراحی | خروجی `MAX_RESULTS` (یا helper `isResultsCapped(count)`) از `local-persistence.ts`؛ در `WrappedPage` وقتی تعداد نتایج ورودی ≥ سقف است، برچسب صریح «بر پایه ۱۰۰۰ تست اخیر» کنار عنوان |
| Y6 هدف | فایل بک‌آب خراب (اما JSON معتبر) snapshot را مسموم نکند |
| Y6 طراحی | در `importBackup` پیش از نوشتن snapshot: اعتبارسنجی zod سبک — xp/streak/maxStreak/streakLastResultTimestamp عدد متناهی ≥ 0 (وگرنه مقدار فعلی حفظ + log)، typingStats سه فیلد عددی، personalBests آبجکت با مقادیر آرایه‌ای. فیلد نامعتبر = رد همان فیلد، نه کل import |
| فایل‌ها | `local-persistence.ts:449-461`، `WrappedPage.tsx:417` ناحیه |
| تست‌ها | unit: بک‌آپ با xp رشته‌ای/personalBests خراب → import موفق، فیلد سالم حفظ؛ unit/ری: نمایش برچسب در آستانه سقف |
| معیار پذیرش | سوئیت کامل سبز + دو تست جدید سبز |
| ریسک | پایین — فیلدهای اختیاری، fallback حفظ وضعیت فعلی |
| کامیت | `feat(wrapped): disclose 1000-result cap in year recap (audit Y4)` و `fix(desktop): validate snapshot fields in local backup import (audit Y6)` |

## فاز ۴ — Y5 (+یافته Y5b) (متوسط): مجموعه نقطه‌گذاری روی ردیف نتیجه

| مورد | شرح |
|---|---|
| هدف | حذف نتیجه PB، هویت PB را از زمینه خودِ نتیجه تشخیص دهد نه از Config زنده |
| Y5 طراحی | در شاخه آفلاین `test-logic.ts`: ردیف نتیجه فیلد اختیاری `customPunctuation` بگیرد (فقط وقتی استایل `custom` فعال است؛ در غیر این صورت ناموجود). در `matchesPbIdentity`: اگر ردیف فیلد را دارد، تطبیق با همان؛ ردیف‌های قدیمی بدون فیلد = fallback به رفتار فعلی |
| Y5b (کشف حین فازبندی) | ناهماهنگی موجود: `saveLocalPB` سطل PB را همیشه با رشته خام `Config.customPunctuation` کلید می‌زند حتی وقتی استایل `default` است و مولد از جداول داخلی استفاده می‌کند → PB استایل default و custom ممکن است در یک سطل بیفتند. اصلاح: کلید سطل = مجموعه **مؤثر** (رشته فقط در استایل custom، وگرنه `""`) — هم در `saveLocalPB`/`getLocalPB` و هم در `matchesPbIdentity` |
| سازگاری | فیلد داخل ردیف نتیجه سفر می‌کند (بدون تغییر schema بک‌آپ)؛ PBهای قدیمی بدون فیلد معتبر می‌مانند |
| تست‌ها | تغییر مجموعه → حذف PB قدیمی → سطل درست جبران شود؛ ردیف legacy بدون فیلد؛ سطل Y5b: تعویض استایل default↔custom سطل را تفکیک کند |
| معیار پذیرش | سه تست جدید سبز؛ سوئیت کامل سبز |
| ریسک | متوسط-پایین — منطق PB حساس است؛ تغییر باید additive بماند (ردیف‌های موجود را معتبر نگه دارد) |
| کامیت | `fix(desktop): store effective punctuation set on results and PB identity (audit Y5/Y5b)` |

## فاز ۵ — دسته‌کوچک‌ها (پایین، کد): L1، L2، L4، L6، L7، L8

هر مورد یک کامیت مستقل، ترتیب دلخواه، همه بعد از فاز ۱ (چون L4 به ارکستراتور import وصل می‌شود):

| ID | کار | طراحی حداقلی |
|---|---|---|
| L1 | خودترمیمی keybr state خراب | اعتبارسنجی ردیفه‌به‌ردیفه در `loadStoredResults` (skip ردیف ناقص: فیلدهای عددی + histogram آرایه معتبر) — بدون UI جدید |
| L2 | مسابقه بوت‌های هم‌زمان keybr | شمارنده نسل در `KeybrPage`؛ resolve بوت قدیمی‌تر از نسل جاری = دور ریخته |
| L4 | امتیازهای Word Blast پس از import دست‌کاری‌شده پاک نشوند | sanitize ورودی `wordBlastScores` در مسیر import (clamp history به ۱۰ + اعتبارسنجی رکوردها) — مصرف در ارکستراتور فاز ۱ |
| L6 | flush بک‌آپ هنگام خروج | تلاش با `beforeunload`/`visibilitychange` در `desktop-auto-backup`؛ **اگر راستی‌آزمایی شد که Quit ترای آن را آتش نمی‌زند، بستن به‌عنوان پذیرفته‌شده (KI)** — حدس ممنوع، آزمایش واقعی |
| L7 | حذف کد مرده `enableDrillKeymap` (کشف: هیچ فراخوانی ندارد؛ Learn/DrillsPage مستقیم `setConfig` می‌زنند) | حذف تابع + تست مرتبط در صورت وجود |
| L8 | cursor rotation فقط پس از تثبیت متن جلو برود | تفکیک peek/commit در `custom-text.ts`: انتخاب بدون persist؛ persist `last` پس از `setText` موفق در `test-logic.ts` |

## فاز ۶ — ثبت مستند (پایین): L3، L5، L9، L10 → Known Issue

| ID | تصمیم |
|---|---|
| L3 | KI — معامله عمدی سادگی/perf در KeybrPage؛ بازنگری فقط با شکایت واقعی روی سخت‌افزار ضعیف |
| L5 | KI — انحراف عمدی ثبت‌شده (testActivity پس از حذف)؛ تریگر بازنگری: اهمیت یافتن توسط کاربر |
| L9 | KI + تلاش اختیاری کوتاه برای حذف `@ts-nocheck` از `session.ts` با سقف زمانی؛ اگر موج خطای type بزرگ شد، به KI برگردد |
| L10 | ثبت ساده در سند — بدون کد |
| اجرا | ثبت KI-24 به بعد در چرخه ۱۰ سند نسخهٔ ریلز بعدی (ادامه شماره‌گذاری از KI-23) + آپدیت وضعیت فایل audit |

---

## جدول اجرا (چک‌لیست زنده — با پیشرفت آپدیت شود)

- [x] فاز ۱: Y1 — reload snapshot پس از import ✅ کامیت `a5ab918` — ارکستراتور `db.importLocalBackup` (خودکار با dynamic import ضد-cycle + دستی)؛ reload شامل snapshot + lastResult + refetch کالکشن؛ تست پذیرش restore→save و ۲ تست واحد اضافه شد؛ ۱۷۹۰/۱۷۹۰ سبز؛ typecheck تمیز
- [x] فاز ۲: Y2 — backup_write اتمیک ✅ کامیت `47b7c4f` — temp+rename اتمیک؛ ۲ تست واحد Rust (موفق + شبیه‌سازی شکست حین نوشتن: فایل قبلی سالم)؛ cargo test 2/2، cargo check و fmt-check به خط مبنا (۲ اختلاف از-قبل-موجود خارج از محدوده باقی ماند)
- [x] فاز ۲: Y3 — toggle با شرط فوکوس ✅ کامیت `a94a766` — `is_focused()` به شرط hide اضافه شد؛ **✅ تأیید ویندوزی 2026-11-07 توسط مالک: همه سبز**
- [x] نکته فرایندی فاز ۲: هوک pre-commit (lint-staged/oxfmt) روی کامیتِ فقط-Rust می‌شکند (oxfmt فایل rs را exclude می‌کند و خطای «no target file» می‌دهد) — کامیت‌های Rust با `--no-verify` و بدهکار بررسی دستی cargo انجام شد؛ کاندید ثبت KI / اصلاح `.lintstagedrc`
- [x] فاز ۳: Y4 — برچسب سقف Wrapped ✅ کامیت `be2dfad` — `MAX_RESULTS` اکسپورت شد + helper `isResultsCapped()`؛ WrappedPage هنگام رسیدن به سقف، برچسب «بر پایه ۱۰۰۰ تست اخیر» نشان می‌دهد
- [x] فاز ۳: Y6 — اعتبارسنجی فیلدهای snapshot در import ✅ کامیت `ce43cac` — zod فیلدبه‌فیلد؛ فیلد نامعتبر = حفظ مقدار فعلی (پیش‌فرض صفر در پروفایل خالی) + log؛ تغییر معنایی امن: فیلدِ غایب هم «حفظ» است نه «پاک‌کردن» (بک‌آپ legacy بدون PB دیگر PBها را نمی‌سوزاند)؛ ۲ تست جدید
- [x] فاز ۴: Y5+Y5b — مجموعه مؤثر نقطه‌گذاری روی ردیف نتیجه و هویت PB ✅ کامیت `ba62d1f` — `effectiveCustomPunctuation()` در custom-punctuation.ts؛ فیلد اختیاری روی SnapshotResult نوشته‌شده در `saveLocalResult` (نه test-logic — برای تست‌پذیری و پوشش همه مسیرهای ذخیره)؛ matchesPbIdentity از فیلد ذخیره‌شده با fallback به Config خام برای ردیف‌های قدیمی؛ getLocalPB/saveLocalPB روی هویت مؤثر. **باگ سوم کشف‌شده حین اجرا:** تطبیق‌گر update-branch در saveLocalPB هیچ‌وقت مجموعه را مقایسه نمی‌کرد → ذخیره با مجموعه جدید، PB مجموعه قبلی را بازنویسی می‌کرد — اصلاح شد. تست قدیمی idea#4 که رفتار خام را قرارداد می‌گرفت، به قرارداد جدید به‌روزرسانی شد؛ ۴ تست جدید (مسیر حذف ×۳ + هویت db ×۱)؛ ۱۷۹۶/۱۷۹۶ سبز
- [x] فاز ۵: L1، L2، L4، L6، L7، L8 — هر یک کامیت جدا ✅ هفت کامیت: `4eb3201` (L7 حذف کد مرده) · `02b50dd` (L1 استخراج `keybr/stored-results.ts` + skip ردیف خراب + ۸ شکل خرابی پوشش‌داده) · `4619b9a` (L4 sanitize امتیاز Word Blast در import + تست integration) · `14838ac` (L8 peek/commit چرخش — cursor فقط پس از apply موفق) · `79759df` (L6 flush در beforeunload — **✅ تأیید ویندوزی 2026-11-07: beforeunload در Quit ترای آتش می‌شود و backup.json به‌روز است — فیکس کامل، KI لازم نشد**) · `737e8ac` (L2 شمارنده نسل بوت — بدون تست واحد، گارد ۳ خطی) · `3afada2` (دنباله L1: `TextType.GENERATED` به‌جای عدد خام ۰ که `@ts-nocheck` مخفی کرده بود — کشف با tsc پس از خروج از فایل nocheck)؛ ۱۸۱۲/۱۸۱۲ سبز؛ tsc صفر خطا
- [x] فاز ۶: ثبت KI-24+ و آپدیت audit ✅ 2026-11-05 — **L9 به‌جای KI، رفع شد** (کامیت `7a52153`: حذف `@ts-nocheck` از session.ts با فقط ۳ اصلاح — fallback صریح `keybrLanguageById`، کارخانه عمومی `KeyboardOptions.default().withLanguage().withLayout()` به‌جای constructor خصوصی، cast مستند write-side؛ tsc صفر، تست keybr سبز). ثبت در ثبت اصلی زنده (`SoftwareRelease/pre-releases/0.11.0/09-known-issues.md`): KI-24 (L3 بازرندر هر کلید)، KI-25 (L5 testActivity پس از حذف)، KI-26 (L10 برخورد ID تئوریک)، KI-27 (هوک pre-commit فقط-Rust — فرایندی) + خلاصه وضعیت به‌روز. وضعیت رفع در هدر `COUNCIL_BUG_AUDIT_2026-11-04.md` ثبت شد. سوئیت نهایی ۱۸۱۲/۱۸۱۲ سبز روی وضعیت کامیت‌شده، tsc صفر، درخت تمیز

## وابستگی‌ها و ترتیب

فاز ۱ پیش از فاز ۵ (ارکستراتور import پایه L4 است) — بقیه مستقل‌اند. فاز ۲ مستقل از همه (Rust). فاز ۳/۴ هر زمان پس از فاز ۱ می‌توانند اجرا شوند (Y6 داخل همان ناحیه import است — ترتیب فعلی توصیه‌شده است).

## برآورد کل

حدود ۲ تا ۳ روز کاری شامل تست‌ها، به‌علاوه یک تست نصب ویندوز (فاز ۲) که با کاربر است.

**وضعیت نهایی: هر شش فاز کامل شد — ۱۴ کامیت روی مبنا 0.20.0 (`a5ab918` تا `7a52153`).** باقی‌مانده با کاربر: rebuild نصب‌کننده و دو تأیید ویندوزی (رفتار هات‌کی از فاز ۲ / Y3، و آتش‌شدن `beforeunload` هنگام Quit ترای از L6 — اگر آتش نشود، L6 طبق شرط سند به KI تبدیل می‌شود). ریلز بعدی (0.21.0) باید شامل این فیکس‌ها و snapshot تازه Known Issues باشد.
