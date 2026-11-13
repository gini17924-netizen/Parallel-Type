# شورا — نقشهٔ راه کامل ParallelType (2026-11-12)

> فازبندی کامل تمام کارهای شناسایی‌شده — زیر‌باری‌ها اول، بانک ایده بعد. هر فاز: هدف + فایل‌ها + گیت + معیار پایان — **agent-executable**: هر فاز مستقیم به یک AI agent سپرده می‌شود بدون تصمیم باز.
> قواعد ایستاده: UI فقط انگلیسی؛ بدون سرور/اکانت؛ مسابقه آنلاین آمار محلی نمی‌نویسد؛ هر فاز با «شروع کن X» باز می‌شود و با کامیت/تیک بسته.
> شماره‌گذاری ادامهٔ موج قبلی است (از ۵۶). **وابستگی‌ها با «نیازمند» مشخص شده — رعایت اجباری.**

---

## بلوک ۰ — هات‌فیکس گزارش‌های کاربر (فازهای H1-H5 — قبل از همه)

**فاز H1** ✅ (391781e) — **اتصال دستی LAN: بازproduction + بازخورد.** (انجام‌شده: **سه شکاف واقعی بسته شد** — (۱) کلاینت Rust هیچ تایم‌اوت روی تلاش TCP نداشت → فایروالی که SYN را DROP می‌کند join را ~۲۱s ساکت نگه می‌داشت → پنجرهٔ ۵s با خطای نام‌برندهٔ فایروال؛ (۲) هاست joinهای خوش‌فرم با کد غلط را **ساکت نادیده** می‌گرفت → کلاینت ۵s منتظر ack می‌ماند → الان بلافاصله `join-rejected` می‌دهد و به گوش دادن ادامه می‌دهد (کلاینت درست هنوز می‌تواند بیاید)؛ (۳) لابی خطای دقیق Rust را پشت یک خط عمومی قورت می‌داد و in-flight نداشت → lanJoin دلیل دقیق را resolve می‌کند و دکمهٔ join حالت connecting با disabled می‌گیرد. **قرارداد پروتکل تازه**: `join-rejected` (نقض پروتکل نیست). تست‌ها: decide_join خالص (Accept/Reject/Ignore) + rejected-ack دقیق → ۱۶ تست Rust؛ لابی ۱۲/۱۲ (خطای دقیق + in-flight)؛ سوئیت کامل ۲۸۳۱/۲۸۳۱ + lint/tsc صفر. push هر دو ریموت.)
- هدف: (a) بازتولید و ریشه‌یابی «کد/IP/پورت → هیچ اتفاقی → بعداً نمی‌توان متصل شد (درست و غلط یکسان)» با تست e2e Rust روی مسیر واقعی (هاست واقعی + کلاینت اسکریپتی: کد غلط → خطای دقیق؛ کد درست → ack → رله)؛ (b) UI: حالت «connecting» با نشانگر از لحظهٔ کلیک، پیام خطای دقیق per-مرحله (TCP refused / ack timeout / کد رد شد)، سقف زمانی مشخص؛ (c) اگر باگ پروتکل پیدا شد فیکس.
- فایل‌ها: `src-tauri/src/lan.rs` (تست e2e مینیمال H1 — از فاز ۶۰ جدا نیست)، `landing/OnlineLobbyPage.tsx` (connecting state + error per-step)، `states/lan.ts` (خطاهای typed از connect).
- گیت: تست e2e سبز (کد غلط → پیام دقیق؛ کد درست → connected) + سوئیت کامل + spec اتصال دستی.
- پایان: کلیک connect → فیدبک فوری؛ کد درست روی LAN واقعی وصل می‌شود؛ کد غلط → پیام دقیق در <۲s.

**فاز H2** ✅ (0db9e09) — **Balloon Pop: قانون کمبو یکدست + خوانا.** (انجام‌شده: بازproduction نشان داد **موتور از قبل یکدست است** — حرف غلط در هر استیجی combo را صفر می‌کند و تست stage-1 موجود هم بود؛ آنچه شکسته بود **بازخورد** بود: HUD `x<combo خام>` — شمارنده با لباس مالتی‌پلایر، پس صفر شدن شبیه «کم شدن» خوانده می‌شد. HUD الان خام و مالتی‌پلایر را جدا نشان می‌دهد (`2 · x1`) + تست صریح صفر شدن در استیج ۲ (کشف مسیر: popBalloon خودش spawn نمی‌کند — اسپاون روی تیک است؛ تست باید tick بدهد وگرنه میدان خالی می‌ماند و حرف غلط بی‌اثر می‌شود). سوئیت ۲۸۳۲/۲۸۳۲ + lint/tsc صفر. push هر دو ریموت.)
- هدف: حرف غلط در **همهٔ استیج‌ها** کمبو را صفر کند (استیج ۱ فعلاً بی‌اثر است — ناسازگار)؛ HUD عدد کمبوی خام + مالتی‌پلایر را هم‌زمان نشان دهد تا رفتار خوانا باشد.
- فایل‌ها: `src/ts/utils/balloon-pop/engine.ts` (شاخهٔ استیج ۱: حرف غلط → breakCombo)، HUD کمبو صفحه، spec.
- گیت: spec (یک غلط → صفر، در هر استیج) + سوئیت کامل.
- پایان: رفتار کمبو یکدست و قابل‌مشاهده.

