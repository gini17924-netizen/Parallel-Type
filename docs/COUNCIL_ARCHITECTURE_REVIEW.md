# شورای معماری ParallelType — یافته‌ها، پیشنهادها و فازبندی اجرا

> تاریخ تحلیل: 2026-11-03 | کامیت مبنا: `c3d82e9` (fix(keybr): round the displayed speed — cpm shown as integer + wpm estimate)
> روش: ۴ ایجنت کاوش موازی (ساختار مخزن، پوسته Tauri، persistence و قابلیت‌های فورک، درخت vendored keybr) + راستی‌آزمایی مستقیم رئیس شورا روی درزهای حیاتی.
> قاعده اعتبار: هر مورد با سطح شواهد مشخص شده — «کد» = مستقیماً در کد راستی‌آزمایی شد، «ایجنت» = گزارش کاوش، «سند» = فقط از مستندات.
> **وضعیت: مصوب — اجرا منتظر دستور کاربر است.**

---

## ۱. تشخیص وضعیت فعلی (خلاصه برای جلسات بعد)

- فورک Monkeytype `26.43.0`، اسنپ‌شات پاک `d0a5b11`، ۴۸+ کامیت، بدون ریموت، working tree تمیز.
- دیفرنس کل: ۹۹۴ فایل (+358k/−6.16M) که ~۹۰٪ آن حذف عمدی دارایی‌ها (۳۵۸/۴۴۵ لیست زبان، ۵۹/۸۳ quote) و vendor شدن keybr (۴۲۶ فایل) است؛ دیفرنس منطقی واقعی کوچک است.
- موتور تایپ آپ‌استریم دست‌نخورده (`frontend/src/ts/input/`، `controllers/` دیفرنس صفر)؛ `test-logic.ts` فقط افزودنی (+۷۱ خط، شاخه آفلاین)؛ `db.ts` (+۲۸).
- پوسته Tauri 2: `frontend/src-tauri/src/main.rs` فقط ۲۵۴ خط، ۲ فرمان IPC (`backup_write`/`backup_read`)، ترای، هات‌کی `ctrl+shift+m` با fallback `ctrl+alt+m`، close-to-tray، رهگیری لینک‌های خارجی به مرورگر سیستم، updater غیرفعال، target فقط `nsis`، capabilities محدود (`core/opener/updater:default`).
- کلید اصلی حالت آفلاین: `DESKTOP_OFFLINE = true` هاردکد در `frontend/src/ts/utils/local-persistence.ts:23` — ۱۰ فایل مصرف‌کننده.
- keybr: ۱۸ پکیج vendored verbatim در `frontend/src/keybr/@keybr/*` (فقط ۲ ویرایش واقعی: تغییر نام id لای‌آوت فارسی در `keyboard/lib/layout.ts:882,912` و استاب react-intl)؛ تنها درزهای اتصال: `ts/keybr/session.ts` (۱۹۹ خط) و `components/pages/keybr/KeybrPage.tsx` (۳۲۹ خط، SolidJS)؛ alias سه‌لایه سازگار (`frontend/vite-plugins/keybr-packages.ts` + tsconfig paths).
- معماری دو فریم‌ورکی عمدی است: صفحات Monkeytype با React، صفحه `/keybr` با Solid (سند `SoftwareRelease/docs/KEYBR_PORT_ARCHITECTURE.md`). این اشکال نیست؛ حفظ شود.
- نکته رفع ابهام: آرتیفکت `paralleltype-desktop-0.10.0-1-x86_64.pkg.tar.zst` بسته لینوکس است (مبنای مقایسه سند windows-only)؛ target فعلی کانفیگ فقط NSIS/ویندوز است — نسخه 0.5.1 در ریشه ورک‌اسپیس آرتیفکت قدیمی و رهاشده است.

## ۲. نقاط قوت — در بازسازی‌ها یا اصلاحات آینده از بین نروند

