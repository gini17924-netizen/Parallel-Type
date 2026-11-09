# فازبندی اجرای بازی‌های G8 تا G23 — سند مراحل به ترتیب اجرا

> **تاریخ:** 2026-11-07 | **مبنای تصمیم:** بررسی شورا (`COUNCIL_GAME_PHASES_G8_G23_2026-11-07.md`... مرجع درست: `COUNCIL_GAME_IDEAS_G8_G23_2026-11-07.md`) + تأیید مالک هر ۴ تصمیم §۶
> **تصمیم‌های قطعی‌شده با تأیید مالک:** ترتیب خوشه‌ها A→H مطابق شورا · G20 با LRC در v1 · G13 و G15 هر کدام دو-سه فاز · بازی‌های راه‌انداز گانتلت = word-blast + sprint + bot-duel (بدون wordle)
> **مخزن:** `monkeytype/monkeytype-master` @ `ce1d3f1+` — **هر فاز = کامیت(های) conventional جدا + سوئیت کامل سبز + tsc صفر پیش از کامیت.** `npm run build` سرتاسری در فاز پایانی هر خوشه.
> **قواعد مشترک همه فازها (از سندهای ایده + الگوی G1–G6):**
> - صفر تغییر در فایل‌های منطقی آپ‌استریم؛ فقط additive (route/subSection/بک‌آپ)
> - موتور خالص در `utils/<game>/` با rng تزریقی؛ BALANCE یک‌فایلی؛ صفحه فقط اتصال
> - store: الگوی `word-blast-scores` (LocalStorageWithSchema) + فیلد بک‌آپ optional (absent = keep، بدون bump)
> - ورودی: window keydown الگوی GamesPage؛ listener صفحه‌محور با onCleanup؛ blur → pause (الگوی G6)
> - ثبت در `releases/README.md` هنگام بیلد؛ **anchorهای سندهای ایده قبل از ویرایش بازچک شوند** (خط‌ها ممکن است جابه‌جا شده باشند)
> - INF-1 ساخته نمی‌شود (F6) — captureهای خاص هر بازی صفحه‌محور است
> - **تعداد کارت هاب** بعد از هر فاز «route+hub» در پرانتز آمده (الان ۷)

---

## خوشه A — سقوط/شلیک (نزدیک Word Blast)

### فاز A.۱ — G8 Letter Strike: موتور خالص — ✅ **کامل شد 2026-11-07**
- `utils/letter-strike/`: `engine.ts` ( createState({waves, lives=3}) — قفل پیشوندی نزدیک‌ترین سفینه، Backspace آزادسازی، Boss armor دو-pass هر ۴ موج، EMP با Space شارژ هر ۳ موج، comboBreak در فرار)، `spawner.ts` (موج پلکانی 4→14، فیلتر کلمات نماددار برای code_*)، `store.ts` (`mtDesktopLetterStrikeScores` {bestScore, bestWave, history≤10})
- تست‌ها: قفل/هم‌پیشوند/Backspace؛ armor دو-passage؛ EMP بدون امتیاز + شارژ؛ escape→جان+comboBreak؛ قطعیت spawner
- گیت: سوئیت کامل + tsc

### فاز A.۲ — G8: صفحه + مسیر + هاب (۸ کارت) — ✅ **کامل شد 2026-11-07**
- `LetterStrikePage.tsx`: سفینه = div + کلمه دو-span (prefix main)؛ قفل=حاشیه؛ خط شلیک فلاش ۱۰۰ms؛ HUD موج/جان/EMP/combo؛ **capture صفحه‌محور Space و Escape حین running (Escape با stopPropagation — بدون INF-1)**؛ dir="auto"
- route `/games/letter-strike` + subSection + بج best؛ فیلد بک‌آپ `letterStrikeScores` با sanitizer الگوی audit-L4
- DoD سند: قفل/شلیک/انفجار → boss موج ۴ → EMP → فرار → best ماندگار → Esc کامندلاین باز نکند → خروج صفحه پاکسازی → سوئیت سبز

### فاز A.۳ — G9 Lane Defense: موتور خالص — ✅ **کامل شد 2026-11-07**
- `utils/lane-defense/`: `engine.ts` (۵ لِین، دیوار ۱۰ + ترمیم +۲/موج، tank هر ۳ موج ۳×، minGap لِین)، zone-filtered spawner از `ENGLISH_GROUPS/PERSIAN_GROUPS` (read-only؛ fallback کلمات کوتاه)، `store.ts` (`mtDesktopLaneDefenseScores` {bestWave, bestScore, byZone, history≤10})
- تست‌ها: zone-filter کامل؛ هدف‌گیری started-else-near؛ نفوذ دیوار؛ tank؛ seed قطعی
- گیت: سوئیت + tsc

