# فازبندی پیاده‌سازی بازی‌های G1–G6 — ParallelType

> تاریخ: 2026-11-07 | شورا | منابع: `Game Ideas/G1_WORD_BLAST_V2.md` … `G6_BALLOON_POP_SRS.md` (هر شش، خوانده کامل)
> مخزن: `monkeytype/monkeytype-master` @ `51a5356` (0.23.0) — گیت‌ها: سوئیت ۱۹۵۵/۱۹۵۵ + tsc صفر + `npm run build` سرتاسری سبز
> **وضعیت: مصوب — اجرا فقط با دستور صریح کاربر، فاز به فاز.** هر فاز قبل از شروع، anchor-verification می‌گیرد.
> **تکمیل‌شدهٔ پیش‌نیاز:** هاب بازی‌ها (picker) در فاز ۳ Deck Runner انجام شد — `app-structure.ts:77-94` دو کارت دارد؛ بازی‌های جدید فقط یک subsection append می‌کنند. «پیش‌نیاز مشترک» سندهای G2-G6 **برآورده است**.

---

## قواعد حاکم بر همه فازها

- هر فاز = کامیت(های) conventional جدا + سوئیت کامل سبز + tsc صفر پیش از کامیت (مبنا ۱۹۵۵). `npm run build` سرتاسری در فاز پایانی هر بازی.
- **صفر تماس منطقی آپ‌استریم.** لمس مجاز فقط: `routes.ts` (append)، `constants/app-structure.ts` (داده)، `utils/local-persistence.ts` (فیلدهای بک‌آپ optional — غایب = حفظ، بدون bump؛ الگوی Y6).
- موتور ۱۰۰٪ خالص و تزریقی (الگوی deck-runner `rng.ts`/engineها؛ rng تزریقی نه `Math.random`)؛ UI فقط سیگنال روی موتور.
- **BALANCE یک‌فایلی per-game** (الگوی deck-runner `balance.ts`). استخراج مشترک بین بازی‌ها ممنوع طبق تصمیم سند G6 (تکرار محلی؛ کوپلینگ بین بازی‌ها نمی‌سازیم).
- ذخیره‌سازی: الگوی `word-blast-scores.ts` (LocalStorageWithSchema + zod + هوک `_reset…ForTests`)؛ schema migration هرگز فیلد required نمی‌کند.
- هیچ بازی‌ای XP/نتیجه/PB نمی‌دهد (G28 معلق؛ G3 صراحتاً فقط‌خواندن) — ثابت XP الگوی `DECK_RUNNER_XP_CREDIT=false`.
- anchor-verification پیش از هر ویرایش: سندها از 2026-11-05 هستند؛ شماره خط‌ها ممکن است کمی جابه‌جا شده باشند (تأیید شورا 2026-11-07: باگ level-up در GamesPage ~221 هنوز سرجایش است؛ هاب انجام شده).

## ترتیب اجرا (دلیل)

**G1 → G2 → G3 → G5 → G4 → G6**

1. **G1** اول: ارتقای بازی موجود + فیکس باگ واقعی level-up — بدون مسیر جدید، کم‌ترین ریسک، ارزش فوری.
2. **G2** بعد: `bot-pacer.ts` را می‌سازد که G3 همان را مصرف می‌کند (سند G3 صراحتاً «همان bot-pacer ریاضی G2»).
3. **G3** بلافاصله بعد از G2: pacer تازه در ذهن + فقط‌خواندن (کم‌ریسک).
4. **G5** کوچک و مستقل (نفس‌گیر بین دو مورد بزرگ‌تر).
5. **G4** مستقل و متوسط (UI سنگین‌تر: گرید + کیبورد دوزبانه).
6. **G6** آخر: بزرگ‌ترین سطح UI (آرنا، ۴ استیج، وزن‌دهی weakness — مدل اکنون موجود است) + نمایش تمام‌قد integration با سیستم یادگیری.

---

## G1 — Word Blast v2 (ارتقا؛ بدون مسیر جدید)