**فاز H3** ✅ (a85364a) — **Balloon Pop: خط danger جایی که منفجر می‌شود.** (انجام‌شده: عدم‌تطابق هندسه — موتور در y ≤ dangerLineVh (۶vh داخل آرنا) پاپ می‌کند ولی خط در top-0 (لبهٔ آرنا) کشیده می‌شد → ترکیدن ۶vh قبل از خط ✓ گزارش کاربر. الان خط و لیبلش روی آستانهٔ موتور رندر می‌شوند (`top: dangerLineVh vh` + testid bp-danger-line)؛ دو تست: top خط رندر‌شده == dangerLineVh، و اسکیپ موتور روی «دقیقاً همان تیکی که y اولین بلون (tracked by id) خط را رد می‌کند» — بلون‌های بعدی پشتش صعود می‌کنند و بی‌ربط‌اند (درس: دنبال حذف «همه» نگرد — بلون‌های spawn بعدی هنوز زنده‌اند). سوئیت ۲۸۳۴/۲۸۳۴ + lint/tsc صفر. push هر دو ریموت.)
- هدف: خط قرمز روی همان y بکشیده شود که موتور منفجر می‌کند (`top: ${BALANCE.dangerLineVh}vh` داخل آرنا — الان top-0 است و موتور در 6vh → بادکنک قبل از خط می‌ترکد)؛ رندر بالون نسبت به خط چک شود.
- فایل‌ها: `BalloonPopPage.tsx` (خط danger)، `balance.ts` (اگر واحد باید arena-% شود)، spec هندسه.
- گیت: spec هندسه (مرز ترکیدن == خط رندر‌شده) + سوئیت.
- پایان: بادکنک دقیقاً روی خط می‌ترکد.

**فاز H4** ✅ (200f922) — **Maze Runner: پرش از میان خطوط.** (انجام‌شده: ریشه دو-لایه در حساب carry — (۱) وقتی گیت مسدود است walkCarry هر تیک انباشته می‌شد (while روی refusal می‌شکست بدون مصرف) → کل دورهٔ مسدود روی باز شدن گیت به burst چندخانه تبدیل می‌شد؛ (۲) باز افزودن delta تیک بعدی (`walkCarry += nowMs - lastTickAt`) زمانِ مسدود + تایپ را حتی بعد از cap احیا می‌کرد. فیکس: **حین مسدود بودن carry به یک خانه cap می‌شود** (رانر پشت گیت منتظر می‌ماند) و **تکمیل کلمهٔ گیت walk را از لحظهٔ باز شدن ری‌استارت می‌کند** (`lastTickAt = nowMs; walkCarry = 0` در feedKey) — از آنجا یک خانه per walkMsPerCell، بدون تلپورت. تست پین می‌کند: مسدودی پنج‌خانه‌ای hold می‌شود و اولین تیک بعد از باز شدن دقیقاً یک خانه پیش می‌رود. سوئیت ۲۸۳۵/۲۸۳۵ + lint/tsc صفر. push هر دو ریموت.)
- هدف: وقتی گیت مسدود است walkCarry از یک خانه جلوتر انباشته نشود — روی باز شدن گیت رانر «یک خانه» جلو می‌رود و بقیه با نرخ طبیعی (بدون تلپورت از میان خطوط maze).
- فایل‌ها: `src/ts/utils/maze-runner/engine.ts` (سقف walkCarry در مسیر مسدود + spec)، spec هندسه مسیر.
- گیت: spec (مسدود ۳s → باز شدن → حداکثر یک پرش خانه، بقیه نرمال) + سوئیت.
- پایان: بدون پرش دیداری؛ مسیر همیشه روی خطوط maze.

**فاز H5** ✅ (90a6478) — **Type Pong: سطح‌بندی سختی (آفلاین).** (انجام‌شده: گزارش «سختی بالاست» → سه tier در BALANCE (`aiSpeedByDifficulty`: easy ۳۰ / normal ۶۰ / hard ۹۰ واحد/ثانیه)؛ persist جدا از آمار (`mtDesktopTypePongSettings` — تغییر tier هرگز شکل استور آمار را نمی‌زند)؛ پیکر سه‌دکمه‌ای در منو (فقط مود pong؛ آنلاین disabled — **LAN هیچ AI ندارد، هر دو پدال انسانی‌اند**)؛ wiring به createPongEngine؛ بریکر دست‌نخورده. spec: پیکر + persist + survive remount → ۱۰/۱۰ صفحه؛ سوئیت ۲۸۳۶/۲۸۳۶ + lint/tsc صفر. push هر دو ریموت.)
- هدف: پیکر سطح برای مود pong آفلاین: easy/normal/hard → aiSpeed (30/60/90) + ذخیرهٔ انتخاب؛ LAN دست‌نخورده (هر دو پدال انسانی‌اند).
- فایل‌ها: `TypeSnakePage` نه — `TypePongPage.tsx` (پیکر سطح + aiSpeed tier)، store (آمار per-tier مثل bot-duel؟ فقط tier فعلی)، spec.
- گیت: spec هر سطح (سرعت AI تفاوت محسوس) + سوئیت.
- پایان: سه سطح قابل‌انتخاب و معنادار.

**(این بلوک قبل از بلوک A اجرا می‌شود؛ شماره‌گذاری فازهای ۵۶+ دست‌نخورده می‌ماند.)**

## بلوک A — زیر‌بار (فازهای ۵۶-۶۴)