### فاز A.۴ — G9: صفحه + مسیر + هاب (۹ کارت) — ✅ **کامل شد 2026-11-07**
- `LaneDefensePage.tsx`: گرید ۵ لِین + ستون دیوار با سلامتی؛ دشمن سرخ + prefix؛ فلاش شلیک ۱۲۰ms؛ انتخاب keyboard zone قبل شروع؛ حرکت راست→چپ ثابت (هر دو زبان)
- route + hub + بک‌آپ `laneDefenseScores`
- DoD سند: zone fj → فقط کلمات fj → tank → نفوذ → باخت دیوار صفر → best ماندگار → سوئیت سبز

### فاز A.۵ — G10 Fruit Slash: موتور خالص — ✅ **کامل شد 2026-11-07** (تست‌ها یک باگ بالانس گرفتند: نیم‌عمر بمب ۲s > زمان پروندهٔ مفید ~۱.۸۵s → ۱۲۰۰ms)
- `utils/fruit-slash/`: `physics.ts` (step قوسی + apexTime برای بونس ±۱۵۰ms)، `engine.ts` (durationMs=۹۰۰۰۰؛ تطبیق چندکلمه‌ای با per-fruit partial؛ partial reset با کلید غلط؛ بمب کامل → جان−؛ بمب partial نیم‌عمر ۲s؛ هم‌زمان ≤۳)، `store.ts` (`mtDesktopFruitSlashScores`)
- تست‌ها: apex در vy0/g؛ چند-partial هم‌پیشوند؛ بمب→جان−؛ نیم‌عمر؛ پایان ۹۰s با fake timers
- گیت: سوئیت + tsc

### فاز A.۶ — G10: صفحه + مسیر + هاب (۱۰ کارت) — ✅ **کامل شد 2026-11-07 — خوشه A بسته شد (G8، G9، G10 کامل)**
- `FruitSlashPage.tsx`: میوه دایره + برش دو-نیمه (کلاس cut) + بمب سرخ فتیله؛ HUD زمان/امتیاز/combo/جان؛ tick 30ms (بدون rAF الزامی)
- route + hub + بک‌آپ `fruitSlashScores`
- DoD سند: برش اوج-بونس → combo ×2 → بمب عمدی → جان− → پایان ۹۰s → رکورد → سوئیت سبز

---

## خوشه B — گریدها

### فاز B.۱ — G12 Stack Attack: موتور خالص — ✅ **کامل شد 2026-11-07**
- `utils/stack-attack/`: `grid.ts` (place/collision/clearFullRows چندسطر + shift-down با حفظ wordId)، `engine.ts` (سقوط گام‌سلولی dropInterval کاهشی؛ قفل؛ gameover-top؛ moveCol با گارد تداخل؛ بلوک ۳..۶)، `store.ts` (`mtDesktopStackAttackScores`)
- تست‌ها: grid.spec (place/دو-سطر/shift)؛ engine.spec (قفل/top/arrow-blok/level-up هر ۵ سطر)
- گیت: سوئیت + tsc

### فاز B.۲ — G12: صفحه + مسیر + هاب (۱۱ کارت) — ✅ **کامل شد 2026-11-07**
- `StackAttackPage.tsx`: گرید 10×14 سلولی + ghost ستون + بلوک کلمه (فارسی: کلمه joined واحد + تایپ ترتیبی — الگوی Word Blast dir="auto")؛ **swallow Arrowها حین running**
- route + hub + بک‌آپ `stackAttackScores`
- DoD سند: ۵ سطر → level-up → gameover عمدی → arrowها اپ را عوض نکنند → سوئیت سبز

### فاز B.۳ — G11 Type Snake: موتور خالص — ✅ **کامل شد 2026-11-07**
- `utils/type-snake/`: `grid.ts` (24×18، برخورد)، `steer.ts` (منهتن + ترتیب ثابت dx→dy + پرهیز برخورد + fallback فضای باز)، `engine.ts` (مار خودران به سمت غذا؛ تایپ کلمه غذا = خوردن؛ ×1.1 سرعت هر ۵ غذا؛ کلمات ۲-۳ حرفی)، `store.ts` (`mtDesktopTypeSnakeScores`)
- تست‌ها: steer.spec (مسیر/پرهیز/fallback)؛ engine.spec (خوردن/غلط بی‌اثر/مرگ فقط بی‌راهی/سرعت)
- گیت: سوئیت + tsc

### فاز B.۴ — G11: صفحه + مسیر + هاب (۱۲ کارت) — ✅ **کامل شد 2026-11-07** (یک باگ واقعی صفحه گرفت و فیکس شد: TICK_MS تعریف نشده بود — هر tick با ReferenceError بی‌صدا می‌مرد و مار روی صفحه منجمد می‌شد؛ تایپ کار می‌کرد چون از مسیر keydown مستقل بود)
- `TypeSnakePage.tsx`: گرید سلولی ۲۲px؛ مار گرادیان طولی؛ غذا با کلمه (prefix main)؛ HUD طول/امتیاز/سرعت
- route + hub + بک‌آپ `typeSnakeScores`
- DoD سند: ۵ غذا → مرگ عمدی با طول → رکورد → سوئیت سبز