### فاز G1.۱ — موتور خالص + مهاجرت schema — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `c0fbd2a` — `word-blast.ts` additive: `BALANCE` + `comboMult` + `levelForScore` + `pickBossWord` (بلندترین عبارت؛ در easy بلندترین واژه؛ استخر خالی → undefined) + `shouldSpawnHeart` (rng تزریقی، roll فقط در مضارب ۴۰). `word-blast-scores.ts`: `maxCombo/accuracy` optional در history + `bestCombo` ریشه + `getWordBlastBestCombo()` + sanitizer عدد bestCombo را عبور می‌دهد.
- **دو نکتهٔ پیاده‌سازی (برای فازهای بعدی):** (۱) fallback هر `LocalStorageWithSchema` باید خودش کاملِ schema باشد — `get()` وقتی مقداری نیست، fallback را **بدون parse** برمی‌گرداند؛ (۲) `.default()` زود قابل استفاده نیست چون wrapper نوع ورودی zod را به خروجی سنجاق کرده — الگو: فیلد optional + مقدار صریح در fallback + گارد `?? 0`.
- **گیت:** ۲۶/۲۶ specهای word-blast · سوئیت کامل **۱۹۶۳/۱۹۶۳** (+۸ تست) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `utils/word-blast.ts` (additive): `BALANCE` جدول‌بندی‌شده (comboTiers ×1/1.5/2/3 در 0/5/10/20، bossScoreMult 5، bossSpeedMult 0.6، heartEveryNSpawns 40، heartChance 0.35، maxLives 5، levelStep 500) + `comboMult(combo)` + `levelForScore(score)` (فیکس `floor(score/levelStep)+1`) + `pickBossWord(pools)` (بلندترین عبارت) + `shouldSpawnHeart(spawnCount, rng)` — rng تزریقی. `utils/word-blast-scores.ts`: دو فیلد optional `maxCombo/accuracy` در history + `bestCombo` ریشه؛ امضای `recordWordBlastGame` گسترش با default 0 |
| تست‌ها | comboMult مرزها (4/5، 9/10، 19/20) · levelForScore (499→1، 500→2، 1001→3) · shouldSpawnHeart با rng تزریقی (الگوی ۲۰۰-نمونه) · مهاجرت schema (entry قدیمی parse می‌شود؛ جدید ذخیره) · رگرسیون buildWordPools/pickTarget/spawnSpeed |
| خروجی فاز | موتور کامل headless؛ UI دست‌نخورده |
| کامیت | `feat(games): word-blast v2 pure engine & scores migration (idea G1, phase 1)` |
| برآورد | ۱ روز |

### فاز G1.۲ — UI، فیکس level-up، اتصال — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `32372ed` — GamesPage مصرف‌کنندهٔ موتور فاز ۱ شد: کمبو روی کلمهٔ کامل رشد می‌کند و امتیاز `len×10×comboMult` می‌پردد (boss فلت ×5)؛ **هر کلید غلط روی کلمهٔ جاری کمبو را صفر می‌کند + playError** (یک قاعده برای boss/heart هم)؛ level-up از `levelForScore` مشتق می‌شود (چک `% 500` حذف) و **دقیقاً یک boss** مادی می‌کند (بلندترین عبارت/واژه، سقوط ×0.6، حاشیهٔ main)؛ heart روی پنجره‌های ۴۰-اسپاون (انتخاب کلمهٔ کوتاه) با +1 جان تا سقف ۵؛ HUD v2 (score/wpm/accuracy/combo با پلهٔ فعال هایلایت/lives) با testidها؛ `end()` دو فیلد v2 را ثبت می‌کند. صداها با `void` (no-floating-promises).
- **گیت:** spec انتگرالشن app-shell ۷/۷ (۳ قدیم + ۴ جدید: اتصال کمبو/امتیاز/دقت، شکست کمبو، boss تضمینی در عبور level، ثبت history v2) · سوئیت کامل **۱۹۶۷/۱۹۶۷** (+۴) · tsc صفر · ۳۳/۳۳ بازاجرای پس از فیکس لینت.
- **DoD دستی باقی برای پلی‌تست نهایی:** دیدن پلهٔ ×3 → boss در level-up → heart جان بدهد → ماندگاری بک‌آپ.
| مورد | شرح |
|---|---|
| فایل‌ها | `GamesPage.tsx`: سیگنال combo/accuracy؛ کلید غلط روی کلمه جاری و رسیدن به کف → combo=0؛ امتیاز `len×10×comboMult`؛ boss در هر level-up (یک بار، سرعت ×0.6، غیرقابل skip، امتیاز ×5)؛ heart هر ۴۰ اسپاون با ۳۵٪ (+1 جان، سقف ۵)؛ HUD v2 (پله combo + acc% + جان‌ها)؛ صداها (playError شکست، playClick heart)؛ **فیکس level-up: `levelForScore` مشتق + `restartTimers` فقط در تغییر واقعی** (anchor: GamesPage ~221)؛ ثبت maxCombo/accuracy در `end()` |
| تست‌ها | رندر + گارد؛ سوئیت کامل سبز + tsc |
| خروجی فاز | DoD دستی: combo تا ×3 → کلید غلط → ریست → boss در level-up → heart جان بدهد → HUD acc → ماندگاری → بک‌آپ round-trip |
| کامیت | `feat(games): word-blast v2 combo/boss/heart HUD & level fix (idea G1, phase 2)` |
| برآورد | ۱-۲ روز |

---

## G2 — Bot Duel