**فاز ۵۶** ✅ (6b0b720) — **toggle و دکمهٔ آپدیتر در Settings.** (انجام‌شده: فلگ پایدار در app CONFIG dir (`updates-settings.json` — missing/corrupt = on؛ فایلِ config نه data تا با نصب سفر کند نه با پروفایل‌ها) خوانده‌شده توسط boot check **قبل از لود فرانت**؛ سه فرمان registered: `updates_get_settings` / `updates_set_auto_check` / `updates_check_now` — دستی: current → پاس سبز؛ available → events `updates://status` (available/installed) + دانلود/نصب passively + restart (پاسش شاید هرگز نرسد — UI از قبل announcing می‌شود)؛ کارت UpdatesCard در Settings (toggle دو-دکمه‌ای + check button + خط وضعیت زنده؛ desktop-only fallback)؛ ماژول utils/updates.ts با accessor خودش (الگوی per-module). **درس E0255 (KI-53)**: فرمان‌های tauri در crate root باید `fn` باشند نه `pub fn` — pub، re-export ماکرو __cmd__ را دوباره import می‌کند و E0255 می‌دهد (backup_write/backup_read مرجع درست بودند)؛ + emit های main.rs باید app.emit با import Emitter باشند (helper emit فقط در lan.rs). تست‌ها: ۱۶ Rust + spec کارت ۴/۴ (load/toggle-persist/current/available) — سوئیت ۲۸۴۱/۲۸۴۱ + lint/tsc صفر. push هر دو ریموت.)
- هدف: کنترل کاربر روی آپدیت خودکار + چک دستی.
- فایل‌ها: `src-tauri/src/main.rs` (خواندن/نوشتن `updates.json` در app config dir؛ توابع خالص load/save + تست Rust)، فرمان‌های `updates_set_auto_check(bool)` و `updates_check_now()` (نتیجه → event)، `src/ts/components/...settings/` (toggle + دکمه + نمایش نتیجه) — متن انگلیسی.
- گیت: cargo test ۱۴+ و سوئیت فرانت کامل و oxlint صفر.
- پایان: toggle در Settings کار می‌کند؛ بوت با فلگ خاموش چک نمی‌کند؛ دکمهٔ دستی «آپدیت هست/نیست» را نشان می‌دهد.

**فاز ۵۷** ✅ (e2c3e09 + run 43269892635 سبز) — **strictness: بازتعریف کامل — بدهی واقعی نبود.** (انجام‌شده: dispatch تمیز با نصب درست → tsc روی لینوکس **سبز کامل** — مقایسه با run 2 کشف کرد **۱۰۰۷ «خطای strictness» ساختگی بودند**: نصب شکستهٔ run 2، زنجیرهٔ `extends: @monkeytype/typescript-config/base.json` را unresolved گذاشت و tsgo تحت پروفایل fallback خودش چک کرد؛ با نصب درست (۶a72a6d/b5d42ef) کد فورک تحت tsconfig خودش روی لینوکس و ویندوز هر دو سبز است. فاز ۵۶، فلگ informational را حذف و tsc را **blocking** کرد؛ فازهای ۵۸/۵۹ به این فاز ادغام شدند. **KI-51 اصلاح شد**: «false green ویندوز» اشتباه بود — هر دو پلتفرم سبزند؛ درس واقعی: شکستن زنجیرهٔ extends، پروفایل چک را بی‌صدا عوض می‌کند — گیت install باید قبل از tsc بیاید.)
- هدف: فهرست‌کردن کامل بدهی tsc لینوکس و زدن خوشه‌های شناخته‌شده.
- فایل‌ها: `docs/strictness-ledger.md` (خروجی کامل `tsc --noEmit` لینوکس grouped per file — از CI استخراج)، سپس فیکس خوشهٔ ۱: `frontend/scripts/*` + `src/ts/auth.tsx` + `src/ts/collections/*` (TS7006/TS4111/TS2339 — تایپ صریح، index-access با براکت، تایپ رکوردها).
- گیت: `npx tsc --noEmit` روی آن فایل‌ها صفر (CI informational شمارش را کم نشان دهد) + سوئیت کامل سبز.
- پایان: لجر در docs + آن خوشه‌ها صفر.

- **فاز ۵۸** ✅ بسته شد — ادغام در ۵۷ (بدهی واقعی نبود؛ کشف در سند ۵۷).
- هدف: تمام خطاهای لجر تا صفر (خوشه‌های باقی‌مانده per-file).
- فایل‌ها: طبق لجر فاز ۵۷.
- گیت: tsc لینوکس = ۰ خطا (در CI informational سبز شود) + سوئیت کامل.
- پایان: بدهی strictness صفر؛ نیازمند فاز ۵۷.

- **فاز ۵۹** ✅ بسته شد — ادغام در ۵۷ (tsc blocking در CI اجرا و سبز شد).
- هدف: tsc در CI از informational به **blocking**.
- فایل‌ها: `.github/workflows/verify.yml` (حذف continue-on-error) + pre-commit hook (اضافه‌کردن tsc به lint-staged یا هوک جدا).
- گیت: یک run سبز با tsc blocking.
- پایان: هیچ PR/push با خطای tsc وارد main نمی‌شود. نیازمند فاز ۵۸.