### فاز B.۵ — G16 Firefight: موتور خالص — ✅ **کامل شد 2026-11-07** (تست‌ها یک باگ واقعی گرفتند: snapshotWith مقدار `result: undefined` را هاردکد کرده بود — اولین state() بعد از پایان دور، نتیجه را پاک می‌کرد؛ الگوی درست بقیهٔ موتورها: result داخل snapshot محاسبه شود + یک باگ JS کلاسیک دیگر: شورت‌هند `elapsedMs,` در return آبجکت sim کپیِ لحظهٔ ساخت بود نه اتصال زنده → getter)
- `utils/firefight/`: `sim.ts` (گسترش per-spreadInterval 6s→2.5s؛ ashes پس از burnDuration 12s؛ neighbors)، `engine.ts` (تک‌شلنگ: فعال = حیاتی‌ترین سلول در حال سوختن؛ extinguish؛ partial-shift؛ برد=بقای ۱۲۰s با <۳۵٪ ashes)، weakness گیت‌دار برای سلول‌های حیاتی، `store.ts` (`mtDesktopFirefightScores`)
- تست‌ها: sim.spec (گسترش/ashes/نسبت)؛ engine.spec (انتخاب حیاتی‌ترین/partial-shift/آستانه باخت)
- گیت: سوئیت + tsc

### فاز B.۶ — G16: صفحه + مسیر + هاب (۱۳ کارت) — ✅ **کامل شد 2026-11-07 — خوشه B بسته شد (G12، G11، G16 کامل)**
- `FirefightPage.tsx`: گرید 12×9 رنگ حالت‌ها + کلمه سلول فعال درشت زیر گرید + HUD زمان/درصد سوخته
- route + hub + بک‌آپ `firefightScores`
- DoD سند: بقا ۱۲۰s → برد → باخت با بی‌عملی → رکورد → سوئیت سبز

---

## خوشه C — فیزیک/مسابقه

### فاز C.۱ — G23 Nitro Run: موتور خالص — ✅ **کامل شد 2026-11-07**
- `utils/nitro-run/`: `racers.ts` (AI pacer الگوی G2 + checkpoint هر ۵۰۰m ×1.05)، `player.ts` (progress فقط با کلمات درست؛ spin-out 0.5s با کلید غلط؛ نیترو: استریک ۵ = شارژ، سقف ۳، مصرف Enter = ×۲ تا ۳s)، `engine.ts` (gap > D_max → gameover؛ rank)، `store.ts` (`mtDesktopNitroRunStats`)
- تست‌ها: racers/player/engine طبق سند (نیترو شارژ/سقف/×۲؛ gap؛ rank؛ checkpoint)
- گیت: سوئیت + tsc

### فاز C.۲ — G23: صفحه + مسیر + هاب (۱۴ کارت) — ✅ **کامل شد 2026-11-07**
- `NitroRunPage.tsx`: نمای بالا ۳ لِین؛ ماشین CSS خالص + سایه؛ استریم کلمات وسط (الگوی G2)؛ HUD distance/rank/nitro pills؛ **swallow Enter حین running**؛ spin-out فلاش+لرزش
- route + hub + بک‌آپ `nitroRunStats`
- DoD سند: نیترو ×۲ → checkpoint دوم → rank → gameover gap → رکورد → سوئیت سبز

### فاز C.۳ — G13 Type Pong: فیزیک توپ + موتور مود A — ✅ **کامل شد 2026-11-07** (یک باگ واقعی گرفت: کلمه دوبار در ساخت موتور مصرف می‌شد — کلمهٔ serve دومی در استریم بود و همهٔ کلیدها بی‌اثر)
- `utils/type-pong/`: `ball.ts` (بازتاب + jitter ±۲٪ ضد ping-pong بی‌نهایت + سقف سرعت + enforce |vx|)، `pong.ts` (paddle بازیکن = lerp با progress تایپ؛ AI tracking سقف‌دار per tier؛ برد ۵)، `store.ts` (`mtDesktopTypePongScores` {pong, breaker, history})
- تست‌ها: ball/pong طبق سند (lerp؛ امتیاز؛ serve زاویه)
- گیت: سوئیت + tsc

### فاز C.۴ — G13: صفحه مود Pong + مسیر + هاب (۱۵ کارت) — ✅ **کامل شد 2026-11-07**
- `TypePongPage.tsx`: انتخاب مود (فعلاً فقط Pong فعال — دکمه Breaker در فاز C.۵)؛ زمین نسبی + توپ/راکت DOM + word prompt درشت
- route + hub + بک‌آپ `typePongScores`
- DoD سند (بخش A): برد مقابل tier 60 → رکورد → سوئیت سبز