### فاز G2.۱ — موتور خالص — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `e8d2442` — `utils/bot-duel/bot-pacer.ts` (نرخ ثابت `wpm×5×t/60000` — همان ریاضی pace-caret که لنگرش در `test/pace-caret.ts` تأیید شد؛ مرزهای کلمه با یک فاصله جداکننده per word؛ خروجی progressChars/wordIndex/finished + finishMs قطعی) و `duel-engine.ts` (فازهای ready/running/playerWon/botWon/draw؛ رویدادهای per-key و per-word؛ **مومنتوم کلیدمنیا: کلمهٔ بی‌نقص +۱ پله، هر کلید غلط صفر — پاداش فقط نمایشی روی delta در v1 طبق تصمیم خود سند**؛ دقت زنده؛ **عدالت زمانی: تکمیل بازیکن نمی‌تواند از باتی که دقیقاً زودتر خط را رد کرده جلو بزند — تساوی هم‌میلی‌ثانیه = draw**).
- **یافتهٔ تست:** تست‌ها دو حفرهٔ واقعی موتور را گرفتند و بسته شدند: (۱) ریست مومنتوم روی کلید غلط در char-branch جا افتاده بود، (۲) snapshot فیلدهای شمارنده را از بستارها بازسازی نمی‌کرد و delta لحظهٔ finish کهنه می‌ماند.
- **گیت:** ۱۱/۱۱ specهای bot-duel · سوئیت کامل **۱۹۷۸/۱۹۷۸** (+۱۱) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `utils/bot-duel/bot-pacer.ts` — `createBotPacer({wpm, words})` → `progressChars(elapsedMs)`, `wordIndex()`, `finished` (ریاضی `wpm×5×t/60000`، مرزها از طول کلمات — الگوی pace-caret). `utils/bot-duel/duel-engine.ts` — `createState({words, botWpm, budgetWords})` + `feed(playerEvent)` + `tick(elapsedMs)` → `{phase: countdown\|running\|playerWon\|botWon\|draw, playerWordIndex, botWordIndex, deltaChars, momentum, finishedAtMs, playerErrors, playerChars}` + BALANCE (momentsumBonusMode:"display" طبق سند — v1 بدون اثر مکانیکی) |
| تست‌ها | pacer: chars(t) دقیق (wpm 60 → 5 chars/s)، مرزها، finished. engine: برد/باخت/draw، momentum display-mode، دقت per-word، پایان فوری |
| خروجی فاز | دوئل headless قابل شبیه‌سازی |
| کامیت | `feat(games): bot-duel pure pacer & engine (idea G2, phase 1)` |
| برآورد | ۱-۲ روز |

### فاز G2.۲ — ماندگاری — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `090cdeb` — `utils/bot-duel/duel-store.ts` (الگوی کامل game-store: LocalStorageWithSchema + zod + `_reset`؛ `byTier` با سریع‌ترین برد per-tier و قانون «باخت هرگز finish نمی‌کارد»؛ history ≤10 با `result: won/lost/draw` — **غنی‌تر از sketch سند که boolean بود؛ draw خودش نتیجه است — تصمیم شورا، ثبت شد**؛ دقت درصدی) + فیلد بک‌آپ optional `botDuelStats` در local-persistence (۳ نقطه: interface، export، import با sanitizer الگوی audit-L4).
- **یافتهٔ تست:** round-trip به IndexedDB می‌رسد (exportBackup نتایج را می‌خواند) — spec با الگوی `fake-indexeddb/auto` + factory تازه per-test واکسینه شد (الگوی desktop-auto-backup.spec).
- **گیت:** ۱۶/۱۶ specهای bot-duel · سوئیت کامل **۱۹۸۳/۱۹۸۳** (+۵) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `utils/bot-duel/duel-store.ts` — `mtDesktopBotDuelStats`: `byTier: Record<"40"\|"60"\|"80"\|"100"\|"120"\|"140", {wins,losses,draws,bestFinishMs}>` + `history ≤10 {at, botWpm, words, won, finishMs, accuracy}`؛ فیلد بک‌آپ optional در local-persistence (غایب = حفظ) |
| تست‌ها | الگوی resetModules؛ byTier تجمیع؛ بک‌آپ round-trip |
| کامیت | `feat(games): bot-duel stats store & backup field (idea G2, phase 2)` |
| برآورد | ۱ روز |