1. موتور تایپ آپ‌استریم دست‌نخورده است (حداقل هزینه Merge).
2. منطق PB آفلاین آینه‌ی دقیق قواعد سرور: quote، bail-out، stop-on-letter زیر ۱۰۰٪، `canGetPb` همه funboxها (`test-logic.ts:1120-1180`)؛ اصلاح inflate شدن `timeTyping` با `resetIncompleteTests()`.
3. vendor کردن keybr ایدمپوتنت و مستند (`scripts/vendor-keybr.mjs` + `EXCLUDED.txt` + ۱۵×`VENDORED.md`).
4. backup خودکار با restore-if-empty در بوت (`desktop-auto-backup.ts:86-90`، `ready.ts:35`).
5. حاکمیت مستندسازی: سند windows-only با SHA256 و شماره کامیت، چرخه ۱۰ سند نسخه، پیوست واگرایی سند مهاجرت.

## ۳. مشکلات شناسایی‌شده

| # | مشکل | شدت | شواهد (سطح) |
|---|---|---|---|
| ۱ | AGPL ناقص در درخت vendor: بدون فایل LICENSE در `frontend/src/keybr/`؛ منشأ فقط VENDORED.md و کامنت سطر اول؛ کامیت آپ‌استریم keybr ثبت نشده (drift غیرقابل‌راستی‌آزمایی). بحرانی فقط در صورت توزیع عمومی. | بالا | کد |
| ۲ | باینری ۱۶.۹MB داخل git: `paralleltype-desktop-0.10.0-1-x86_64.pkg.tar.zst` با `git ls-files` تأیید شد؛ + نسخه 0.5.1 رهاشده در ریشه ورک‌اسپیس. | بالا | کد |
| ۳ | streak آفلاین هرگز increment نمی‌شود: هیچ نقطه افزایش در شاخه آفلاین `test-logic.ts:1116-1186` و کل `db.ts` وجود ندارد (`db.ts:320,381-385` فقط load/merge). نتیجه: ضریب streak فرمول XP همیشه صفر (`local-xp.ts:67-75` ورودی از `DB.getSnapshot()?.streak`)، `maxStreak` فیلد مرده، و XP با streak مشهود در `AccountPage.tsx:82-92` (derivation جدا از تاریخچه نتیجه‌ها) ناسازگار. | بالا | کد |
| ۴ | حفره backup: `exportBackup` (`local-persistence.ts:276`) فقط `results + snapshot + learnState` را شامل می‌شود → `mtKeybr*` (کل حافظه یادگیری keybr)، `mtDesktopDailyGoalMinutes`، `mtDesktopWordBlastDifficulty` در backup دستی و خودکار نیستند. ریستور = از دست رفتن تاریخچه یادگیری keybr. | متوسط | کد |
| ۵ | Updater مرده دو-کلیده: endpoint جای‌گزین `.example` (`tauri.conf.json:28-33`) + `UPDATES_ENABLED=false` (`main.rs:74`). فعال‌سازی ناهماهنگ یک کلید = آپدیت شکسته. | متوسط | کد |
| ۶ | بدون single-instance: اجرای دوم = پروسه دوم با پنجره مخفی (close-to-tray)؛ کاربر فکر می‌کند باز نشده. | متوسط | کد (پلاگین غایب در Cargo.toml) |
| ۷ | سقف ۱۰۰۰ نتیجه + حذف `chartData/keySpacing/keyDuration` در IndexedDB (`local-persistence.ts`, `MAX_RESULTS=1000`) — نمودارهای رکوردهای قدیمی بی‌صدا degrade می‌شوند. معامله عمدی اما Known Issue ثبت نشده. | متوسط | کد |
| ۸ | شکاف محصولی: بدون ذخیره امتیاز Word Blast (فقط سختی در `mtDesktopWordBlastDifficulty` ماندگار است). ⚠️ اصلاح 2026-11-03: بخش «بدون UI برای daily goal» پس از راستی‌آزمایی مستقیم **رد شد** — `AccountPage.tsx:97` دقیقاً `setDailyGoalMinutes` را صدا می‌زند (ادعای ایجنت غلط بود). | پایین | کد |
| ۹ | `AGENTS.md` ادعای «مهاجرت جزئی از vanilla JS به SolidJS» — نادرست/ناقص (آپ‌استریم React است؛ فقط `/keybr` با Solid است). | پایین | سند vs کد |