### فاز C.۵ — G13: مود Brick Breaker — ✅ **کامل شد 2026-11-07 — خوشه C بسته شد (G23، G13 کامل)** (صفحه بازطراحی شد: دو signal جدا برای pong/breaker + رندر شرطی per-mode + درس KI-34 چهارمین بار در WordDisplay — کامپوننت Solid signal ها را در بدنه می‌گیرد)
- `breaker.ts` (گرید ۵×۸، AABB، hp دو-ضربه با کلمات بلند، شکست word-first نزدیک راکت، جان ۳، رگبار +۸٪) + UI مود B + گیت‌ها
- DoD سند (بخش B): برد پاک‌سازی → باخت جان‌ها → رکورد → سوئیت سبز

---

## خوشه D — دقت زمانی/ریتم

### فاز D.۱ — G17 Crane Stack: موتور خالص ✅ (۲۰۲۶-۱۱-۰۷)
- `utils/crane/`: `balance.ts`، `engine.ts` (x پینگ-پنگ سرعت per-level؛ release در آخرین کلید؛ کیفیت ±۴/±۱۰/±۲۰٪ → ۳۰۰/۱۵۰/۵۰؛ ۳ Miss باخت؛ Miss طبقه اضافه نمی‌کند؛ zone جابجایی seed-دار؛ `_setCraneXForTests`)، `store.ts` (`mtDesktopCraneScores` + sanitize L4)
- تست‌ها: ۷ تست engine + ۵ تست store = ۱۲ ✓ (توالی از seqFor تزریقی — صفحه در D.۲ از letters ضعیف می‌سازد)
- تست‌ها: sequence/engine طبق سند (ping-pong؛ محدوده کیفیت؛ ۳ Miss؛ partial reset؛ blur→pause)
- گیت: سوئیت + tsc

### فاز D.۲ — G17: صفحه + مسیر + هاب (۱۶ کارت) ✅ (۲۰۲۶-۱۱-۰۷)
- `CranePage.tsx`: قلاب+زنجیر+جعبه معلق (توالی با partial)؛ نوار zone سه‌رنگ؛ برج سگمنتی واقعی از xها؛ fall animation با tilt؛ blur→pause badge (الگوی G6)؛ tick ۳۰ms طبق سند
- route + hub + بک‌آپ `craneScores` + **فیکس باگ فازهای قبل: ۵ فیلد بک‌آپ (stackAttack/typeSnake/firefight/nitroRun/typePong) export می‌شدند ولی import نمی‌شدند — بلاک sanitize L4 شان اضافه شد**
- تست‌ها: ۵ تست صفحه ✓ (menu/arena/partial reset/release fall/blur pause)

### فاز D.۳ — G21 Beat Keys: موتور خالص ✅ (۲۰۲۶-۱۱-۰۷)
- `utils/beat-keys/`: `balance.ts` (پنجره‌ها ۸۰/۱۶۰/۳۰۰؛ امتیاز ۳۰۰/۱۵۰/۵۰؛ rank S/A/B/C؛ scheduler 25ms/lookahead 100ms)، `chart.ts` (BPM ثابت 70/100/130؛ beat→ms؛ پترن ۴گانه seed-دار؛ بدون دو note هم‌key هم‌پنجره؛ lead-in ۴ بیت)، `metronome.ts` (oscillator خالص، lookahead استاندارد، schedulePass عمومی برای تست)، `engine.ts` (ساعت تزریقی ms — صفحه audioCtx می‌گذارد؛ offset کالیبراسیون روی تایم‌لاین judge؛ nearest unjudged same-key؛ auto-miss lazy در state؛ visibleNotes فقط نزدیک‌ها)، `store.ts` (`mtDesktopBeatKeysScores` {bestByBpm, history10, settings.offsetMs ±۳۰۰} + sanitize L4)
- تست‌ها: ۲۳ = chart ۵ + engine ۹ + metronome ۳ + store ۶ ✓ (مرزهای ۸۰/۱۶۰/۳۰۰، offset، rank، no-op خارج پنجره طبق §۰.۷)
- ⚠️ v1 لاتین-only (کلیدهای lane: d/f/j/k) — فارسی v2 (ثبت صادقانه سند)

### فاز D.۴ — G21: صفحه + مسیر + هاب (۱۷ کارت) ✅ (۲۰۲۶-۱۱-۰۷)
- `BeatKeysPage.tsx`: setup (سه difficulty + best/rank/offset) + کالیبراسیون «۸ ضربه روی بیت» (میانگین، تپ‌های >۳۰۰ms نادیده)؛ ۴ لِین + hit line + notes با مپ خطی فاصله→موقعیت + grade popup لاین‌دار (engine `lastLane` اضافه شد)؛ visibilitychange → void دور بدون ثبت (§۵)؛ audioCtx singleton lazy با fallback بی‌صدا برای تست؛ tick ۱۶ms
- route + hub + بک‌آپ `beatKeysScores` (sanitize L4)
- تست‌ها: ۶ تست صفحه ✓ (setup/lanes+notes/judge scoring/auto-miss/void/calibration)
- route + hub + بک‌آپ `beatKeysScores`
- DoD سند: کالیبراسیون → BPM 100 → rank A → رکورد → سوئیت سبز