### فاز G2.۳ — UI + مسیر — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `92c2a8b` (+ `47cf255` — دلتاهای cards.spec فاز ۶ که از کامیت فاز ۶ جا مانده بود) — `BotDuelPage.tsx`: picker (شش tier با برچسب endgame روی 140 + سه طول دور)، شمارش معکوس ۳-۲-۱ روی playTimeWarning، نمای دوئل (دو نوار پیشرفت بازیکن/بات با درصد بر مبنای word index، delta زنده با مومنتوم نمایشی، کلمهٔ جاری درشت با head رنگی و dir=auto، کلمهٔ جاری بات زیر نوارش)، blur حین شمارش/دوئل → void بدون ثبت (ضد تقلب)، overlay نتیجه (زمان/دقت/مومنتوم + rematch با همان کلمات + change race)؛ مسیر `/games/bot-duel` + کارت سوم هاب (توضیح بخش games به‌روز).
- **یافتهٔ تست:** تست انتگرالشن GamesPage که کلمهٔ اول DOM را تایپ می‌کرد با دو کلمه روی صفحه از انتخاب هندلر (شروع‌شده/پایین‌ترین) خارج می‌شد — typing به هدفِ خود هندلر سخت‌گیرانه شد (حلقهٔ boss پایدار ×۳ اجرا).
- **گیت:** ۱۷/۱۷ (۳ صفحه + ۱۴ گارد ساختار/picker) · سوئیت کامل **۱۹۸۷/۱۹۸۷** (+۴) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `components/pages/games/bot-duel/BotDuelPage.tsx` (picker tier/طول → countdown ۳-۲-۱ با timeWarning → دوئل → overlay نتیجه + rematch با همان seed کلمات)؛ `routes.ts` append `/games/bot-duel`؛ `constants/app-structure.ts` subsection سوم؛ blur حین دور → void بدون ثبت؛ RTL `dir="auto"` |
| تست‌ها | رندر page + گارد ساختار app-structure؛ سوئیت کامل |
| خروجی فاز | DoD دستی: برد tier 60 → باخت tier 100 → stats → بستن اپ حین دور → void |
| کامیت | `feat(games): bot-duel page, route & hub entry (idea G2, phase 3)` |
| برآورد | ۲ روز |

---

## G3 — Ghost GP (وابسته به فاز G2.۱)

### فاز G3.۱ — موتور خالص — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `f8ace32` — `utils/ghost-gp/ghost-source.ts` **خالص**: تماس‌گیرنده رکورد کاندید را می‌آورد (آخرین نتیجه از states/snapshot یا PB از getLocalPB با تطبیق ایدنتیتی) و ماژول validate می‌کند به constant ghost — سه دلیل شکست `no-result/wrong-language/invalid-wpm` (پیام UI فاز بعد: «اول یک تست بزن») · `gp-engine.ts` wrapper روی duel-engine (مکانیک مسابقه عمداً یکی — منحنی واقعی فاز G3.۳ اضافه می‌شود؛ heavy store اکنون موجود) · `gp-store.ts` (`mtDesktopGhostGpStats`: races/winsVsGhost/losses/**draws — افزودهٔ ثبت‌شدهٔ شورا چون sketch سند draw نداشت ولی موتور تولیدش می‌کند**/bestFinishMs = سریع‌ترین برد across ghosts/ghostsRaced ≤10) + فیلد بک‌آپ optional `ghostGpStats` با sanitizer الگوی audit-L4.
- **لنگر به‌روز:** تطبیق ایدنتیتی PB الان **شش‌فیلدی** است (پنج‌فیلد سند + هویت نقطه‌گذاری سفارشی Y5b) — matching همان‌جا (db) می‌ماند؛ source خالص فقط زبان/wpm را validate می‌کند.
- **گیت:** ۱۴/۱۴ specهای ghost-gp · سوئیت کامل **۲۰۰۱/۲۰۰۱** (+۱۴) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `utils/ghost-gp/ghost-source.ts` — `createGhost()`: v1 `{kind:"constant", wpm}` از Last Ghost (`getLastResult()`) یا PB (تطبیق ۵فیلدی db.ts:168-192؛ فقط mode/time+words) با validate `wpm>0`. `gp-engine.ts` — مثل duel-engine + داده strip. `gp-store.ts` — `mtDesktopGhostGpStats {races, winsVsGhost, losses, bestFinishMs, ghostsRaced ≤10}` + فیلد بک‌آپ optional |
| تست‌ها | ghost-source: نبود نتیجه → خطای واضح؛ تطبیق PB زبان. gp-engine: ثابت/برد/باخت/تساوی. store: الگوی استاندارد + بک‌آپ |
| کامیت | `feat(games): ghost-gp pure engine, source & store (idea G3, phase 1)` |
| برآورد | ۱-۲ روز |

### فاز G3.۲ — UI + مسیر — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `37afa56` — `GhostGpPage.tsx`: picker با **دو منبع روح** (last run با wpm زنده / personal best از getLocalPB با تطبیق ایدنتیتی برای mode جاری)، طول‌های 20/35/60، شمارش معکوس، و **strip مسابقهٔ سند**: دو نشانگر متحرک (fa-user بازیکن / fa-ghost روح با wpm و تاریخ رکورد) + delta زنده + کلمهٔ جاری درشت با head رنگی (dir=auto). **re-validate در شروع** (حذف رکورد بین پیکر و شروع → برگشت به پیکر با «run a test first»)؛ blur → void بدون ثبت؛ overlay نتیجه + پیشنهاد «type a new test to record a fresh ghost»؛ مسیر `/games/ghost-gp` + کارت چهارم هاب.
- **گیت:** ۱۸/۱۸ (۴ صفحه + ۱۴ گارد ساختار/picker — مقصد جدید در حلقهٔ destinations خودکار پوشیده شد) · سوئیت کامل **۲۰۰۶/۲۰۰۶** (+۵) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `GhostGpPage.tsx` (picker Last/PB + طول 20/35/60 → countdown → مسابقه → نتیجه + پیشنهاد «record new ghost?»)؛ strip مسابقه (دو نشانگر: بازیکن/روح `fa-ghost` با wpm و تاریخ)؛ delta زنده؛ route + subsection چهارم؛ هشدار «روح سریع‌تر از بهترین ران تو»؛ re-validate روح هنگام شروع (حذف نتیجه بین پیکر و شروع) |
| تست‌ها | رندر + گارد ساختار |
| DoD دستی | تست بزن → Last Ghost برد → PB Ghost باخت منطقی → stats ماندگار |
| کامیت | `feat(games): ghost-gp page, route & hub entry (idea G3, phase 2)` |
| برآورد | ۲ روز |

