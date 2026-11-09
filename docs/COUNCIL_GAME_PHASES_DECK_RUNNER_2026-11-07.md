# فازبندی پیاده‌سازی «Deck Runner» (G24) — ParallelType

> تاریخ: 2026-11-07 | شورا | منبع: `Game Ideas/IMPLEMENTATION_SPEC_DECK_RUNNER.md` (خوانده کامل)
> مخزن: `monkeytype/monkeytype-master` @ `3510f9a` (0.21.0 released) + فازهای اصلاحی/ایده‌ای قبل
> **وضعیت: فازبندی مصوب — اجرا فقط با دستور صریح کاربر، فاز به فاز.**
> حکم: **چندفازی لازم است** — یک بازی روگلایت کامل (موتور + اقتصاد + UI + محتوا) در یک فاز جا نمی‌شود؛ همان تقسیم M1-M4 سند، با تطبیق به قراردادهای این محصول.

---

## قواعد حاکم بر همه فازها

- هر فاز = کامیت(های) conventional جدا + سوئیت کامل سبز پیش از کامیت (مبنا ۱۸۷۰) + tsc صفر.
- **refresh آپ‌استریم همچنان کنارگذاشته** (تصمیم فاز ۰ ایده‌ها) → به‌جایش: anchor-verification اجباری پیش از هر ویرایش (سند از درخت 2026-11-05 است؛ از آن‌وقت weakLettersDetailed/smart-drill/enter-drill اضافه شده‌اند).
- ممنوعه‌های سند (§۸): صفر تماس منطقی آپ‌استریم؛ فقط `routes.ts` (append)، `app-structure.ts` (داده)، `local-persistence.ts` (۲ فیلد optional).
- موتور ۱۰۰٪ خالص و تزریقی (الگوی smart-drill/weakness-model فازهای قبل) — UI فقط سیگنال روی موتور.
- jokerهای دارای پیش‌نیاز (ruleWeakLetters → مدل ضعف فاز ۲؛ dictation → tts-speech فاز ۵) فقط با feature-check در pool ظاهر می‌شوند — هر دو پیش‌نیاز **الان در مخزن هست**.

---

## فاز ۱ — موتور خالص (M1 سند) — ✅ **کامل شد 2026-11-07**

- **اجرا:** کامیت‌های `8ba77bf` (فیکس infra: پول loading-bar با vi.waitFor — KI-28) و `4a9bcc7` — چهار فایل موتور خالص + ۳۰ تست (قطعیت seed، نرمال‌سازی، zipf، argmax، برد/باخت/skip/boss/طلا، tiers/pipeline). کشف: zipfy آپ‌استریم می‌تواند index=n برگرداند — آینه با clamp. سوئیت ۱۹۰۰/۱۹۰۰ + tsc صفر.

| مورد | شرح |
|---|---|
| فایل‌های جدید | `utils/deck-runner/rng.ts` (LCG با seed تزریقی — نه Date.now)، `words-source.ts` (آداپتورها: language/zipf/custom/weakness؛ لیست‌ها تزریقی، fetch فقط در لایه نازک UI-آماده)، `round-engine.ts` (بودجه/سهمیه/رویداد کلمه/skip/bossRule)، `scoring.ts` (chips×mult + پله‌های combo + خط‌لوله joker به‌ترتیب slot) |
| قراردادهای سفت | کلمه بدون فاصله، طول ۳..۱۰، dedupe پنجره‌ای ۱۰تایی، skip بودجه می‌سوزاند ولی combo نمی‌شکند، بدون تایمر (بودجه جای زمان — قطعیت) |
| تست‌ها | `deck-runner/rng.spec` · `round-engine.spec` · `scoring.spec` — الگوی word-blast.spec (میانگین‌های آماری) |
| خروجی فاز | بازی در سطح «دور» قابل شبیه‌سازی headless |
| کامیت | `feat(games): deck-runner pure engine (rng/words/round/scoring)` |
| برآورد | ۲-۳ روز |

## فاز ۲ — کارت/فروشگاه/ران + ماندگاری (M2 سند) — ✅ **کامل شد 2026-11-07**