**فاز ۶۰** ✅ (93dc7e5 + run 43286518884 سبز) — **e2e واقعی: دومین peer اسکریپت‌شده روی TCP loopback.** (انجام‌شده: `run_host` به abstraction تبدیل شد — trait `LanEventSink` با دو پیاده‌سازی: `AppEventSink` (production؛ wrapper روی AppHandle) و `TestSink` (تست؛ Arc<Mutex<Vec>>) — تا e2e بدون AppHandle ممکن شود؛ سه تست tokio روی **TCP loopback واقعی بدون mock**: (۱) رلهٔ مسابقهٔ کامل — join → ack با نام هاست → startِ رله‌شده از کانال فرانت → progressهای کلاینت در sink؛ (۲) کد غلط → `join-rejected` فوری و هاست همچنان listen می‌کند — کلاینت دوم با کد درست join می‌شود؛ (۳) flood ۱۶۰ پیام در یک پنجره → limiter trip → `peer-left`. **تغییر معماری تازه: حلقهٔ re-accept handshake** — run_host قبلاً فقط یک accept داشت و کلاینتِ ردشده/ساکت اسلات را پین می‌کرد (شکست e2e دوم را لو داد)؛ الان accept+handshake داخل `'handshake: loop` است: Reject → ارسال reject + `break None` در همان نفس (اتصال فوری آزاد می‌شود — نه خواندن از کلاینتِ ردشده تا deadline ۱۰s) → accept بعدی؛ سکوت/drop هم اسلات را می‌دهد و beacon در فاصلهٔ بین اتصال‌ها همچنان announce می‌کند. **درس‌های چهار run CI**: (a) E0308 — خط join را `Option<String>` نگیر، مستقیم `String`؛ (b) E0596 — بایندینگ‌های خروجی حلقه (`reader`/`write`) و `write_half` باید `mut` باشند — لوکال `cargo check` پشت خطای link.exe (VS Build Tools از سیستم حذف شده) هرگز به type-check خود crate نرسید → CI لینوکس گیت واقعی شد تا نصب مجدد Build Tools؛ (c) **درس H1 بار سوم با سه لباس**: فرستندهٔ کانال در هر تست live-match باید زنده بماند — ConnectionReset (drop sender → shutdown فوری)، سپس BrokenPipe (سوکت نیمه‌مسابقه بسته شد)، این‌بار sender drop → حلقهٔ write فوراً تمام → `read_task.abort()` قبل از این‌که limiter اصلاً trip کند؛ (d) کادنس scripted_client: هر send یک read قبلش دارد — relayِ کانالی بین دو progress خوانده می‌شود. ضمناً دو cast no-op در `updates.ts` (باقی‌ماندهٔ فاز ۵۶) oxlint را بست. سوئیت Rust ۱۹/۱۹ شامل سه e2e + فرانت ۲۸۴۱/۲۸۴۱ + lint/tsc صفر. push هر دو ریموت.)

**فاز ۶۱ — دو ماشین فیزیکی (کاربر-اجرا؛ عامل پشتیبان)**
- هدف: اجرای `docs/TEST_RUN_2_DEVICES.md` روی دو دستگاه واقعی؛ ثبت یافته‌ها → `docs/TEST_RUN_FINDINGS.md`.
- گیت: یافته‌ها ثبت و هر باگ → فاز پولیش تازه.
- پایان: سناریو کامل اجرا شده؛ یافته‌ها فازبندی شده.

**فاز ۶۲ — پولیش یافته‌های دو دستگاه**
- هدف: فیکس هر باگ/ناراحتی که اجرای واقعی لو داد (per findings).
- گیت: سناریو دوباره سبز روی دو ماشین.
- پایان: بدون یافتهٔ باز. نیازمند فاز ۶۱.

**فاز ۶۳** ✅ (088f4ab + run 43291650512 سبز — release v0.28.2-rc1 منتشر شد) — **اتوماسیون ریلیز: یک dispatch = tag → build → sign → publish.** (انجام‌شده: `.github/workflows/release.yml` با workflow_dispatch و ورودی نسخه — نسخهٔ app با `--config '{"version":...}'` override می‌شود (هیچ فایل سورسی لمس نمی‌شود)، فرانت با گیت خودش بیلد می‌شود (madge + ts-check + vite)، NSIS با secret ریپو امضا می‌شود، `latest.json` از `.sig` واقعی ساخته می‌شود (sig غایب = شکست run — نصب‌کنندهٔ غیرقابل‌تأیید هرگز منتشر نمی‌شود؛ درس KI-49) و gh سه فایل را با تگ منتشر می‌کند؛ ورودی prerelease وسیلهٔ آزمایش امن است — `/latest` آپدیتر هرگز pre-release نمی‌دهد. **زیرساخت کشف‌شده**: کلید امضا `~/.tauri/paralleltype-updater.key` فرمت single-line base64 دارد که مستقیم **محتوای** `TAURI_SIGNING_PRIVATE_KEY` است (فرمت unwrapped/مسیر را CLI 2.12.4 رد می‌کند: `-k` مقدار را base64 می‌گیرد؛ env با خط کامنت هم شکست می‌خورد)؛ رمز کلید **خالی** است (اثبات: امضای واقعی با CLI و `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`)؛ keynum امضای تازه == pubkey شارپ (`2a04402efdcc3bcb`) و ساختار sig عیناً همان sig کارکردهٔ 0.28.1 است؛ secret با API (sealed-box/pynacl) ست شد. **درس‌های CI**: (۱) `.env.production` لوکال git-ignored است و vite بیلد production را بدون `RECAPTCHA_SITE_KEY` رد می‌کند → placeholder باید روی استپ *بیلد فرانت* باشد نه استپ tauri (بار اول به استپ اشتباه دادم و همان خطا برگشت)؛ (۲) re2 optional dep روی ویندوز runner gyp error می‌دهد ولی blocking نیست. انتشار آزمایشی کامل: **v0.28.2-rc1 pre-release منتشر شد** (سه فایل: installer 17MB + sig + latest.json با URL pin-شده به تگ) و `/latest` همچنان v0.28.1 — تولیدی دست‌نخورده. گیت verify هر سه کامیت سبز. انتشار نسخهٔ بعد = فقط dispatch با ورودی نسخه. push هر دو ریموت.)

**فاز ۶۴** ✅ (c967a7d + run 43293900016 سبز در ~۹ دقیقه) — **smoke نصب‌کننده در CI: نصب سایلنت → اجرا → چک پروسه → حذف تمیز.** (انجام‌شده: جاب `windows-smoke` در verify.yml با ورودی opt-in `smoke_windows` (dispatch-only — هزینه‌اش بیلد کامل ویندوز است و روی هر push اجرا نمی‌شود)؛ مسیر بیلد عیناً همان خط امضاشدهٔ release است (فرانت با placeholder RECAPTCHA + NSIS با secret) — پس همان artifactی که منتشر می‌شود smoke می‌شود؛ نصب سایلنت `/S` در حالت currentUser، یافتن exe با مسیرهای شناخته‌شده + جستجوی bounded به‌عنوان fallback، اجرای app و الزام زنده‌بودن پروسه بعد از ۱۰ ثانیه (کرش لانچ = کلاس خرابی‌ای که جاب برایش ساخته شد)، و حذف سایلنت با polling تا پوشهٔ نصب واقعاً غیب شود (NSIS خودش را به %TEMP% کپی و re-exec می‌کند — صبر روی پروسهٔ اول کافی نیست). شواهد run: نصب در `…\AppData\Local\ParallelType\ParallelType.exe` (نسخهٔ 0.28.1)، پروسهٔ زنده PID 5568، حذف تمیز — سه جاب سبز (frontend/rust/smoke). cache ویندوز از run ریلیز فاز ۶۳ گرم بود → کل جاب ~۹ دقیقه. جریان انتشار: قبل از cut کردن نسخه، یک dispatch با smoke_windows=true؛ بعد dispatch ریلیز.)