### فاز G3.۳ — روح منحنی واقعی (v2 سند) — ✅ **کامل شد 2026-11-07**
> **یادداشت شورا:** سند می‌گفت «v2 بعد از ایده #11» — #11 از 0.21.0 merge شده؛ پس این فاز اکنون در محدوده بود.
- **اجرا:** کامیت `ea769a8` — `utils/ghost-gp/curve-pacer.ts`: انباشت per-second (`burst[s]×5/60` کاراکتر در ثانیه s — قرارداد مونکایتایپ)، plateau با نرخ آخرین ثانیه past داده، finishMs داخل ثانیه‌ای که مرز را رد می‌کند interpolate می‌شود، همان شکل BotPacer · `ghost-source.ts`: union دوگانه (ConstantGhost/CurveGhost) + `curveGhostFromChartData` با کل ماتریس fallback سند (سطر استریپ‌شده/chartData "toolong"/burst کوتاه → constant از wpm نتیجه؛ ورودی‌های نامعتبر burst فیلتر) · **duel-engine: پذیرش pacer تزریقی اختیاری** (additive — پیش‌فرض همان بات ثابت) · `gp-engine`: پذیرش Ghost و تزریق curve-pacer برای curve · صفحه: در منبع last، heavy twin از `loadLocalHeavyResult(last._id)` خوانده و curve تلاش می‌شود؛ label strip با «(curve)».
- **گیت:** ۲۰۲۰/۲۰۲۰ (+۳۳: curve-pacer ۷، منبع ۵، تزریق ۱، gp-engine ۱، صفحه و IDB واکسیناسیون) · tsc صفر.
- **یادداشت:** تست UI سطح curve مستقیم نوشته نشد (نیاز به سطر heavy) — مسیر fallback در تست صفحهٔ موجود پوشیده است و curve در سطح موتور/pacer کامل تست شده.

---

## G5 — Ten-Second Sprint

### فاز G5.۱ — موتور خالص + آمار — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `16d5a33` — `utils/sprint/sprint-engine.ts`: فازهای idle/arming/running/done با ساعت تزریقی (هر جهش nowMs مطلق می‌گیرد — بدون نیاز به fake timer در تست)؛ goAt تصادفی ۸۰۰-۳۰۰۰ms از rng تزریقی؛ **کلید نویسه‌ای قبل GO = false start باطل فوری** (Backspace قبل GO نیست — فقط نویسه‌ها مهارت واکنش‌اند)؛ قفل در مرز duration؛ موتور بافر کلمهٔ واحد را خودش دارد (Backspace فقط buffer — «نویسه اصلاح‌شده = تایپ‌شده»)؛ متریک‌های دقیق سند: chars = کل نویسه‌ها (partial آخر هم)، wpm = chars/5/(duration/60000) (۸۵ → ۱۰۲)، raw = درست‌های لحظه‌ای، accuracy، keystrokeIntervals · `sprint-stats.ts`: bestByLang + history ≤20 + daily streak (اولین نتیجهٔ روزانهٔ روز streak را می‌سازد/ادامه می‌دهد، rerun همان‌روز فقط bestWpm را بالا می‌برد؛ dayKey الگوی daily-goal لوکال) + فیلد بک‌آپ optional `sprintStats` با sanitizer الگوی audit-L4.
- **گیت:** ۱۶/۱۶ specهای sprint · سوئیت کامل **۲۰۳۶/۲۰۳۶** (+۱۵) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `utils/sprint/sprint-engine.ts` — فازها `arming{goAt تصادفی 800-3000} → running{startedAt} → done`؛ `feedKeydown(nowMs, code)`: قبل GO نویسه → false start (void)؛ حین اسپرینت: نویسه/backspace؛ قفل در 10000ms؛ نتیجه `{wpm=chars/5/(10/60), raw=درست‌های لحظه‌ای, accuracy=درست/کل, chars, wordsComplete, keystrokeIntervals[]}` + BALANCE. `sprint-stats.ts` — `mtDesktopSprintStats {bestByLang, history ≤20, daily {dayKey, done, bestWpm, streak, maxStreak}}` + فیلد بک‌آپ optional |
| تست‌ها | fake timers: false start؛ شروع دقیق در goAt؛ قفل در 10000؛ partial آخر؛ متریک‌ها با داده ثابت (85 نویسه → 102 wpm)؛ streak روز جاافتاده |
| کامیت | `feat(games): sprint pure engine & stats (idea G5, phase 1)` |
| برآورد | ۱-۲ روز |