---

## خوشه E — ورودی ویژه/چندنفره

### فاز E.۱ — G18 Pair Keys: موتور خالص ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/pair-keys/`: `balance.ts` (مودها/امتیاز ۱۰۰−۱۰·حرکت اضافه با کف ۲۰/بونس پرفکت ×۲/preview سطح ۱ = ۲s/غیرچسبان‌ها)، `forms.ts` (ZWJ با escape صریح `\u200D` — ابتدا ZWNJ اشتباه نوشته شده بود، فیکس شد)، `board.ts` (shuffle قطعی Fisher-Yates؛ form-name فقط چسبان‌ها؛ هر جفت = یک کارت form + یک کارت base)، `engine.ts` (flip/resolve؛ mismatch pending تا resolve صفحه بعد از ۷۰۰ms؛ preview lazy؛ clock از اولین flip)، `store.ts` (`mtDesktopPairKeysStats` bestByMode+games+history10 + sanitize L4)
- تست‌ها: ۲۱ = forms ۴ + board ۴ + engine ۸ + store ۵ ✓

### فاز E.۲ — G18: صفحه + مسیر + هاب (۱۸ کارت) ✅ (۲۰۲۶-۱۱-۰۸)
- `PairKeysPage.tsx`: گرید ۴×۴ flip سه‌بعدی CSS (rotateY + backface-visibility)؛ دو مود (letter forms / letters) + دو سطح (preview ۲s / blind)؛ پشت کارت = پترن ◆، روی کارت = نویسه با فونت «Noto Naskh Arabic» (باندل موجود)؛ matched = سبز؛ mismatch تایمر ۷۰۰ms با صفحه؛ کلیک + arrow/Enter (a11y)؛ letters از unlocked groups (read-only) با fallback چسبان‌ها
- **KI-34 پنجمین باریت**: `const face` در بدنه For قفل می‌شد → `faceOf(id)` تابع inline
- **باگ Showهای برعکس**: outer `when === "playing"` باعث می‌شد result به منو برگردد → الگوی استاندارد (outer ≠setup، inner ===playing)
- route + hub + بک‌آپ `pairKeysStats` (sanitize L4)
- تست‌ها: ۶ تست صفحه ✓ (setup/preview/match/mismatch/form-pair/full-run+record)

### فاز E.۳ — G19 Split-Key Showdown: موتور خالص ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/split-duel/`: `balance.ts` (countdown ۳s/طول ۲۰/مرز نزدیک ۵۰۰ms)، `sides.ts` (جدول صریح LEFT ۲۴/RIGHT ۵۱ code + sideOf با sideless؛ Space/Enter→RIGHT)، `engine.ts` (استریم تایپی خالص — ساعت تزریفی، partial reset، acc کلیدها)، `match.ts` (countdown گیت‌دار؛ مود turn: swapTo(2, now) → running + start P2؛ مود simultaneous: route per side؛ برنده زمان + tiebreak دقت + margin)، `store.ts` (`mtDesktopDuelLocalStats` winsBySlot+matches+history10 + sanitize L4)
- تست‌ها: ۱۵ = sides ۵ (با Record<Keycode,true> برای پوشش اجباری tsc) + match ۶ + store ۴ ✓
- **باگ فیکس‌شده**: swapTo فقط activeSlot عوض می‌کرد — حالا فاز running و start P2 را هم انجام می‌دهد

### فاز E.۴ — G19: صفحه + مسیر + هاب (۱۹ کارت) ✅ (۲۰۲۶-۱۱-۰۸)
- `SplitDuelPage.tsx`: setup (نام‌ها، مود A/B، طول ۱۰/۲۰/۳۰) + countdown ۳-۲-۱ گیت‌دار؛ مود A: استریم یکسان + overlay «P2, ready?» + arena بازیکن فعال؛ مود B: دو arena هم‌زمان + کیبورد مجازی رنگ نیمه‌ها؛ نتیجه مقایسه (margin + close match)؛ Esc سالم بدون ثبت
- **تصمیم طراحی (انحراف آگاهانه از سند):** استریم‌های مود B یکسان نیستند — هر نیمه از حروف همان نیمه ساخته می‌شود (`generatePseudoWords` چپ/راست + تعداد برابر برای انصاف)؛ چون بازیکن فقط کلیدهای نیمهٔ خودش را دارد و استریم مشترک مختلط هر دو را گیر می‌انداخت. match.ts به `words: [p1, p2]` تغییر کرد (مود A همان آرایه را دوبار می‌دهد)
- باگ‌های صفحه: بعد از begin فاز صفحه playing نمی‌شد؛ کیبورد مجازی/تایپ اسلات ۲ در مود A غایب بود
- route + hub + بک‌آپ `duelLocalStats` (sanitize L4)
- تست‌ها: ۵ تست صفحه ✓ (setup/routing per side/turn-swap full flow/Esc/countdown)