- **اجرا:** کامیت `64e7ea4` — cards.ts (۱۴ joker پوشش‌دهنده همه انواع effect + jokerRuntime + قواعد duplicate/gating) · shop.ts (offers قطعی per-position + reward با یک common تضمینی) · run-engine.ts (state machine + escalation ×1.6 + riskQuota + gold economy) · run-store.ts (run قابل resume + stats + dailyBest) · بک‌آپ: ۲ فیلد optional v3 در local-persistence (غایب = حفظ). KI-28 پیگیری شد: testTimeout ۱۵s سراسری + afterEach تمیزکاری run-store.spec + app-shell با vi.waitFor. سوئیت ۱۹۳۳/۱۹۳۳ + tsc صفر.
- **نکته:** یک flake باقی‌مانده app-shell loading-bar (یک در هر دو گیت متوالی) — ریشه harness-محور است (loading page قبل از resolve نتایج unmount می‌شود)، جلسه جدا می‌خواهد؛ KI-28 ارتقا یافت.

| مورد | شرح |
|---|---|
| فایل‌های جدید | `cards.ts` (zod schema + registry + evaluate خالص — v1: ~۱۲ joker هسته‌ای از خانواده‌های flatChips/chipsPer/mult/comboFloor/rule*/economy)، `shop.ts` (پیشنهاد seed-دار + rarity curve per-ante + رفرش/sell)، `run-engine.ts` (state machine menu/blind/reward/shop/gameover + منحنی سهمیه ×~1.6)، `run-store.ts` (run قابل resume + stats + history ≤10 + daily) |
| لمس آپ‌استریم (تنها) | `local-persistence.ts`: ۲ فیلد optional کنار wordBlastScores — بدون bump (قرارداد absent=keep؛ Y6) |
| تست‌ها | cards (هر joker یک case) · shop (seed-دار/curve) · run-engine (فازها/شکست/escalation/resume round-trip) · run-store (الگوی resetModules + بک‌آپ round-trip + v1-بدون‌فیلد=حفظ) |
| خروجی فاز | بازی کاملِ قابل بوت در تست headless (بدون UI) |
| کامیت | `feat(games): deck-runner cards, shop & run state machine` |
| برآورد | ۲-۳ روز |

## فاز ۳ — UI + مسیر/هاب (M3 سند) — ✅ **کامل شد 2026-11-07**

- **تصمیم هاب:** گزینه picker (توصیه سند) — word blast به `/games/word-blast` منتقل شد (محتوایش دست‌نخورده؛ فقط مسیر)، `/games/deck-runner` اضافه شد، بخش games در `app-structure.ts` دو کارتی شد (picker خودکار، همان الگوی learning/practice). گارد ساختار به‌روز + تست رندر games-picker.
- **اجرا:** کامیت `1df31ba` — `states/deck-runner.ts` (سیگنال‌ها، pool cache، weakness snapshot، mirror stream برای نمایش کلمات بعدی، SFX) · سه کامپوننت (DeckRunnerPage با Switch فازها، BlindRound با HUD/استریم/joker row/space=skip/backspace=undo، CardRow با rarity ring و قیمت) · typing-buffer API در round-engine (typeChar/backspace خالص + ۶ تست).
- **معیار پذیرش:** سوئیت کامل ۱۹۴۳/۱۹۴۳ سبز + tsc صفر. DoD دستی (شروع ران → برد blind → reward → shop → boss → gameover → resume) با بیلد ویندوز بعدی.

## فاز ۴ — محتوا و پولیش (M4 سند) — ✅ **کامل شد 2026-11-07**

- **اجرا (۱ کامیت):** `dbef1de` — `balance.ts` — همه اعداد tuning از ۴ فایل موتور به یک فایل مهاجرت کردند (re-export برای سازگاری) · ۱۶ joker جدید تا **سبد ۳۰ کارت** (هر یک یک effect از schema موجود، تست table-driven با baseline-delta) · هوک XP با ثابت `DECK_RUNNER_XP_CREDIT` پیش‌فرض **false** (تصمیم G28 معلق) — مسیر DB.addXp آماده · history ران‌ها در menu.
- **باقی‌مانده دستی:** playtest balance (سهمیه‌ها/ضریب‌ها) — tune در balance.ts یک‌فایلی.
- **معیار پذیرش:** سوئیت کامل ۱۹۴۷/۱۹۴۷ سبز + tsc صفر. DoD دستی با بیلد ویندوز بعدی.