## ۴. پیشنهادهای مصوب شورا

| ID | مشکل | راهکار | هزینه | سنجش موفقیت |
|---|---|---|---|---|
| P1 | #۳ streak | محاسبه streak از تاریخچه نتیجه‌ها در مسیر ذخیره آفلاین و نوشتن در snapshot — همان منطق derivation که AccountPage دارد، منتقل‌شده به یک منشأ واحد در `db.ts:saveLocalResult`، تا XP و نمایش از یک جا بخوانند | کوچک (~۳۰ خط + تست) | XP یک نتیجه یکسان با/بدون streak دیروز = منطبق بر فرمول آپ‌استریم |
| P2 | #۴ backup | `BACKUP_SCHEMA_VERSION: 2` + افزودن `keybrState`, `dailyGoal`, `wordBlast` به export/import با fallback نسخه ۱ | کوچک | تست: export → پاک‌کردن کلیدها → import → تطابق کامل |
| P3 | #۲ باینری | `git rm --cached` باینری + `.gitignore` برای `*.pkg.tar.zst` + انتقال آرتیفکت‌ها به پوشه release خارج از مخزن؛ بازنویسی تاریخچه فعلاً لازم نیست (مخزن خصوصی) | دقیقه‌ای | `git ls-files \| grep pkg.tar` = خالی |
| P4 | #۱ AGPL | ثبت hash کامیت آپ‌استریم keybr در VENDORED.mdها + افزودن `frontend/src/keybr/LICENSE-AGPL.txt` | دقیقه‌ای | هر VENDORED.md حاوی hash؛ توزیع B27 بدون کار اضافه |
| P5 | #۶ single-instance | افزوده رسمی `tauri-plugin-single-instance` (فوکوس پنجره موجود) | ~۱۰ خط Rust | اجرای دوباره = فوکوس پنجره موجود (تست ویندوز: کاربر) |
| P6 | #۵ updater | فعلاً فقط کامنت «این دو کلید با هم فعال شوند» بالای `UPDATES_ENABLED`؛ endpoint واقعی = بلندمدت | یک کامنت | — |

قاعده حاکم بر اجرا (از سند مهاجرت، پیوست A.5): تغییرات جدید با کامیت جداگانه؛ تست نصب ویندوز بر عهده کاربر؛ صحت‌سنجی build/تست در همین محیط انجام می‌شود.

## ۵. فازبندی اجرا