**فاز ۶۵** ✅ (48c9dfc + verify سبز) — **سبک‌سازی monorepo: prune کامل.** (انجام‌شده: audit ایمپورت‌ها نشان داد فرانت هر ۷ وابستگی workspace خودش را واقعاً استفاده می‌کند (schemas 238 / util 59 / funbox 15 / contracts 10 / challenges 5 / ts-config / oxlint-config) و هیچ ارجاع functional به backend وجود ندارد — تنها ارجاع‌ها در ابزار ریشه بودند؛ حذف‌شده‌ها: **backend/** (کل درخت سرور upstream — فورک دسکتاپ بدون سرور است)، **frontend/storybook** (ابزار upstream)، **packages/release** (CLI semantic-release که خط ریلیز workflow فاز ۶۳ جایگزینش کرد) — ۲۳۶ فایل / ۴۴.5k خط از درخت، **۶.۳k خط از lockfile**، ۱۳→۱۰ workspace project. ابزار ریشه هم‌راستا: ۲۰ اسکریپت ریشه (variantهای -be، خانوادهٔ monkeytype-release، docker، storybook، start trio) + dep `@monkeytype/release` (در devDependencies بود — بار اول از dependencies پاک کردم و install با ERR_PNPM_WORKSPACE_PKG_NOT_FOUND شکست) + turbo.json (storybook + backend#dev) + knip.json (backend) + vitest.config.ts ریشه (backendProjects) + frontend/package.json (اسکریپت storybook) + pnpm-workspace (دو خط). **دو workflow مرده upstream هم رفتند**: monkey-ci.yml (فقط روی master — روی main ما هرگز نمی‌سوخت) و publish-docker-images.yml (روی هر release published می‌سوخت و ایمیج سروری را می‌ساخت که ship نمی‌کنیم!). labeler.yml هم از backend پاک شد؛ hook .claude/format-and-lint دست نخورد (شاخهٔ backend‌اش dead ولی بی‌ضرر). درس‌های کوچک: `git add -A` دو فایل probe بازماندهٔ فاز ۵۵ را هم به کامیت کشید → unstaged و حذف شدند؛ node لوکال 22 با engines `>=24 <25` قفل install را می‌شکند → `--config.engine-strict=false` فقط برای همان دستور (CI روی 24 است). گیت: install 20.5s + tsc صفر + oxlint صفر + vitest سبز (دو تست real-time یک بار زیر بار لوکال timeout خوردند و در اجرای دوباره سبز — مرجع: verify 48c9dfc سبز روی CI). نکتهٔ باز: دو PR dependabot باز مانده (commitlint 21.2.4، tsup 9.0.0 — هر دو verify سبز) — تصمیم merge با کاربر. push هر دو ریموت.)

---

## بلوک B — محتوا و تایپ (فازهای ۶۶-۷۲)

**فاز ۶۶** ✅ (d872ab6 + verify سبز) — **حالت جملات: ادبیات فارسی + PBهای language-keyed.** (انجام‌شده: کشف — حالت quote از قبل کار می‌کرد و `static/quotes/persian.json` موجود بود (۱۸ نقل‌قول) ولی سه شکاف واقعی داشت: (۱) **محتوا** — عمدتاً جملات مدرن و bucket thicc (601+) کاملاً خالی بود (انتخابش خطا می‌داد) → کلکسیون به ۴۷ رسید با شعر کلاسیکِ راستی‌آزمایی‌شده از گنجور (آغاز شاهنامه، غزل ۱۸۴ حافظ کامل، نی‌نامه مثنوی با قرائت نیکلسون، خیام، سعدی گلستان، باباطاهر، وحشی بافقی) — گنجور **سه مصراع به‌خاطرم‌نادرست را تصحیح کرد** («زان طره جوید»→«بگشاید»، بیت سوم کوزه، «بصراندند»→«بسرشتند»)؛ طول‌ها computed و اعرابِ تایپ‌نشدنی از کلکسیون پاک شد (یک ردیف legacy سه علامت داشت). نام فایل سند (`quotes-fa.json`) به معماری واقعی اصلاح شد: مسیر زبان‌محورِ موجود `quotes/persian.json`. (۲) **آمار** — بیلد آفلاین قانون سرور را mirror کرده بود و quote هیچ PB محلی نمی‌گرفت → سه گارد برداشته شد (test-logic canGetPb، db saveLocalPB، result-pb getPbEligibility) و مسیر حذف-بازمحاسبه هم‌راستا شد؛ PBهای quote با mode2=شناسهٔ نقل‌قول **و language** کلید می‌خورند — جلسات فارسی هرگز به bucket انگلیسی نمی‌رسند (استور مستقل). (۳) **spec** — quotes-persian.spec.ts هشت تست: سلامت سخت محتوا (schema strict، طول computed، بدون تکرار، پوشش ۴ bucket، بدون اعراب تایپ‌نشدنی) + جریان واقعی generator روی bucketهای thicc/short با فلگ‌های rtl/joiningScript + جداسازی PB بین زبان‌ها. نکتهٔ ساخت: `generateWords` زبان را آرگومان می‌گیرد → اسپک بدون mock پیچیده مستقیم از دیسک می‌خواند؛ مسیر static از `__tests__/test/` سه سطح `../` می‌خواهد. RTL بلند: زیرساخت از قبل کامل بود (rightToLeftTest + joiningScript + per-word در Word.tsx) — spec پینش می‌کند. سوئیت ۲۸۵۰/۲۸۵۰ + tsc/oxlint صفر + verify CI سبز. push هر دو ریموت.)

**فاز ۶۷** ✅ (3b362c9 + verify سبز) — **حالت کد: اسنیپت مخلوط RTL/LTR + دریل نشانه‌ها.** (انجام‌شده: کشف — اسنیپت واقعی کد از قبل به‌صورت quotes/code_*.json شارپ شده بود و quote+زبان کد از طریق generator جاری است؛ شکاف‌های واقعی: (۱) **محتوا بدون کامنت فارسی** و (۲) bucket thicc راست **خالی** و (۳) هیچ بازخورد per-symbol. محتوا: ۶ اسنیپت منتخب (TS/Rust/Python) با کامنت‌های فارسی واقعی — مادهٔ مخلوط RTL/LTR؛ سیستم per-word direction (marksRtlWords پیش‌فرض روشن) کد را LTR نگه می‌دارد و واژه‌های کامنت فارسی را per-word RTL می‌کند — با تست واحد روی isWordRightToLeft پین شد تا هایلایت هرگز نصفه‌ونیمه نشود (قاعدهٔ keybr). نام‌مسیر سند (`static/code-snippets/*`) به معماری واقعی اصلاح شد: `quotes/code_*.json`. **دریل نشانه‌ها**: `utils/code-drill.ts` — هر جلسهٔ کد ذخیره‌شده آمار per-symbol می‌نویسد (کلید مستقل `mtDesktopCodeDrill` — هرگز با گرید حروف learn-stats قاطی نمی‌شود؛ الگوی independent-store)؛ plan builder خالص است (LCG seedدار + weakspot argmax روی قالب‌های space-free symbol-dense + کف ۰.۰۵ smart-drill) و DrillsPage کارت «code symbols» گرفت (ضعیف‌ترین نشانه‌ها + drill یک‌کلیکی). test-logic از هر جلسهٔ کد ذخیره‌شده ثبت می‌کند (TestWords.words.get + getInputHistory). spec: code-drill (۶ تست — ایزولاسیون ذخیره، خطا روی expected symbol، ادغام جلسات، plan قطعی seedدار) + quotes-code (۱۰ تست — سلامت سه فایل، thicc راست، پین جهت مخلوط، جریان واقعی generator با فلگ‌های LTR). نکتهٔ ساخت: کامنت بلاکی حاوی `*/` خودش را می‌بندد؛ TS2532 روی اندیس آرایه (noUncheckedIndexedAccess) با `?? 0`. سوئیت ۲۸۶۶/۲۸۶۶ + tsc/oxlint صفر + verify CI سبز. push هر دو ریموت.)

**فاز ۶۸ — حالت املا (dictation)**
- هدف: TTS جمله را می‌گوید (همان موتور hear-it)، کاربر می‌نویسد؛ مقایسه هوشمند (نیم‌فاصله/اعراب).
- فایل‌ها: پیکر حالت، TTS adapter موجود، استور.
- گیت: spec + سوئیت.
- پایان: یک جلسهٔ dictation با امتیاز دقت املایی.

**فاز ۶۹ — دریل‌های فارسی تخصصی**
- هدف: دو دریل تازه: نیم‌فاصله (ZWNJ) و علائم فارسی — با مولد کلمه بر اساس تعریف.
- فایل‌ها: `src/ts/test/words-generator*`، funbox/drill registry.
- گیت: spec مولد + سوئیت.
- پایان: دو دریل قابل‌انتخاب در test flow.

**فاز ۷۰ — منحنی تسلط per-key**
- هدف: keybr فارسی فعلی + معیار تسلط (هر کلید ≥ N حرف درست در سرعت ≥ X) →بازشدن کلید بعدی؛ نمایش مسیر تسلط.
- فایل‌ها: `src/ts/keybr/*`، استور پیشرفت، UI مسیر.
- گیت: spec معیار + سوئیت.
- پایان: curriculum زنجیره‌ای واقعی.

**فاز ۷۱ — کتابخانهٔ متن کاربر**
- هدف: فولدر `texts/` خوانده‌شود؛ انتخاب متن از لیست؛ ذخیره در تنظیمات.
- فایل‌ها: command فرمان خواندن پوشه، UI انتخاب، cache.
- گیت: spec + سوئیت.
- پایان: تایپ متن دلخواه از فایل.

**فاز ۷۲ — گزارش استاتیک HTML**
- هدف: خروجی تک‌فایل HTML از کل آمار (با نمودارهای inline) — بدون سرور.
- فایل‌ها: `src/ts/utils/stats-export.ts`، دکمه در اکانت.
- گیت: spec تولید + خروجی باز‌شدنی.
- پایان: یک فایل HTML کامل و بی‌وابستگی.

---

## بلوک C — موج آنلاین ۲ (فازهای ۷۷-۸۴) — **نیازمند بلوک A (e2e فاز ۶۰)**

**فاز ۷۷ — pipe v2: چند-هم‌بازی**
- هدف: هاست N کلاینت (room model) — پیام‌ها با clientId رله؛ پروتکل backward-compatible؛ سقف N=۸.
- فایل‌ها: `src-tauri/src/lan.rs` (RoomHandle + رله multi)، `states/lan-match.ts` (کلاینت‌ها map).
- گیت: تست Rust multi-peer + e2e فاز ۶۰ با ۳ بازیکن.
- پایان: ۳ دستگاه یک مسابقه ببینند.

**فاز ۷۸ — تورنمنت حذفی**
- هدف: براکت N نفره روی room، نوبت‌بندی مسابقه‌ها، جدول نتایج.
- فایل‌ها: `src/ts/states/lan-tournament.ts` (خالص + تست)، UI لابی.
- گیت: spec براکت + سوئیت + تست Rust.
- پایان: یک تورنمنت ۴ نفره کامل.

**فاز ۷۹ — تماشاگر زنده**
- هدف: کلاینت تماشاگر (بدون بازی) همان snapshotها را رندر کند — فقط رندر، بدون ورودی.
- فایل‌ها: `lan-match.ts` (نقش spectator)، صفحات بازی (فقط رندر میدان).
- گیت: spec spectator + سوئیت.
- پایان: تماشای زندهٔ type-pong/stack-attack.

**فاز ۸۰ — چت بین مسابقه‌ها**
- هدف: پیام‌های کوتاه سقف‌دار روی pipe (نوع `chat`، ۲۸۰ کاراکتر، rate-limit مشترک) + UI لابی.
- فایل‌ها: `lan.rs` (پاس‌ترو همان raw)، `states/lan-chat.ts`، UI لابی.
- گیت: spec + تست Rust (سقف).
- پایان: چت دوطرفه در لابی.

**فاز ۸۱ — replay مسابقه**
- هدف: ضبط تایم‌لاین ورودی‌ها (seed + keystrokes با زمان) در فایل؛ بازپخش ghost در صفحه.
- فایل‌ها: `src/ts/utils/replay/*` (خالص + تست)، ذخیره/بارگذاری فایل، UI ghost.
- گیت: spec بازپخش (دقیق replay تایم‌لاین) + سوئیت.
- پایان: مسابقهٔ ضبط‌شده دقیقاً بازپخش می‌شود.

**فاز ۸۲ — ghost racing عمومی**
- هدف: رقابت با ghost ران قبلی خودت در بازی‌های امتیازی (overlay پیشرفت ghost).
- فایل‌ها: استور ghost، پیکرهای بازی‌های S (overlay مشترک).
- گیت: spec + سوئیت per-game.
- پایان: حداقل ۳ بازی با ghost خودت.

**فاز ۸۳ — duel روی متن سفارشی + رله تیمی**
- هدف: دو حالت آنلاین تازه: (a) هر دو نفر همان متن سفارشی؛ (b) رله کلمه‌به‌کلمه دو نفره.
- فایل‌ها: lan-match (شروع با متن سفارشی)، پیکر رله (نوبت‌بندی).
- گیت: spec هر دو + سوئیت.
- پایان: دو حالت قابل‌بازی.

**فاز ۸۴ — لیدربورد LAN + گانتلت مشترک**
- هدف: استور مداوم رکوردهای مهمان‌ها روی هاست؛ گانتلت روزانه با همان seed دوستان و جدول مقایسه.
- فایل‌ها: `src-tauri/src/lan.rs` (فرمان استور), استور لیدربورد، UI گانتلت (تب دوستان).
- گیت: spec + سوئیت.
- پایان: جدول دوستان برای گانتلت روزانه.

---

## بلوک D — بازی‌ها (فازهای ۸۵-۸۶)

**فاز ۸۵ — بازی‌های تازه (از ایده‌ها)**
- هدف: ۱-۲ بازی تازه با همان قرارداد (موتور خالص + صفحه + store + بک‌آپ + LanPlayable در صورت فیت).
- گیت: الگوی کامل G-waves (موتور spec + صفحه spec + بک‌آپ).
- پایان: بازی(ها) در هاب و قابل‌آنلاین در صورت fit.

**فاز ۸۶ — preset سختی + قهرمانان**
- هدف: صدور/ورود preset سختی per-game (JSON)؛ جدول قهرمانان LAN روی هاست.
- گیت: spec صادرات/ورود + سوئیت.
- پایان: چالش دوستان با فایل preset.

---

## بلوک E — پلتفرم (فازهای ۸۷-۹۰)

**فاز ۸۷ — بیلد portable zip**
- هدف: خروجی zip بدون نصب (همان dist + exe + منابع) کنار NSIS؛ بوت بدون رجیستری.
- فایل‌ها: `src-tauri/tauri.conf.json` (bundle targets) یا اسکریپت پس‌ازبیلد.
- گیت: zip ساخته/اجرا می‌شود.
- پایان: نسخهٔ portable قابل‌توزیع.

**فاز ۸۸** ✅ (e27f3d2 + `winget validate` exit 0 — زودتر از موعد، در جریان بلوک A اجرا شد) — **manifestهای winget + scoop با انتشار خودکار.** (انجام‌شده: `packaging/winget/0.28.1/` سه‌فایلی با schema 1.9.0 (id `ParallelType.ParallelType`، Moniker `paralleltype`، InstallerType nullsoft، Silent `/S`، InstallerSha256 **واقعیِ artifact منتشرشده** = 9017326b…؛ `DefaultLocale` در version manifest — winget 1.29 بدون آن رد می‌کند؛ هشدارهای «Schema header not found» با سرآیند `yaml-language-server` صفر شدند) + `packaging/scoop/paralleltype.json` (checkver روی latest.json، autoupdate از sidecar `…setup.exe.sha256`)؛ گیت: `winget validate --manifest packaging/winget/0.28.1` → **exit 0** (winget لوکال v1.29.380). **انتشار خودکار با فاز ۶۳**: استپ تازهٔ release.yml — از artifact واقعی SHA256 می‌گیرد، هر سه yaml + scoop json + sidecar برای نسخهٔ تازه می‌سازد، روی runner اگر winget بود validate می‌کند (exit 40=هشدار قبول؛ بقیه fail) و پنج فایل را به release می‌چسباند. **نکات ساخت**: here-stringهای pwsh داخل `run: |` نمی‌گنجند (closer باید ستون صفر باشد → block scalar می‌شکند) → همان الگوی `node -e` در bash؛ JS داخل `node -e` argv را از index 1 دارد نه 2 (برخلاف script-file) — تست لوکال با `node -e "$(cat gen.js)"` عین semantics وردفلو شد؛ و درس تکراری «bash heredoc محتوای بزرگ را خراب می‌کند» دو بار دیگر چشید → اسکریپت‌ساز با Write tool. README: ردیف package managers انگلیسی + ردیف ۴ فارسی (نام فایل 0.28.0 در ردیف فارسی version-agnostic شد). **پایانِ «winget install ParallelType»** به PR در winget-pkgs (کامونی — نیازمند CLA حساب کاربر؛ قدم بیرونی بعدی) گره خورده — تا آن‌روز `winget install --manifest` و `scoop install <url>` راه‌های فعال‌اند. push هر دو ریموت.)

**فاز ۸۹ — احیای لینوکس**
- هدف: بیلد deb/pkg.tar.zst جدید (GTK/WebKit deps در CI از فاز ۵۱ موجود) + CI job لینوکس.
- گیت: آرتیفکت لینوکس در CI سبز.
- پایان: توزیع لینوکس برگردد.

**فاز ۹۰ — کانال آپدیت stable/beta**
- هدف: دو endpoint (latest.json / beta.json) + انتخاب کانال در Settings؛ beta فقط از pre-release می‌خواند.
- فایل‌ها: `tauri.conf.json` (endpoint), Settings UI, ریلیز workflow.
- گیت: تست دو کانال روی دو نصب.
- پایان: کاربر کانال را عوض کند و بوت beta بگیرد.

---

## بلوک F — UX و پولیش (فازهای ۹۱-۹۶)

**فاز ۹۱ — جلسهٔ شورای UX/ساختار (اجرای ثبت‌شده)**
- هدف: اجرای جلسهٔ ثبت‌شده — audit تک‌تک صفحات (منوها/دکمه‌ها/عناصر) با ورودی IDEAS_BACKLOG و KIها → خروجی: فازبندی ۹۲-۹۶ دقیق‌شده (agent-executable).
- گیت: سند جلسه + فازهای نهایی‌شده.
- پایان: فازهای UX دقیق و بدون ابهام.

**فازهای ۹۲-۹۶ — خروجی جلسه ۹۱ (پیش‌ثبت با کاندیداهای شناخته‌شده؛ جلسه ۹۱ قفل می‌کند):**
- **۹۲ — ویرایشگر تم کاربر** + صادرات/ورود JSON.
- **۹۳ — پک‌های صدا** (scheme تعویض‌پذیر + پیش‌شنود).
- **۹۴ — پاس RTL نهایی** (هر صفحه یک‌بار با چشم تازه + گیت رگرسیون).
- **۹۵ — accessibility** (high-contrast، keyboard-only کامل، aria sweep).
- **۹۶ — onboarding اولین اجرا** (۵ مرحله تعاملی + چیدمان شخصی صفحه اصلی).

---

## بلوک G — گیمیفیکیشن (فازهای ۹۷-۹۹)

**فاز ۹۷ — نشان‌ها/achievements**
- هدف: معیارهای خالص (WPM/استریک/بازی‌ها) → نشان‌ها با UI کابینت + استور.
- گیت: spec معیارها + سوئیت.
- پایان: کابینت نشان‌ها کار می‌کند.

**فاز ۹۸ — استریک چندبعدی**
- هدف: استریک روزانه/هفتگی/per-game یکجا با نمایش واحد.
- گیت: spec + سوئیت.
- پایان: صفحهٔ استریک یکپارچه.

**فاز ۹۹ — streamer mode + کد چالش**
- هدف: فونت غول‌آسا/overlay برای استریم؛ کد چالش (seed قابل‌اشتراک برای دوستان).
- گیت: spec + سوئیت.
- پایان: هر دو قابل‌فعال‌سازی.

---

## بلوک H — مهندسی پایانی (فاز ۱۰۰)

**فاز ۱۰۰ — پروفایل و بازنگری ساختار**
- هدف: پروفایل startup/حافظه (بودجه‌بندی: بوت < ۲s)؛ بازنگری چیدمان فولدرها (موتورها/صفحات یکنواخت)؛ حذف کد مرده.
- گیت: گزارش پروفایل + بازسازی‌های امن با گیت کامل.
- پایان: بودجه‌ها ثبت و رعایت.

---

## نقشهٔ وابستگی (خلاصه)

- ۵۷ → ۵۸ → ۵۹ (strictness زنجیره است).
- ۷۷ → ۷۸، ۷۹، ۸۴ (pipe v2 پیش‌نیاز موج آنلاین ۲).
- ۶۰ → ۷۷ (e2e پیش از pipe v2).
- ۶۱ → ۶۲ (یافته‌ها → پولیش).
- ۹۱ → ۹۲-۹۶ (جلسهٔ UX فازهای بعدش را قفل می‌کند).
- بقیهٔ فازها مستقل‌اند و ترتیب درون بلوک فقط پیشنهادی است.

## ترتیب اجرای پیشنهادی (بدون محدودیت — فقط وابستگی‌ها اجباری‌اند)

A (۵۶→۶۵) → B (۶۶-۷۲) → C (۷۷-۸۴) → D (۸۵-۸۶) → E (۸۷-۹۰) → F (۹۱-۹۶) → G (۹۷-۹۹) → H (۱۰۰)
بلوک‌های B/E/F/G بین خودشان قابل‌جابه‌جایی‌اند؛ C فقط بعد از فاز ۶۰.