## فاز ۵ — سیم‌کشی جوکرها، فعال‌سازی قوانین باس و retune (بازبینی شورا) — ✅ **کامل شد 2026-11-07**

- **زمینه:** بازبینی شورا سه عیب Critical یافت که تست‌های unit از آن‌ها عبور می‌کردند: (۱) پایپ‌لاین امتیاز jokerها هرگز به مسیر زنده وصل نشده بود (۱۶/۳۰ کارت بی‌اثر؛ `wordScore` بدون jokers/wordIndex/language صدا زده می‌شد؛ `everyNthWord` به‌طور پنهان روی هر کلمه match می‌شد)، (۲) retune v1.1 (`84b2edd`: quota 800/×1.75) روی بازیِ بدون‌جوکر کالیبره شده بود و بازی را برنده‌نشدنی کرده بود (شبیه‌ساز: برد A1-small = ۰٪ در نرخ خطای ۲-۱۰٪)، (۳) قوانین باس هیچ‌گاه تخصیص نمی‌یافتند.
- **تصمیم‌های مالک:** قوانین باس فعال شوند؛ متن کارت‌ها ملاک باشد (نه مقادیر ×10).
- **اجرا (۲ کامیت):**
  - `c89831b` — سیم‌کشی موتور: `typeChar`/`submitWord` حالا pipeline جوکرها + language + اندیس ۰-محور کلمه را به `wordScore` می‌رسانند (نوع `ScoreJokerFn` در round-engine — بدون چرخه وابستگی با cards) · معناشازی `perfectComboOnly` در مسیر کلیدبه‌کلید (خطا = انجماد نه ریست؛ رشد فقط با کلمهٔ بی‌نقص) · تخصیص قوانین باس در `currentBlindConfig`: big = errorPenalty(۱۰)، boss = آنت ۱ perfectComboOnly / آنت ۲+ longWords(۶) · نمایش قانون فعال در HUD · retune سهمیه با شبیه‌ساز headless (موتور واقعی، ۳۰۰ seed per سناریو، اعتبارسنجی آینه EXACT): **BASE_QUOTA 500 / QUOTA_GROWTH 1.6 / جریمه 10** — نردبان شبیه‌سازی‌شده: A1-small بدون جوکر ~۹۹٪ → A1-big با یک joker امتیازی ۱۰۰٪ (بدون جوکر ۰٪ = گیت اقتصاد فروشگاه) → A2 با یک joker ~۶٪ و با دو joker flat ۱۰۰٪ · ۵ تست گارد سیم‌کشی + تست قوانین باس.
  - `7886360` — مقادیر ۸ کارت به مقیاس متن برگشت (greedy_fox 25، bookworm 30، code_monkey 15، sprinter 40، quick_fingers 15، code_poet 40، heavy_hitter 60، long_haul 80) + دلتاهای spec.
- **معیار پذیرش:** سوئیت کامل **۱۹۵۳/۱۹۵۳** سبز (شورا بازاجرا کرد) + tsc صفر + هوک‌های pre-commit.
- **بازِ باقی‌مانده:** استخر واژگان «1k» همچنان `english.json`/`persian.json` (~۲۰۰ کلمه) را لود می‌کند نه فایل‌های `_1k`؛ refund کسری skip؛ tiers combo [50,3]/[100,5] غیرقابل‌دسترس؛ KI-28 (flake loading-bar)؛ DoD دستی روی بیلد ویندوز بعدی.

## فاز ۶ — بستن همهٔ یافته‌های بازبینی (دستور مالک: «تمام مشکلات + بیلد 0.23») — ✅ **کامل شد 2026-11-07**