---

## خوشه F — حرکت/جهت

### فاز F.۱ — G14 Maze Runner: موتور خالص ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/maze-runner/`: `balance.ts` (ابعاد سه سطح/پاژه هر ۴ سلول/طول کلمه per level/جریمه ۲۰۰ms/par ۴۰۰ms per char/بونوس بدون‌خطا ۱۵۰۰/سرعت قدم ۹۰ms/braid ۰.۲۵/minTurns ۶)، `maze.ts` (backtracker بازگشتی seed-دار با دیوارهای v/h کانونی + braid حلقه‌ساز)، `solver.ts` (BFS؛ countTurns با مقایسه جهت گام‌ها؛ placeGates هر k؛ gateWordPicker با shuffle قطعی و cycle؛ buildTwistyMaze تا minTurns)، `engine.ts` (قدم خودکار روی مسیر BFS؛ توقف روی پاژه بسته؛ کلید غلط = جریمه فقط + partial حفظ طبق §۰.۵؛ امتیاز max(0, par×2−time)+بونوس؛ ساعت نسبی تزریقی)، `store.ts` (`mtDesktopMazeScores` bestTimeByLevel+noErrorRuns+history10 + sanitize L4)
- تست‌ها: ۲۱ = maze ۵ + solver ۴ + engine ۷ + store ۵ ✓ (اتصال BFS روی ۵ seed×۲ ابعاد؛ پاژه روی مسیر؛ partial حفظ؛ کف صفر امتیاز)

### فاز F.۲ — G14: صفحه + مسیر + هاب (۲۰ کارت) ✅ (۲۰۲۶-۱۱-۰۸)
- `MazeRunnerPage.tsx`: هزارتو inline-grid (دیوار=border per cell از walls کانونی)؛ پاژه روی سلول (کلمه + نوار partial + قرمز→سبز باز)؛ رانر دایره لغزنده (transition ۹۰ms)؛ مینی‌مپ ۴× با مسیر پیموده‌شده؛ پنل کلمه فعال بزرگ (data-word برای تست)؛ HUD زمان(+جریمه)/par/penalty/errors؛ کلمات از language + fallback؛ tick ۵۰ms با ساعت نسبی
- route + hub + بک‌آپ `mazeScores` (sanitize L4)
- تست‌ها: ۵ تست صفحه ✓ (menu/grid+gates+runner/open gate/wrong key/full run+record)

### فاز F.۳ — G15 Sky Climber: موتور + store دوتایی ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/climber/`: `balance.ts` (تایمر ۸s→۴s با decay ۱۰۰ms/پلتفرم، ۲ سقوط متوالی = مرگ، +۱۰×stage، stage هر ۱۵)، `gen.ts` (makePlatform با wordFor تزریقی + timerFor با کف + stageOf)، `engine.ts` (تک-sقوط-per-tick؛ سقوط: کلمه و partial زنده می‌مانند + تایمر تازه (grace)؛ کلید غلط = partial reset بدون سقوط؛ کف = مرگ؛ ژنراتوری بی‌نهایت با Map lazy)، `store.ts` (`mtDesktopSkyScores` دو namespace climber/runner در یک کلید + recordRunnerRun آماده برای F.۵ + sanitize L4 با گارد منفی)
- کلمات ضعیف stage≥2 با ۳۰٪: تزریقی wordFor — صفحه در F.۴ مخلوط می‌کند (read-only)
- تست‌ها: ۱۸ = gen ۴ + engine ۸ + store ۶ ✓ (سقوط/کف/زنجیره/partial/کف تایمر/dual namespace)

### فاز F.۴ — G15: صفحه Climber + مسیر + هاب (۲۱ کارت) ✅ (۲۰۲۶-۱۱-۰۸)
- `ClimberPage.tsx`: نمای عمودی (پلتفرم‌ها bottom-up با word و هایلایت فعال)؛ حلقه تایمر conic-gradient با شمارش ثانیه؛ رانر دایره با transition؛ سقوط = فلاش قرمز + صدا؛ blur→pause badge (الگوی G6)؛ کلمات: language pool + stage≥2 با ۳۰٪ pseudo-words از unlocked letters (read-only، الگوی G9)؛ tick ۵۰ms
- **KI-34 ششمین باریت**: `const st = engineState()` در بدنه Arena و ActiveWord قفل می‌شد (رانر و کلمه فریز) → همه به تابع inline تبدیل شدند
- route + hub + بک‌آپ `skyScores` (دو namespace، sanitize L4)
- تست‌ها: ۶ تست صفحه ✓ (menu/stack+jump/fall HUD/blur pause/ground death+record)

