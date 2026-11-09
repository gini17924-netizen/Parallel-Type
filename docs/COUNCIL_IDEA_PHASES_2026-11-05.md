# فازبندی اجرای ایده‌های پوشه Idea — ParallelType

> تاریخ: 2026-11-05 | شورا | مبنا: HEAD فعلی `monkeytype/monkeytype-master` (`215246d`، بعد از ۱۵ کامیت اصلاحی حفره‌کاوی)
> منابع: ۶ سند پوشه `Idea/` (#7، #8، #11، #12، RANK2 شامل #9+#13، راهنمای جایگاه‌گذاری) + تطبیق با کد فعلی
> **وضعیت: مصوب شورا — اجرا فقط با دستور صریح کاربر، فاز به فاز.**
> پوشه `Game Ideas` خالی است — وقتی پر شد فازبندی جداگانه می‌گیرد.

---

## ۰. کشف کلیدی تطبیق سندها با کد فعلی (ریسک‌های باگ که فازبندی آن‌ها را حذف می‌کند)

سندها 2026-11-04/05 نوشته شده‌اند؛ **قبل از** فازهای اصلاحی ما (Y1-Y6، Lها). راستی‌آزمایی تداخل‌ها:

| # | سند | نقطه برخورد با کد فعلی | اقدام فاز |
|---|---|---|---|
| ۱ | #11 صادرات | `local-persistence.ts` الان شامل: اعتبارسنجی zod فیلدهای snapshot (Y6)، sanitize امتیاز WordBlast (L4)، اکسپورت `MAX_RESULTS`/`isResultsCapped` (Y4) است. بک‌آپ v3 باید **درون** همین ساختار بنشیند، نه کنارش. `importBackup` دیگر مسیر واحد نیست — `db.importLocalBackup` (Y1) ارکستراتور است | فاز ۱: v3 از همان ارکستراتور عبور کند؛ حذف heavy در لایه persistence (زیر wrapper دیلت در db.ts — بدون دوباره‌محاسبه) |
| ۲ | #7 weakspot | `keybr/session.ts` بعد از L1+L9 بازسازی شده: `loadStoredResults` به `stored-results.ts` واگذار شده، `@ts-nocheck` حذف شده (تایپ‌چک فعال!)، `StoredStats` re-export می‌شود. singleton لودر مدل باید **کاملاً تایپ‌دار** نوشته شود | فاز ۲: لنگرها با جستجوی نماد بازچک؛ singleton روی API موجود `loadPhoneticModel` |
| ۳ | #7/#9 | `learn-stats.ts`: تابع `enableDrillKeymap` حذف شده (L7) — شیفت خط ~۷تایی. test-logic.ts: +۳ خط cursor commit (L8) — گیت نام ~1211 جابه‌جا | فازهای ۲/۳: anchor-verification الزامی (قاعده §۱ راهنما) |
| ۴ | #8+#12 | هر دو روی **سه‌گانه funbox** (enum schema + list + registry) می‌نویسند — تست انسجام `funbox.spec.ts` جفت‌شدن را اجباری می‌کند (سابقه growing_text: ارتقای mockClear→mockReset) | فازهای ۴/۵: ترتیب متوالی، هر یک کامیت جدا |
| ۵ | #7/#9/#12 | هر سه `DrillsPage.tsx` را لمس می‌کنند (کارت smart-drill + بخش Enter + toggle صدا) | ترتیب متوالی ۲→۳→۵ |
| ۶ | #8 | `canGetPb:false` — مسیر PB آفلاین ما (سه نقطه: test-logic، getLocalPB، local-result-maintenance) از قبل metadata را آینه می‌کند (تأیید حفره‌کاوی) | صفر کار اضافه — فقط تست رگرسیون |
| ۷ | همه | هر سند در چک‌لیستش «refresh آپ‌استریم + تطبیق خط‌ها» را گام ۱ خواسته | فاز ۰ (گیت تصمیم) |

---

## نقشه وابستگی

```
فاز ۰ (refresh) ──┬──> فاز ۱ (#11) ──────────────┐
                  ├──> فاز ۲ (#7) ──> فاز ۳ (#9) ─┼──> فاز ۶ (#13 + بستن)
                  │              └──> فاز ۴ (#8)  ┤
                  │              └──> فاز ۵ (#12) ┘
                  └── (اگر refresh واگذار شد: فقط لنگرچک سخت‌گیرانه‌تر)
```

---

## فاز ۰ — تصمیم/اجرای refresh آپ‌استریم (گیت، نه اجبار)

- **چرا:** هر ۵ سند گام اول پیوست‌ب خودشان refresh است؛ فورک ۶۳+ کامیت جلوتر از مبنا و بدون ریموت است و هر روز سخت‌تر می‌شود.
- **تصمیم با کاربر:** (الف) refresh واقعی (نیازمند افزودن ریموت آپ‌استریم/شبکه + merge + تطبیق لنگرها + سوئیت کامل) — برآورد ۰.۵ تا ۲ روز بسته به دلتای آپ‌استریم؛ یا (ب) واگذاری مشروط با آگاهی از ریسک merge بزرگ‌تر در آینده.
- **توصیه شورا: (الف)** — پیش از خوشه ایده‌ها، چون #8/#12 سه فایل آپ‌استریم را additive می‌نویسند و #11 یک فایل آپ‌استریم (MiniResultChart) را لمس می‌کند.

## فاز ۱ — ایده #11: صادرات کامل داده + heavy store + بک‌آپ v3 (بستن KI-20) — ✅ **کامل شد 2026-11-05**

- **چرا اول:** مستقل از #7؛ سنگین‌ترین جراحی persistence است و بافت اصلاحات اخیر ما (Y1/Y4/Y6/L4) هنوز تازه است = کمترین ریسک باگ دقیقاً حالا؛ قدیمی‌ترین KI باز را می‌بندد و پاسخ ساختاری به تنها اختلاف‌نظر باز شورا (chartData) است.
- **تصمیم‌های مالک (ثبت‌شده):** سقف **۱۰۰۰۰** (نه ۵۰۰۰ پیشنهاد سند) · رتیفای «chartData جابه‌جا می‌شود نه حذف» → اختلاف‌نظر باز ۱ شورا بسته شد.
- **اجرا (۳ کامیت):** ✅ `e2cd358` — ماژول `result-export.ts` (CSV کامل بدون فیلتر/سقف، RFC 4180، ستون‌های افزوده، فیکس باگ کامای funbox، نام تاریخ‌دار) + سقف ۱۰۰۰۰ + rewiring دکمه با برچسب «Export CSV (all)» + اظهار فیلدهای `customText/wpmConsistency` روی SnapshotResult · ✅ `267503b` — فروشگاه سنگین `resultsHeavy` بدون‌سقف (نوشتن twin در همان tx، upsert دوسویه، تقارن حذف، اخراج سقف فقط light) + شاخه آفلاین `getSingleResultQueryOptions` + گارد MiniResultChart («toolong»/غایب = پیام inline) · ✅ `88d251f` — بک‌آپ v3 با `resultsHeavy` (اکسپورت همه twinها، import = clear+refill با skip نامعتبرها، غایب = حفظ طبق اصل Y6، سازگاری v1/v2).
- **انحراف آگاهانه از سند:** دکمه JSON اختیاری (قطعه ۵) اجرا نشد — بک‌آپ کامل از قبل JSON است؛ در صورت نیاز بعدی اضافه می‌شود.
- **کشف جانبی مهم:** کلاس flake بین‌فایلی fake-indexeddb (۲ شکست نادر سوئیت کامل) — baseline shuffle روی HEAD تمیز بازتولیدش کرد (از-قبل-موجود)؛ واکسیناسیون قربانی+سه spec اعمال شد؛ **KI-28** ثبت شد.
- **معیار پذیرش:** سوئیت کامل ۱۸۲۹/۱۸۲۹ سبز + tsc صفر + تست‌های v3/v2/v1 سازگاری سبز. DoD دستی (CSV واقعی، نمودار قدیمی، restore) با بیلد ویندوز بعدی کاربر.
- **وضعیت refresh (فاز ۰):** کاربر کنار گذاشت — اجرای ایده‌ها بدون refresh با لنگرچک سخت‌گیرانه ادامه می‌یابد (ریسک merge بزرگ‌تر در آینده، پذیرفته‌شده).

## فاز ۲ — ایده #7: مدل ضعف یکپارچه + smart drill (فارسی v2) — ✅ **کامل شد 2026-11-05**

- **چرا بعد از #11:** پایه #8/#9/#12 است؛ بزرگ‌ترین قابلیت all-fork با دو ماژول جدید.
- **اجرا (۲ کامیت):** ✅ `dc5e4e3` — `weakness-model.ts` خالص (هموارسازی α=3، نرمال‌سازی رتبه‌ای per-source با رأی برابر، latency term کلید keybr، گیت per-source ≥5، acc نمایشی **خام** طبق قرارداد سازگاری weakLetters) + `weakLettersDetailed` با evidence + پل latency (`totalTimeToType`) · ✅ `4e805a5` — `smart-drill.ts` خالص (مدل تزریقی، seed صریح، argmax weakspot برای واقعی‌ها، Filter با قرارداد حرف متمرکز + retry cap + پس‌نشینی unfocused، fallback بایگرام) + singleton `loadSharedPhoneticModel` + کارت UI و evidence badges + گیت ثبت SM-2.
- **تصمیم مالک (اجرا شد):** ثبت فقط smart drill در SM-2 — گیت `["learning drill", "smart drill"]`؛ دریل‌های ردیفی ثبت نمی‌شوند.
- **کشف‌های حین اجرا (ثبت برای آینده):** (۱) label حروف مدل fa با **پیشوند ZWNJ** می‌آید — تطبیق فقط با codePoint؛ (۲) `Filter` آبجکت `Letter` می‌خواهد و `Letter.toLetter` روی string خام پرتاب می‌کند؛ (۳) tsconfig عمداً `__tests__/**` را exclude می‌کند → specها نمی‌توانند `@keybr/*` alias بزنند (ایمپورت عمیق نسبی به lib) — tsc هم تست‌ها را type-check نمی‌کند (حفره پوشش شناخته‌شده).
- **معیار پذیرش:** سوئیت کامل ۱۸۴۴/۱۸۴۴ سبز + tsc صفر + ۷ تست قطعی seed-based smart drill + ۷ تست مدل (شامل flood-proofing و latency). DoD دستی (چند دریل + مشاهده جابه‌جایی تمرکز) با بیلد ویندوز بعدی کاربر.
- **صفر تماس تأیید شد:** `@keybr/**` فقط import، `weak-spot.ts`/`packages/funbox/*` دست نخورده، قرارداد فقط‌خواندن `mtKeybrResults:*` حفظ شد.
- **معیار پذیرش:** DoD سند §۷ + تست‌های قطعی seed-based.

## فاز ۳ — ایده #9: دریل کلید Enter — ✅ **کامل شد 2026-11-05**

- **اجرا (۱ کامیت):** ✅ `e3dc0a9` — `enter-drill.ts` (سه سبک prose/code/chat با seed قطعی LCG، سقف ۱۰۰ توکن custom-mode، fallback pool بدون لیست زبان) + مپ `"
"→"enter"` در `registerDrillResult` (merge؛ SM-2 یکسان) + بخش UI سه‌دکمه‌ای با نمایش دقت enter + گارد funbox هنگام شروع + `setActiveDrillWords` ۱:۱ با توکن‌ها + گیت `"enter drill"` در test-logic.
- **نکته اجرایی:** موتور آپ‌استریم صفر تغییر — کشف سند تأیید شد (ورودی/کامیت/glyph/Shift+Enter همه از قبل کار می‌کنند). لبه «کلمه آخر Enter نمی‌گیرد» پذیرفته و مستند.
- **معیار پذیرش:** سوئیت کامل ۱۸۵۳/۱۸۵۳ سبز + tsc صفر + ۹ تست جدید (قرارداد توکن، مپ، SM-2 enter). DoD دستی (تایپ دریل چندخطی و مشاهده دقت enter) با بیلد ویندوز بعدی کاربر.

## فاز ۴ — ایده #8: funbox «weak_letters» — ✅ **کامل شد 2026-11-05**

- **پیش‌نیاز:** #7 (فراهم — کامیت‌های فاز ۲).
- **اجرا (۱ کامیت):** ✅ `8d43e8b` — سه ورودی additive آپ‌استریم (enum انتهای `FunboxNameSchema`، ورودی list بعد از weakspot، registry delegate ~۵ خط) + `weak-letters-funbox.ts` (argmax ۲۰ کاندید از `wordset.words` روی LCG ماژول، cache سشن weakness، pass-through بی‌شواهد، `""` برای wordset غایب) + `canGetPb:false` (سه نقطه PB از قبل metadata-محور) + سطرهای validation (سازگار با capitals؛ رد با zipf/weakspot/pseudolang).
- **کشف حین اجرا:** نمونه‌گیری اولیه از `wordset.randomWord` بود (رندوم داخلی wordset = غیرقطعی برای seed) — به نمونه‌گیری مستقیم از `wordset.words` با LCG ماژول بازنویسی شد تا قرارداد قطعیت سند واقعاً برقرار باشد.
- **سیاست ثبت‌شده:** delegate رجیستری = تنها استثنای مصوب سیاست zero-touch سند #7 (additive ~۵ خط).
- **معیار پذیرش:** سوئیت کامل ۱۸۵۸/۱۸۵۸ سبز + tsc صفر + ۵ تست نمونه‌گیر (argmax، pass-through، قطعیت seed، undefined-wordset، ریست cache) + ۲ سطر validation + coherence. DoD دستی (فعال‌سازی funbox و مشاهده وزن‌دهی؛ بدون تاج PB) با بیلد ویندوز بعدی.

## فاز ۵ — ایده #12: funbox «tts_seen» + دریل گویا — ✅ **کامل شد 2026-11-05**

- **وابستگی:** #7 (toggle روی کارت smart-drill).
- **اجرا (۱ کامیت):** ✅ `feac4d6` — سه ورودی additive آپ‌استریم (enum بعد از tts، ورودی list با `properties:["speaks"]` بدون css/visibility، رجیستری delegate) + `tts-speech.ts` (resolve زبان per-speak با bcp47/fallback en-US، تطبیق پیشوندی دوسویه صدا، نوتیف یک‌باره per-language، نگه‌داشتن مرجع utterance ضد GC، هرگز throw نیست) + `drill-speech.ts` (toggle `mtDesktopDrillSpeech` با LocalStorageWithSchema + effect روی active word index با گیت‌های سه‌گانه + `speakCurrentWordIfEnabled` از init) + دکمه toggle روی کارت smart drill + سطرهای zen (رد) و جفت گویا (رد).
- **انحراف آگاهانه از سند:** به‌جای createEffect داخل `states/test.ts` (فایل آپ‌استریمِ تاکنون دست‌نخورده)، effect در ماژول فورک `drill-speech.ts` با createRoot ماژول‌محوری زندگی می‌کند و از `index.tsx` (از قبل فورک‌شده) یک‌خطی نصب می‌شود — همان observable، سطح merge کمتر. به‌علاوه کلمه اول از init (خط ۶۵۰ test-logic) پوشش داده شد، نه subscribe روی restartTestEvent (dispatch قبل از ست شدن کلمات است).
- **صدا = SAPI ویندوز:** ✅ رفتار واقعی روی ویندوز تأیید شد (2026-11-07، مالک — همه سبز).
- **معیار پذیرش:** سوئیت کامل ۱۸۶۶/۱۸۶۶ سبز + tsc صفر + ۷ تست wrapper (شامل رگرسیون stale-lang) + سطرهای zen/جفت گویا. DoD دستی (read-along فارسی با/بدون صدای نصب‌شده) با بیلد ویندوز بعدی.

## فاز ۶ — ایده #13: تم‌ها + بستن چرخه — ✅ **کامل شد 2026-11-05**

- **اجرا (۱ کامیت):** ✅ `d9bf437` — ۹ تم (fade_ghost با hasCss + ۸ پرچم مسطح؛ germany/france با hasCss نوار لوگو) append دو-فایله هم‌زمان + ۳ فایل CSS + **گاردهای همگامی دو-فایله** (هر کلید themes ⊆ ThemeNameSchema و بالعکس — حفره سکوت‌آور آپ‌استریم بسته شد؛ hasCss↔فایل داده‌محور؛ محتوای CSS fade_ghost assert می‌شود).
- **قاعده طلایی پرچم‌ها اجرا شد:** بگ مسطح (خوانایی متن + darkMode/FavIcon + بک‌گراند سفارشی)، نوار فقط روی `[data-ui-element="logoText"]` با background-clip — و انحراف طراحی کوچک: بند اول گرادیان آلمان از #000 به #dd0000 (خوانایی روی بگ نزدیک-سیاه).
- **معیار پذیرش:** سوئیت کامل ۱۸۷۰/۱۸۷۰ سبز + tsc صفر + ۴ گارد جدید + Theme.spec رگرسیون سبز.

## بستن چرخه — ✅ **2026-11-05**

- **bump نسخه:** ✅ `3510f9a` chore(release): bump desktop to 0.21.0 (tauri.conf + Cargo.toml + Cargo.lock خودکار).
- **snapshot ریلز:** `SoftwareRelease/versions/0/21/0/` — هر ۱۰ سند با داده واقعی پر شد (فهرست قابلیت‌ها، changelog ۲۴ کامیت، یادداشت انتشار، roadmap، محدوده، بک‌لاگ، معیارهای پذیرش، طرح تست، snapshot KI، breaking-changes: None) + manifest (status: draft — بیلد ویندوز و DoD دستی pending) — validator: ۲۱ پوشه PASSED.
- **بک‌لاگ:** #7/#8/#9/#11/#12/#13 خارج شدند؛ «توصیه شورا» به وضعیت تخلیه رده ۱/۲ به‌روزرسانی شد.
- **وضعیت نهایی:** ۲۵ کامیت روی مبنا 0.20.0 · سوئیت ۱۸۷۰/۱۸۷۰ · tsc صفر · **release_status: released — نصب و تأیید ویندوزی کامل 2026-11-07 توسط مالک (Y3/L6/TTS + DoD ایده‌ها همه سبز).**