### فاز G5.۲ — UI + مسیر — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `e192194` — `SprintPage.tsx`: idle (حالت‌های free/daily sprint، best زبان، هشدار false start) → arming («wait for GO…» با هشدار ابطال) → running (**تایمر مونو ۲ اعشار + فلاش GO + بوق‌های ۳-۲-۱ در سه ثانیهٔ آخر** + کلمهٔ جاری درشت با head رنگی dir=auto + کلمهٔ بعدی + شمارنده‌های زنده) → نتیجه (متریک‌های سند + فلش مقایسهٔ best قبلی→جدید + خط streak روزانه)؛ false start → پیام سرخ و برگشت؛ blur → void با پیام خودش؛ **daily mode: reshuffle با LCG seeded از dayKey+language — helper محلی صفحه، بدون کوپلینگ بین‌بازی**؛ مسیر `/games/sprint` + کارت پنجم هاب.
- **باگ واقعی که تست صفحه گرفت:** tick-handler صفحه هرگز pagePhase را به running فلیپ نمی‌داد (موتور GO می‌رفت، UI تا ابد «wait for GO») — فلیپ + فلاش + بیک حالا فاز موتور را دنبال می‌کنند. ساعت تست: spy روی performance.now (ساعت صفحه) — بدون fake timer.
- **گیت:** ۴/۴ صفحه + گارد ۵-کارت هاب و حلقهٔ destinations · سوئیت کامل **۲۰۴۱/۲۰۴۱** · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `SprintPage.tsx` (فاز آماده‌باش/GO فلاش/اسپرینت با تایمر مونو ۲ اعشار + live WPM/نتیجه با مقایسه best)؛ Daily Sprint (seed روزانه الگوی G4)؛ blur حین اسپرینت → void با toast؛ صدا (3-2-1 timeWarning، GO playClick)؛ route + subsection پنجم |
| تست‌ها | رندر + گارد ساختار |
| DoD دستی | false start void → اسپرینت کامل → wpm دقیق → PB → Daily → streak → blur void |
| کامیت | `feat(games): sprint page, route & hub entry (idea G5, phase 2)` |
| برآورد | ۲ روز |

---

## G4 — Wordle روزانه (fa/en)

### فاز G4.۱ — موتور خالص + ذخیره — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `7e46028` — `utils/wordle/wordle-engine.ts`: `computeWordlePools` با قاعدهٔ انصاف سند (پاسخ‌ها = len5(۵k) ∩ len5(لیست حدس)، هر دو مرتب + فیلتر حرفی — ZWNJ/خط‌تیره/رقم excluded) · `pickAnswer` هش `dayKey+lang` روی pool مرتب (همان کلمه برای هر نصب در هر روز/زبان) · **`gradeGuess` دوفازی duplicate-safe** — greens مصرف می‌کنند، leftovers تا شمارش باقی yellow، وگرنه gray (با وکتورهای رسمی دست-تأیید: level/eeler، level/lllll، abble/bbsst) · `normalizeGuess` (strip ZWNJ/خط‌تیره + lowercase) · `buildShareGrid` · `wordle-store.ts`: state + stats **per-lang با کلیدهای جدا** (`_fa`/`_en`)، rollover روی dayKey جدید، `recordWordleGame` با معناشازی streak وردل (برد متوالی ادامه/شکاف یا باخت ریست؛ distribution فقط برد؛ باخت هرگز last-win day نمی‌کارد) · فیلدهای بک‌آپ optional `wordleState/wordleStats` (per-lang) با sanitizer.
- **یافتهٔ مهم:** `yesterdayKey` باید **UTC-خالص روی رشتهٔ dayKey** باشد — ساعت سیستم این ماشین از تقویم جلسه منحرف است و حساب local-Y-M-D مقایسهٔ streak را خم می‌کرد (2026-11-6 → دیروز 2026-10-5!). همچنین روزهای wordle **تقویم انسانی (ماه ۱-مبنا)** — فاز ۲ باید dayKey را با همان قرارداد بدهد.
- **گیت:** ۳۴/۳۴ specهای wordle (۲۰ فروشگاه + ۱۴ موتور) · سوئیت کامل **۲۰۶۱/۲۰۶۱** (+۲۰) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `utils/wordle/wordle-engine.ts` — `pickAnswer(pool, dayKey, lang)` seed قطعی روی pool مرتب‌شده؛ **پاسخ‌ها = len5(5k) ∩ len5(25k)** (پاسخ همیشه guessable)؛ `gradeGuess(answer, guess)` دوفازی duplicate-safe (green consumed → yellow per count → gray)؛ `isValidGuess` (لیست حدس 25k/20k؛ ZWNJ/hyphen → strip و تلاش)؛ `buildShareGrid` (emoji + `wordle-like #N fa 4/6`). `wordle-store.ts` — `mtDesktopWordleState` per-lang (ادامه پازل پس از بستن؛ dayKey جدید → ریست) + `mtDesktopWordleStats` per-lang (played/won/streak/maxStreak/distribution[6]/lastCompletedDay) + دو فیلد بک‌آپ optional |
| تست‌ها | gradeGuess کلاسیک duplicate (`level`/`eeler`)؛ pickAnswer seed ثابت + پایداری resetModules؛ streak/روز جاافتاده/distribution؛ normalize ZWNJ |
| کامیت | `feat(games): wordle pure engine & daily stores (idea G4, phase 1)` |
| برآورد | ۱-۲ روز |