### فاز F.۵ — G15: مود Endless Runner ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/runner/`: `balance.ts` (سرعت ۲۴۰→۴۸۰ با +۳۰/۱۰۰m، gap ۴۶۰→۲۲۰ با decay ۸px/مانع، طول کلمه ۶→۴ با سرعت، ۳ جان، ۵۰px=۱m)، `gen.ts` (سه مانع jump/slide/destroy با آیکن ↑/↓/✕ + gap کاهشی + کلمه per-speed)، `engine.ts` (مانع فعال = نزدیک‌ترین؛ کامل = cleared + combo؛ گذشت ناکامل = −۱ جان و combo صفر؛ مرگ در ۰ جان؛ partial per-obstacle با partialForId)
- `RunnerPage.tsx`: نوار افقی + پارالاکس دو لایه (background-position با ضریب ۰.۲۵/۰.۶) + مانع‌ها با آیکن جهت + جان‌های قلبی + رانر ثابت وسط + blur→pause؛ route `/games/runner` + کارت ۲۲ هاب (بک‌آپ skyScores namespace runner از F.۳ آماده بود)
- تست‌ها: ۸ unit (gen ۳ + engine ۵) + ۵ صفحه ✓
- DoD سند بخش B: سه نوع مانع → برخورد → جان‌ها → رکورد → سوئیت سبز ✓

---

## خوشه G — رسانه (تصمیم مالک: LRC در v1)

### فاز G.۱ — G20 Lyric Line: موتور خالص ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/lyric-line/`: `lrc.ts` (parseLRC استاندارد [mm:ss.xx/.ms] + چند-tag + [offset] مثبت=جلوتر + نادیده‌گرفتن metadata + plain fallback + فروپاشی فاصله‌ها + مرتب‌سازی با nullها در انتها)، `session.ts` (ساعت تزریقی per-tick؛ فعال‌سازی با ساعت آهنگ — هرگز به عقب؛ خط گیرکرده نوبتش حفظ می‌شود تا اتمام/skip؛ sync score = max(0, 1000−|lateness|÷2) با مرجع = cue خط بعدی؛ بدون LRC = فقط accuracy با پیشروی دستی؛ Enter=skip بی‌امتیاز؛ پرش >۱.۵s = void؛ finish() = خلاصه)، `store.ts` (`mtDesktopLyricSessions` ≤10 — فقط متادیتا، فایل صوتی هرگز) + sanitize L4
- تست‌ها: ۲۳ = lrc ۸ + session ۱۰ + store ۵ ✓ (helper playTo با گام ۱s تا گارد seek در تست فعال نشود)
- گیت: سوئیت + tsc

### فاز G.۲ — G20: صفحه + مسیر + هاب (۲۳ کارت) ✅ (۲۰۲۶-۱۱-۰۸)
- `LyricLinePage.tsx`: setup (file input صوت + متن + نام؛ هشدار >۵۰MB؛ حریم خصوصی «never saved»)؛ player: HTMLAudioElement با data: URL از readAsDataURL (**CSP راستی‌آزمایی شد: tauri.conf.json media-src 'self' data: ✓ بدون تغییر**) + progress + کارائوکه (قبل محو/فعال درشت با partial/بعدی sub) + HUD (line/acc/sync) + خلاصه (sync + میانگین lateness یا «accuracy only») + صفحه void؛ pause/give-up فقط دکمه، Enter=skip؛ فایل صوتی append به body (مخفی)
- **KI-34 هفتم (در کد خودم!)**: Karaoke و Progress body-const فریز می‌کردند → توابع inline
- تست‌ها: ۵ ✓ — audio را با `.at(-1)` بگیرید (audio elementهای تست‌های قبلی در harness نشت می‌کنند چون onCleanup در cleanupApp اجرا نمی‌شود)
- route + hub + بک‌آپ `lyricSessions` (sanitize L4)

---

## خوشه H — فرا-بازی (الزاماً آخر)

### فاز H.۱ — قرارداد مشترک Daily registry ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/games/game-registry.ts`: انواع `DailyStage` (gameId/title/seed/params) و `DailyStageResult` (normalized ۰..۱۰۰۰ + raw + won) و `DailyPlayable` (runDailyStage → Promise) + `registerDailyPlayable` (ثبت دوبل → throw) + `getDailyPlayable` + `listDailyPlayables` (ترتیب ثبت — مصرف compose در H.۳) + reset برای تست
- تست‌ها: ۶ ✓ (دوبل throw؛ ترتیب ثبت؛ قرارداد Promise؛ lookup ناشناخته)