### فاز ۰ — پاک‌سازی کم‌ریسک (بدون تغییر رفتار برنامه) — «سریع‌ترین برد»
- کارها: P3 (خروج باینری از git) + P4 (پین AGPL) + اصلاح ادعای AGENTS.md (#۹) + ثبت Known Issueها (#۷، #۸) در چرخه ۱۰ سند نسخه.
- معیار پذیرش: `git ls-files` بدون باینری؛ `.gitignore` شامل الگو؛ VENDORED.mdها حاوی hash؛ Known Issueها در پوشه نسخه.
- ریسک: تقریباً صفر — کاملاً برگشت‌پذیر. برآورد: < ۱ ساعت.

### فاز ۱ — صحت داده (streak و XP)
- کارها: P1 — پیاده‌سازی محاسبه streak در مسیر آفلاین + تست vitest برای فرمول XP (سناریوهای: streak صفر، streak ۵ روز، مرز روز تقویمی، روز بدون تمرین).
- تصمیم طراحی لازم پیش از کد: مرز روز تقویمی یا آفست ساعتی (اختلاف‌نظر حل‌نشده ۲ — پیش‌فرض پیشنهادی: تقویمی، مطابق derivation فعلی AccountPage؛ ثبت در سند).
- معیار پذیرش: تست‌های XP سبز؛ XP نتیجه نمونه با streak=5 عددی با فرمول آپ‌استریم یکی باشد؛ AccountPage و snapshot یک عدد را نشان دهند.
- ریسک: کم — فقط مسیر آفلاین؛ مسیر ابری دست نمی‌خورد. برآورد: نیم‌روز شامل تست.

### فاز ۲ — پایداری و بازیابی
- کارها: P2 (backup v2 با اسکیمای versioned و fallback) + P5 (single-instance) + P6 (کامنت updater).
- معیار پذیرش: سناریو «export → پاک‌سازی → import → تطابق ۱۰۰٪ کلیدها از جمله `mtKeybr*`» سبز؛ اجرای دوباره اپ = فوکوس پنجره موجود (نیاز به rebuild و تست نصب ویندوز توسط کاربر).
- وابستگی: بعد از فاز ۱، تا backup از داده‌های درست streak نسخه بگیرد.
- ریسک: متوسط — پوسته Rust تغییر می‌کند (نیاز build جدید)؛ اسکیمای backup باید نسخه ۱ را بخواند. برآورد: یک روز.

### فاز ۳ — بلندمدت (هرکدام مستقل، نیازمند تصمیم کاربر)
- V3 سند پورت keybr: تلفیق آمار per-key دو موتور (keybr ↔ monkeytype).
- Updater با endpoint واقعی + امضای minisign واقعی.
- حل سه اختلاف‌نظر حل‌نشده (پایین) با داده استفاده واقعی.

### جدول اجرا (چک‌لیست زنده — با پیشرفت کار آپدیت شود)

- [x] فاز ۰: P3 — خروج باینری از git ✅ کامیت `41b4bf4`
- [x] فاز ۰: P4 — پین AGPL (منشأ + LICENSE) ✅ کامیت `65ec02b` (نکته: hash آپ‌استریم keybr قابل pin شدن نبود — اسنپ‌شات محلی git نیست؛ منشأ و رویه regen ثبت شد و «unpinned» صریحاً مستند شد تا در refresh بعدی pin شود)
- [x] فاز ۰: اصلاح AGENTS.md ✅ کامیت `bf6ddfa` + ثبت Known Issueها ✅ `pre-releases/0.11.0/09-known-issues.md` (KI-20 تا KI-23)
- [x] فاز ۱: P1 — fix streak آفلاین + تست XP ✅ کامیت `a154c43` — سوئیت کامل ۱۷۰۲/۱۷۰۲ سبز؛ فایل‌های تغییر یافته صفر خطای typecheck
  - تصمیم مرز روز: **روز تقویمی محلی** (پاسخ کاربر به سؤال دریافت نشد → پیش‌فرض مصوب اجرا شد؛ انحراف از UTC آپ‌استریم در کامنت `local-streak.ts` مستند است؛ قابل تغییر آینده)
  - یافته حین تست: `mapRange` آپ‌استریم با `toFixed(1)` ضریب ۰٫۲۵ را به ۰٫۳ گرد می‌کند — XP نتیجه نمونه ۳۰ثانیه/۹۷٪ با streak=5 برابر ۷۳ است (نه ۷۱ حدس دستی اولیه)
  - مشاهده ثبت‌شده: اجرای `oxlint --type-aware --type-check` روی HEAD در این محیط ۹۳۱ خطای از-قبل-موجود نشان می‌دهد (با و بدون تغییرات من یکسان) — احتمالاً مشکل راه‌اندازی type-aware در این ماشین؛ کاندید بررسی در فاز بعد (بلاک نمی‌کند)
- [x] فاز ۲: P2 — backup v2 ✅ کامیت `0f391a2` — شامل: کلیدهای `mtKeybr*` (بدون boot-error گذرا)، daily goal، سختی Word Blast؛ import نسخه ۱ سالم ماند؛ گیت emptiness در restoreFromAutoBackupIfNeeded حالا keybr state را می‌شمارد؛ `storeResultStats` صف backup می‌گذارد (کاربر keybr-only هم فایل backup می‌گیرد) — ۱۷۰۵/۱۷۰۵ تست سبز
- [x] فاز ۲: P5 — single-instance ✅ کامیت `450e468` — `tauri-plugin-single-instance 2.5.5` به‌عنوان اولین plugin؛ cargo check تمیز؛ **تست نصب ویندوز (اجرای دوباره → فوکوس پنجره موجود) با کاربر**
- [x] فاز ۲: P6 — کامنت هم‌فعال‌سازی updater ✅ کامیت `450e468` (بالای `UPDATES_ENABLED` در main.rs)
- [x] فاز ۳: V3 — تلفیق آمار per-key (جهت keybr → دریل‌ها) ✅ کامیت زیر — bridge فقط-خواندنی `utils/keybr-letter-stats.ts` + ادغام در `weakLetters` (learn-stats.ts)؛ learn state و زمان‌بندی مرور دست‌نخورده؛ ۱۷۰۹/۱۷۰۹ تست سبز
- [x] فاز ۳: وریفای practice-state ✅ (اختلاف‌نظر ۳ بسته شد — ۹/۹ فایل بایت‌به‌بایت با آپ‌استریم)
- [x] فاز ۳: مستند B28 ✅ (پیش‌نیازهای updater واقعی — بخش ۱۰)
- [x] فاز ۳: updater واقعی — ✅ **کاربر 2026-11-04: تصمیم به بعد موکول شد** (نصب دستی exe از `releases/` تا آن‌موقع). رویه کامل زمان تصمیم: بخش ۱۰.

## ۶. معیارهای موفقیت (KPI)

1. تست پذیرش backup: تطابق ۱۰۰٪ کلیدها پس از export→پاک→import (فاز ۲).
2. انطباق XP محلی با فرمول آپ‌استریم در سناریوهای streak دار = صفر اختلاف (فاز ۱).
3. حجم clone بدون رشد با هر ریلیز (فاز ۰).
4. تعداد فایل‌های تغییر‌یافته خارج از درزهای تعریف‌شده به‌ازای هر قابلیت جدید = صفر (پیوسته).

## ۷. اختلاف‌نظرهای حل‌نشده (منتظر شواهد یا تصمیم کاربر)

1. **حذف `chartData` از نتایج آفلاین** — قابل‌قبول یا نه؟ با استفاده واقعی از نمودار صفحه نتیجه روشن می‌شود. *(تنها اختلاف‌نظر باز — نیازمند داده استفاده)*
2. **مرز روزِ streak** — ✅ تصمیم‌گرفته‌شده در فاز ۱: روز تقویمی محلی (انحراف مستند از UTC آپ‌استریم، کامنت `local-streak.ts`).
3. **منشأ `practice-state`** — ✅ بسته‌شده در فاز ۳: هر ۹ فایل بایت‌به‌بایت با `page-practice/lib/practice/state` آپ‌استریم یکسان‌اند (پس از نرمال‌سازی CRLF)؛ فقط barrel `index.ts` دست‌ساز است (عمدی). ثبت در `VENDORED.md` همان پکیج.

## ۸. نقشه درزها — «هر تغییری باید دقیقاً اینجا برود»

| تغییر | جای دقیق |
|---|---|
| **ساختار سه‌بخشی صفحه اصلی (بخش‌ها/زیربخش‌ها)** | فقط `frontend/src/ts/constants/app-structure.ts` — داده‌محور؛ صفحه اصلی و picker عمومی `/sections/$sectionId` از همین داده رندر می‌شوند؛ بخش/زیربخش جدید = فقط یک ورودی داده (+ مسیر موجود) |
| رفتار پنجره/ترای/هات‌کی | `src-tauri/src/main.rs` (toggle: ۵۷-۶۹، ترای: ۱۰۵-۱۳۳، هات‌کی: ۱۴۶-۱۶۲، close-to-tray: ۲۴۵-۲۵۱) |
| رفتار آفلاین هر قابلیت | `DESKTOP_OFFLINE` (`local-persistence.ts:23`) + ۱۰ مصرف‌کننده (db.ts, ready.ts, ape/server-configuration.ts, collections/results.ts, router/routes.ts, test/test-logic.ts, utils/json-data.ts, local-persistence.ts, screenshot.ts, version.ts) |
| ذخیره نتیجه/PB/XP آفلاین | `test-logic.ts:1116-1186` → `db.ts:334 (saveLocalResult)` → `local-persistence.ts` |
| موتور یادگیری keybr | فقط درز `ts/keybr/session.ts` + `KeybrPage.tsx` — موتور `src/keybr/` verbatim بماند (تغییر فقط با `scripts/vendor-keybr.mjs`) |
| صفحه جدید | `router/routes.ts` + union `PageName` + `Nav.tsx` + rewrite در `firebase.json` |
| backup/restore | `local-persistence.ts:276-303` + `desktop-auto-backup.ts:86-90` |
| تنظیمات/مهاجرت اسکیما | `config/persistence.ts` + `utils/local-storage-with-schema.ts` |
| مجوزهای وب‌ویو | `src-tauri/capabilities/default.json` |
| CSP / بسته‌بندی NSIS | `tauri.conf.json:13-14` / `17-27` |
| فرمان IPC جدید Rust | `#[tauri::command]` در main.rs + `generate_handler!` (L217) + فراخوانی از `window.__TAURI__.core.invoke` |

## ۹. پروتکل استفاده از این سند در جلسات بعد

1. پیش از هر تغییر، بخش ۸ (نقشه درزها) مرجع است؛ تغییر خارج از درزها = ثبت تصمیم جدید در همین سند.
2. هر فاز با کامیت جداگانه و تیک چک‌لیست بخش ۵ بسته می‌شود.
3. وضعیت فعلی اجرا: **هر چهار فاز بسته و پذیرش‌آزمایی شدند** — آزمون نصب ویندوز 0.11.0 توسط کاربر، هر ۷ مرحله سبز (single-instance، ترای، ماندگاری نتیجه/PB/XP، drillهای keybr-محور، `keybrState/dailyGoal/wordBlast` در backup v2، رشد streak روز دوم). شواهد: `SoftwareRelease/pre-releases/0.11.0/08-test-plan.md`. کار باز سمت کاربر: فقط تصمیم updater برای آینده (بخش ۱۰ — موکول‌شده). شمارش KI باز: KI-20 (Medium)، KI-21 (Low)، KI-22 (Medium) — `SoftwareRelease/pre-releases/0.11.0/09-known-issues.md`.

## ۱۰. پیش‌نیازهای B28 — updater واقعی (دست‌نخورده تا تصمیم کاربر)

محرک: `UPDATES_ENABLED` در `main.rs:74` **و** endpoint واقعی در `tauri.conf.json:28-33` — با هم، نه جدا (P6).

1. **جفت‌کلید minisign:** `npx tauri signer generate -w <مسیر امن خارج مخزن>` — کلید عمومی جای `pubkey` فعلی در `tauri.conf.json`؛ کلید خصوصی فقط به‌صورت env (`TAURI_SIGNING_PRIVATE_KEY` [+ رمز در `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`]) روی ماشین بیلد. کلید خصوصی هرگز commit نمی‌شود.
2. **Hosting فایل endpoint:** انتخاب کاربر — (الف) GitHub Releases: endpoint به `https://github.com/<user>/<repo>/releases/latest/download/latest.json` و آپلود `latest.json` + آرتیفکت امضاشده در هر ریلیز؛ (ب) سرور خودتان: یک JSON استاتیک + فایل‌ها با آپلود دستی.
3. **جریان هر ریلیز پس از B28:** `tauri build` با env کلید → آپلود `ParallelType_*_x64-setup.exe` + `ParallelType_*_x64-setup.exe.sig` + `latest.json` (نسخه، pub_date، پلتفرم windows-x86_64، امضا) → بعد از تأیید آپلود، بامپ `UPDATES_ENABLED=true` در ریلیز بعدی (نه اولین).
4. **تست ایمن پیش از فعال‌سازی:** endpoint آزمایشی + bump نسخه ساختگی — مسیر check → download → install را یک‌بار end-to-end امتحان کنید؛ `minisign-verify` کلید عمومی را تأیید می‌کند.
5. ماندگار: هشدار «نسخه جدید» فقط پس از هر دو کلید هم‌زمان روشن (KI-05 سپس بسته می‌شود).