- **اجرا (۳ کامیت + bump):**
  - `bdcaafa` — استخرهای واقعی 1k (`english_1k`/`persian_1k` — قبلاً لیست ۲۰۰تایی با برچسب 1k) + منبع **code — python** در منو (بدون آن jokerهای codeWord غیرقابل‌رسیدن بودند — یافتهٔ جدید شورا) + rareBonus بر اساس **language** (پیشوند sourceId به‌صورت خاموش weakness:/custom:/code: را جا می‌انداخت — یافتهٔ جدید) + fallback منبع weakness به uniform (به‌جای همیشه-اولین کلمه) + mirror با headroom ×2 (refund صف را خالی نمی‌کند).
  - `d208114` — refund skip با **credit صحیح** (اعشار انباشته می‌شود تا یک کلمهٔ کامل شود — wordsLeft همیشه صحیح؛ skip_broker هر دومین skip را برمی‌گرداند، second_wind همه را) + dedupe پیشنهادهای فروشگاه (یک فروشگاه هرگز کارت تکراری نشان نمی‌دهد) + **tiers قابل‌دسترس** [5→1.2، 10→1.5، 20→2، 30→3] (قدیمی‌ها x3/x5 در streak 50/100 هرگز شلیک نمی‌شدند) + شبیه‌ساز مجدد: A1-small عادی ۱۰۰٪، A2 با یک joker قابل‌رسیدن (boss ۲۲٪)، دو flat هر دو آنت را ۱۰۰٪ می‌بَرد.
  - `6cc90e0` — خط پیشرفت تایپ RTL (dir=auto — همان خانوادهٔ فیکس کرسر 0.13.2) + تأیید دومرحله‌ای abandon (کلیک اشتباهی ران زنده را پاک نمی‌کند) + `deriveSeed` تک‌نسخه‌ای در rng.ts.
- **معیار پذیرش:** سوئیت کامل **۱۹۵۴/۱۹۵۴** سبز + tsc صفر · bump `625a926` → بیلد ویندوز 0.23.0.
- **بازِ عمدی:** KI-28 (flake هیستریک loading-bar — طبق تصمیم قبلی جلسهٔ مستقل می‌خواهد)؛ KI-22 (عدم‌تطابق هش آرتیفکت 0.10.0 — مستندسازی‌شده در releases/README)؛ dailyBest که ران‌های غیر-daily را هم ثبت می‌کند (تصمیم محصولی؛ ثبت شد).

## پیوست — فعال‌سازی آپدیتر (دستور مالک) — ✅ **2026-11-07**

- **چرخش کلید (کامیت `436bd92`):** کلید خصوصی minisign قدیمی (`6E79261CEEB2ECDC`) از 0.10.0 روی این ماشین نبود و زنجیرهٔ آپدیت مرده بود → جفت‌کلید جدید تولید شد؛ pubkey جدید `CB3BCCFD2E40042A` در tauri.conf.json جاسازی شد؛ کلید خصوصی در `~/.tauri/paralleltype-updater.key` (بیرون از مخزن، **هرگز کامیت نشود** — گم شدنش یعنی مرگ زنجیره؛ بک‌آپ شود). کلاینت‌های ≤0.9 باید یک بار دستی نصب کنند.
- **بیلد امضاشده:** `ParallelType_0.23.0_x64-setup.exe` + `.sig` در releases/ با هش ثبت‌شده — اولین آرتیفکت آپدیتر از 0.9.x.
- **دو کشف فرایندی در حین بیلد:** (۱) tauri.conf فاقد `beforeBuildCommand` است — دو بیلد اول اشتباهاً dist کهنهٔ 0.22.0 را باندل کردند و جایگزین شدند؛ از این پس dist باید قبل از tauri build تازه شود (یک `npx vite build`)، (۲) `npm run build` روی چرخهٔ madge `db.ts ↔ desktop-auto-backup.ts` (موجود از قبلِ 0.22.0؛ import استاتیک db.ts:45 در برابر dynamic import طرف دیگر) شکست می‌خورد — نیاز به فیکس دارد (منتظر جلسهٔ بعدی).
- **مانع باقی‌ماندهٔ تحویل:** endpoint آپدیتر placeholder است (`updates.paralleltype.example`) — تا میزبانی واقعی (مثلاً GitHub Releases یا سرور استاتیک + `latest.json`) به‌روزرسانی خودکار دانلود نمی‌شود؛ امضا و اعتبارسنجی سمت کلاینت فعال است.