### فاز G4.۲ — UI + مسیر — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `cae013e` — `WordlePage.tsx`: انتخاب زبان (fa/en، هر کدام state/stats/streak ایزوله)؛ **گرید ۶×۵ با reveal پلکانی** (transition-delay per column؛ سبز = main تم، زرد = طلایی inline تا فایل تم دست نخورد، خاکستری = sub)؛ **کیبورد مجازی per-letter** (بهترین state بر letter: green > yellow > gray؛ چیدمان فارسی = شبکهٔ ۳۲ حرفی با ردیف‌های RTL) + کیبورد فیزیکی؛ مسیر رد حدس («not in word list»)؛ پنل نتیجه (آمار + share با buildShareGrid → کلیپ‌بورد با fallback محترمانه + puzzle number از اپوک ماه launch)؛ مسیر `/games/wordle` + کارت ششم هاب. `wordleDayKey` به store منتقل و export شد (یک قرارداد برای صفحه و yesterdayKey).
- **گیت:** ۳۸/۳۸ wordle (spec صفحه: مسابقهٔ برد با بازسازی pick خالص روی لیست fallback، رد حدس ناموجود، ایزولاسیون زبان) · سوئیت کامل **۲۰۶۶/۲۰۶۶** (+۵) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `WordlePage.tsx` (انتخاب زبان؛ گرید ۶×۵ با flip CSS پلکانی؛ کیبورد فیزیکی + مجازی رنگی per-letter — QWERTY en / شبکه ۳۲ حرفی fa؛ فارسی RTL روی گرید و ردیف‌ها؛ share → کلیپ‌بورد؛ نتیجه برد/باخت + آمار)؛ route + subsection ششم |
| تست‌ها | رندر + گارد ساختار |
| DoD دستی | برد فارسی → share در کلیپ‌بورد → streak ۱ → تغییر ساعت → پازل جدید → برد → streak ۲ → باخت → distribution ۶ → بستن وسط پازل → ادامه |
| کامیت | `feat(games): wordle page, route & hub entry (idea G4, phase 2)` |
| برآورد | ۲-۳ روز |

---

## G6 — Balloon Pop SRS