### فاز H.۲ — wrapperهای سه بازی راه‌انداز ✅ (۲۰۲۶-۱۱-۰۸)
- `utils/daily-gauntlet/params.ts`: جدول ثابت DAILY_PARAMS (blast: difficulty normal + هدف ۳۰۰۰؛ sprint: هدف ۱۰۰wpm؛ duel: tier ۸۰wpm × ۲۰ کلمه)؛ `stage-bridge.ts`: اتصال wrapper ↔ UI بازی (arm/takePending/resolve — یک مرحله در هر لحظه)
- wrapperها: `utils/word-blast/daily.ts` (normalize = clamp(score/۳۰۰۰×۱۰۰۰))، `utils/sprint/daily.ts` (clamp(wpm/۱۰۰×۱۰۰۰))، `utils/bot-duel/daily.ts` (جدول مستند: برد ۶۵۰+acc×۳ ≤۹۵۰، باخت acc×۲ ≤۲۰۰، مساوی ۴۰۰) — هرکدام registerDailyX با runDailyStage که bridge را مسلح می‌کند
- تست‌ها: ۶ ✓ (normalize خاموش/روشن/سقف/کف هر سه + ثبت سه‌گانه + resolve بریج + resolve غلط نادیده)

### فاز H.۳ — موتور گانتلت ✅ (۲۰۲۶-۱۱-۰۸)
- `compose.ts`: FNV-1a (`hashKey`) + `dayKeyOf` لوکال با padding + `buildDaily` (shuffle seed-دار با hash(dayKey)؛ ۳ بدون تکرار؛ fallback تعداد کم؛ seed هر مرحله = hash(dayKey:gameId)؛ عنوان‌ها و params از جدول نگاشت صریح)
- `engine.ts`: توابع خالص با state سریالایزپذیر — createGauntlet/advanceGauntlet (clamp + **قفل روز بعد از مرحله ۱** + wrong-stage ignore)/voidGauntlet/checkGauntletDay (تغییر dayKey وسط دور → void با reason؛ روز complete مصون)/gauntletTotal
- `store.ts`: `mtDesktopGauntletState` (resume: save با undefined→null برای zod nullable) + `mtDesktopGauntletStats` (streak با previousDayKey شامل مرز ماه، maxStreak، calendar، bestTotal، history ≤10) + sanitize L4 هر دو
- تست‌ها: ۲۱ = compose ۷ + engine ۸ + store ۶ ✓ (resume JSON roundtrip؛ استریک ۲ روز؛ شکستن زنجیره)

### فاز H.۴ — صفحه گانتلت + مسیر + هاب (۲۴ کارت) ✅ (۲۰۲۶-۱۱-۰۸) — **همه ۳۶ فاز بسته شد**
- `complete.ts` (daily-gauntlet): هماهنگ‌کننده STORE است نه کامپوننت — `completeDailyStageForGame` (resolve بریج + advance state ذخیره‌شده)؛ `completeDailyX` در سه wrapper؛ hook پایان در GamesPage (word-blast) و SprintPage و BotDuelPage (بعد از ثبت، اگر مرحله pending بود → complete + navigate برگشت به گانتلت)
- `DailyGauntletPage.tsx`: نمای روز (۳ ردیف pending/next/done با normalized) + نوار مرکبی سه‌قسمتی + دکمه run stage → navigate به بازی + جمع‌بندی (total/stagesWon/استریک) + تقویم ماه با مهر 🔥 + شعله استریک + قفل روز (playedToday از calendar) + resume بین مرحله‌ها از store + روز stale آزاد می‌شود
- ⚠️ ثبت صادقانه: قفل seed v1 = قفل پارامترهای روز (جدول DAILY_PARAMS)؛ rng اجرا هنوز Math.random است (بازپخش seed-دار = v2)
- route `/games/daily-gauntlet` + کارت ۲۴ هاب + بک‌آپ `gauntletState`/`gauntletStats` (sanitize L4)
- تست‌ها: ۵ صفحه ✓ (menu/compose ۳گانه/complete+calendar+lock/resume/stale)

---

## شمار نهایی

| خوشه | فازها | بازی‌ها |
|---|---|---|
| A | A.۱–A.۶ (۶) | G8, G9, G10 |
| B | B.۱–B.۶ (۶) | G12, G11, G16 |
| C | C.۱–C.۵ (۵) | G23, G13 (دو مود) |
| D | D.۱–D.۴ (۴) | G17, G21 |
| E | E.۱–E.۴ (۴) | G18, G19 |
| F | F.۱–F.۵ (۵) | G14, G15 (دو مود) |
| G | G.۱–G.۲ (۲) | G20 |
| H | H.۱–H.۴ (۴) | G22 |
| **جمع** | **۳۶ فاز** | **۱۶ بازی + قرارداد Daily** |

**نکته اجرایی:** هر فاز بعد از گیت، وضعیتش در همین سند تیک می‌خورد (الگوی سند G1–G6). بیلد نسخه در پایان هر خوشه (یا به تشخیص مالک) با روال ثابت: vite build → tauri build امضا → ثبت releases/README.md → پوشه سند نسخه SoftwareRelease.