### فاز G6.۱ — موتور خالص — ✅ **کامل شد 2026-11-07**
- **اجرا:** کامیت `b87ffe7` — `utils/balloon-pop/balance.ts` (همه اعداد: آرنای ۱۰۰→۶vh، پله‌های کمبو ×1/1.5/2/3، آستانه‌های stage-clear در stage×۱۵۰۰، سرعت‌ها و cadence اسپاون per stage، شانس‌های نقطه‌گذاری/عدد stage 4، جان ۳ سقف ۵) · `spawner.ts` **خالص با rng تزریقی**: stage 1 حروف مجاز تزریقی با وزن `weakness[c]?.score ?? 1` (بدون شواهد → یکنواخت؛ مدل #۷ اکنون موجود)، stage 2 حرف/کلمهٔ کوتاه، stage 3 واژگان ۳-۸ zipf-lite، stage 4 نقطه‌گذاری سند یا عدد ۴رقمی؛ سرعت per stage/level · `engine.ts`: حباب‌ها از ۱۰۰ به خط ۶vh صعود، فرار = جان−۱ + شکست کمبو، stage 1 پاپ هر حبابِ حرفی نزدیک‌ترین به top، stage 2+ هدف started-else-most-risen (الگوی Word Blast)، ارتقای stage در آستانه‌های تجمعی، سقف میدان ۸ با cadence سند، pause فیزیک را می‌خواباند (ضد مرگ ناعادلانه)، پایان با نتیجه — **v1 هیچ نوشتنی به learn-state ندارد** · `store.ts` (best per-stage + history ≤10 + sanitizer) + فیلد بک‌آپ `balloonPopScores`.
- **یافتهٔ تست:** round-trip بک‌آپ دو نقطهٔ جامانده را گرفت — خط کلید + بلوک import/sanitize در local-persistence (interface و export线路 اضافه شده بود ولی بلوک import نه) — هر دو بسته شدند.
- **گیت:** ۲۲/۲۲ specهای balloon-pop · سوئیت کامل **۲۰۸۸/۲۰۸۸** (+۲۲) · tsc صفر.
| مورد | شرح |
|---|---|
| فایل‌ها | `utils/balloon-pop/spawner.ts` — `createSpawner({stage, level, letters, weakness?, rng})`: حروف از گروه‌های unlockشده learn-stats؛ وزن `P(letter) ∝ weaknessMap[c] ?? 1` (مدل ایده #7 **اکنون موجود** — feature-check)؛ کلمات zipf-lite؛ سرعت per stage/level (BALANCE). `engine.ts` — حباب `{id, payload, y:100→6vh, speed, popped}`؛ pop: stage1 حرفی exact-any (نزدیک‌ترین به top)؛ stage2+ started-or-lowest (قرینه Word Blast معکوس)؛ escape → lives−1 + شکست combo؛ stage-up در `STAGE_CLEAR_SCORE`؛ پایان lives=0. `scoring.ts` — پله‌های محلی G1-الگو + stage bonus. `store.ts` — `mtDesktopBalloonPopScores {bestByStage 1..4, history ≤10}` + فیلد بک‌آپ optional |
| تست‌ها | spawner: وزن‌دهی ۲۰۰-نمونه (ضعیف غالب)؛ یکنواخت بدون weakness؛ rng قطعی. engine: pop حرفی/کلمه‌ای؛ escape؛ stage-up؛ پایان. store: استاندارد + بک‌آپ |
| قاعده سند | **v1 هیچ نوشتنی به learn-state (SM-2) ندارد** |
| کامیت | `feat(games): balloon-pop pure engine, spawner & store (idea G6, phase 1)` |
| برآورد | ۲ روز |

### فاز G6.۲ + G6.۳ — آرنا/UI + TTS «hear it» — ✅ **کامل شد 2026-11-07 (کامیت ادغامی)**
- **اجرا:** کامیت `7bfb8e5` (فازهای ۲+۳ در یک کامیت — دلیل: یک amend اشتباه تاریخچه را مخلوط کرد؛ ترمیم با soft-reset به والد و ادغام، به‌جای یک کامیت میانیِ قرمز) — `BalloonPopPage.tsx`: menu (زبان fa/en، دکمه‌های stage 1-4، خط bests، **toggle «hear it»**) → آرنا (حباب‌ها = دایره‌های CSS خالص صعودی top-based بدون canvas، **خط خطر خط‌چین در بالا**، **slot-based spawn روی ۸ ستون بدون تکرار ستون اخیر** — بهبود سند نسبت به Word Blast) → HUD (stage/level/score/combo/lives) + بنر stage-up · **blur فیزیک را می‌خواباند، focus ادامه** (ضد مرگ ناعادلانه سند) · پایان ران → ثبت best/history → نتیجه با «continue at stage» و برگشت به منو؛ مسیر `/games/balloon-pop` + کارت هفتم هاب.
- **فاز ۳ (hear-it):** toggle در منو → هر حباب تازه به‌محض اسپاون با wrapper فورک #۱۲ (`speakWord` — degrade محترمانه بی‌صدا) خوانده می‌شود؛ نشانه‌گذاری idمحور در tick؛ **کاهش cadence**: `BALANCE.hearItSpawnExtraMs = 800` + گزینهٔ `spawnExtraMs` در engine (additive — پیش‌فرض cadence ساده)؛ علامت نقطه‌گذاری stage-4 قبل از گفتن strip می‌شود.
- **دو باگ واقعی که تست‌ها گرفتند:** (۱) tick موتور sprint هرگز arming→running را در لحظهٔ GO فلیپ نمی‌کرد (فقط feedKey شروع می‌کرد) → بازیکن بی‌کار تا ابد «wait for GO» — فیکس + کامیت فالو-آپ `19b0f61` (G5)؛ (۲) بلوک import/sanitize بک‌آپ balloon در local-persistence جامانده بود (interface و export اضافه بود ولی بلوک import نه) — بسته شد.
- **گیت:** ۲۲/۲۲ balloon + ۴/۴ صفحه + گارد ۷-کارت هاب و حلقهٔ destinations · سوئیت کامل **۲۰۹۶/۲۰۹۶** (+۵) · tsc صفر.

## اقدام بعدی

**همهٔ ۱۵ فاز G1–G6 کامل شد** — سوئیت ۲۰۹۶/۲۰۹۶ + tsc صفر + `npm run build` سبز (در جلسهٔ KI-28). باقی: میزبانی گیت‌هاب آپدیتر (منتظر یوزرنیم/ریپوی مالک) و بیلد 0.24. شروع هر کار جدید فقط با دستور صریح مالک.
