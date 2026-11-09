# فازبندی Online Games (LAN دو نفره) — شورا 2026-11-08

## قرارهای مالک (تأییدشده)
1. **Discovery: UDP broadcast** + fallback دستی (IP + کد session)؛ mDNS نه.
2. **اولین بازی online: bot-duel** — RemotePacer جایگزین BotPacer.
3. **نام‌ها: session-only** + pre-fill آخرین نام از localStorage (بدون سیستم هویت).
4. اجرای **عمودی و نازک**: اول pipe کامل (host + اتصال + لابی + bot-duel) با IP دستی، بعد broadcast رویش.
5. **CSP**: `connect-src` باید `ws:` برای LAN باز شود (تغییر fork-owned conf).
6. **متن UI فقط انگلیسی** (قاعده ماندگار).
7. بدون سرور خارجی — فقط LAN؛ bind روی اینترفیس محلی؛ session code ۴ حرفی.

## معماری

### Rust side (src-tauri — اولین لایه backend فورک)
- **UDP beacon**: هر ۱ ثانیه روی پورت 51987 broadcast: `{app:"paralleltype-lan", name, sessionId, code, wsPort, gameId}`.
- **UDP listener**: همان پورت؛ announcementهای دریافتی → event به فرانت (`lan://discovered`).
- **WebSocket host** (tokio-tungstenite): `ws://0.0.0.0:<port>`؛ یک کلاینت؛ پروتکل JSON.
- **فرمان‌های Tauri**: `lan_start_host(name) -> {port, code, sessionId}`، `lan_stop_host()`، `lan_start_discovery()`، `lan_stop_discovery()`، `lan_get_discovered() -> [...]`، `lan_get_local_ip() -> string`.
- **Eventهای Tauri**: `lan://discovered`، `lan://peer-joined`، `lan://peer-left`، `lan://message`.

### پروتکل پیام (JSON — فرانت relay می‌کند، Rust فقط pipe)
```
→ {type:"join", name, code}          ← host: {type:"joined", sessionId}
→ {type:"start", gameId, words[], params}   (host می‌سازد، برای هر دو یکسان)
→ {type:"progress", wordIndex, correctChars, finished:false}
→ {type:"finished", finishMs, acc}
→ {type:"rematch"} / {type:"leave"}
```
- اعتبارسنجی ساده هر پیام (type شناخته‌شده، سایز < 64KB)؛ اتصال نامعتبر → close.

### Frontend
- `states/lan.ts`: سیگنال‌ها (role host/join، connection state، discovered sessions، peer progress) + شنونده eventهای Tauri.
- `OnlineLobbyPage` (بلوک Online فعال می‌شود): Host a match / Join (لیست زنده کشف‌شده‌ها + ورود دستی IP:port) + نام (pre-fill) + کد session.
- `BotDuelPage`: اگر LAN match armed → RemotePacer (همان interface BotPacer؛ از progressهای relayed تغذیه می‌شود) + banner «online vs <name>».
- کلمات duel: **host می‌سازد** (buildRaceWords از pool زبان) و در `start` می‌فرستد — استریم یکسان بدون نیاز به seed.

## فازها (۶ فاز — عمودی نازک)

### فاز ۱ — Rust: host + اتصال + لوله
- WS server + accept یک کلاینت + echo relay + فرمان‌های host/stop + `lan_get_local_ip`.
- DoD: از فرانت (evaluate) یک WS به localhost باز شود و پیام رفت‌وبرگشت شود.

### فاز ۲ — Frontend: لابی + اتصال دستی
- `states/lan.ts` (اتصال/role/پیام‌ها) + `OnlineLobbyPage` (نام pre-fill، Host، Join دستی IP:port، کد).
- بلوک Online فعال می‌شود (بدون broadcast هنوز — Join دستی).
- DoD: دو پنجره اپ — یکی host، یکی join → لابی هر دو «connected» را نشان دهد.

### فاز ۳ — UDP broadcast discovery ✅ (ca8da1c)
- beacon + listener + لیست زنده کشف‌شده‌ها در لابی + پیام خطای واضح در AP isolation (fallback دستی همان‌جا).
- DoD: دو اپ روی یک ماشین (host) + یک ماشین دیگر (client) همدیگر را در لیست ببینند.
- انجام‌شده: beacon هر ۱ ثانیه روی UDP 51988 (با شروع client متوقف)؛ listener با prune ۵ ثانیه‌ای + skip سشن خودی + drop تگ اپ بیگانه؛ دستورهای `lan_start_discovery`/`lan_stop_discovery`/`lan_get_discovered`؛ لابی: lifecycle دیسکاوری (mount → poll هر ۲ ثانیه → unmount) + لیست nearby با join یک‌کلیکی + hint دستی بعد ۶ ثانیه سکوت. تست‌ها: ۴ تست Rust (parse/own-skip/sender-ip/loopback beacon) + ۲ spec لابی (lifecycle + join یک‌کلیکی)؛ گیت کامل پاس (cargo check/test، vitest 2550، tsc، oxlint صفر روی فایل‌ها، oxfmt). تست دو دستگاه واقعی → فاز ۵.
- نکته: single-instance فعال است → دو اینستنس روی یک ماشین ممکن نیست؛ bind ساده 51988 کافی است (بدون SO_REUSEADDR).

### فاز ۴ — bot-duel online ✅ (177eba2)
- RemotePacer (interface BotPacer) + شروع مسابقه از لابی (host: start → هر دو به bot-duel با استریم یکسان) + progress relay + پایان با finishMs هر دو.
- انجام‌شده: `utils/bot-duel/remote-pacer.ts` (همان interface BotPacer؛ anchor از progressهای relay شده + extrapolation با سرعت مشاهده‌شده تا 25cps؛ finishMs زنده — تا رسیدن finished حریف Infinity)؛ `states/lan-match.ts` (پروتکل start/progress/finished/rematch + root effect — هر صفحه‌ای که باز باشد، start مسابقه را arm و به bot-duel می‌برد)؛ صفحه: بنر «online vs»، countdown با arm، رله progress per-word، فاز awaiting تا اتمام حریف، داوری با مقایسه دو finishMs (فریم‌های هم‌تراز در حد یک RTT)، margin + acc حریف، rematch (کلاینت درخواست/هاست با همان کلمات re-send)، قطع‌شدن → void بدون ثبت (مسابقه آنلاین هرگز store محلی/گانتلت را نمی‌نویسد)؛ لابی: هاست طول مسابقه را انتخاب و کلمات را در start می‌فرستد؛ کلاینت «waiting for the host»؛ مسیر `/games/online` ثبت شد و بلوک Online لندینگ فعال (بج beta). تست‌ها: ۶ تست RemotePacer + ۷ تست lan-match + ۴ تست صفحه آنلاین (برده/باخت/rematch/قطع) + ۲ تست لابی/لندینگ؛ گیت کامل پاس (vitest 2568، tsc، oxlint صفر، oxfmt).
- نکته: sync شروع در حد یک RTT است (هر دو countdown یکسان را پس از رسیدن start اجرا می‌کنند) — داوری نهایی با اعدادِ finishMs در فریم‌های هم‌تراز، نه ساعت دیواری.
- DoD: دوئل واقعی دو نفره روی LAN — برنده درست، margin، rematch.

### فاز ۵ — hardening ✅ (8e8b53a)
- قطع‌شدن وسط مسابقه → void بی‌ثبت + پیام؛ leave/rematch؛ اعتبارسنجی پیام‌ها؛ بررسی فایروال/پرامپت ویندوز؛ تست عملی دو دستگاه واقعی.
- انجام‌شده: **join ack واقعی** — هاست بعد از اعتبارسنجی کد `{type:"joined", name}` می‌فرستد و کلاینت تا ۵ ثانیه منتظرش می‌ماند (رفع باگ «connected vs نام خودم» در کلاینت)؛ هاست بعد از ۱۰ ثانیه بدون join معتبر اسلات را آزاد می‌کند؛ **اعتبارسنجی رله** — هر پیام باید آبجکت JSON با type رشته‌ای باشد، تخلف → قطع اتصال (سمت هاست و کلاینت)؛ task خواندن کلاینت هنگام disconnect aborted می‌شود؛ شنونده discovery با SO_REUSEADDR bind می‌شود (اشتراک پورت broadcast با دیاگنوستیک/اینستنس دوم). **فرانت**: خروج وسط مسابقه (header back) → finished(null) برای حریف + پاک‌سازی؛ رهاکردن لابی با اتصال بلااستفاده → قطع (اتصالِ حامل match مسلح زنده می‌ماند)؛ cell دقت حریف در نتیجه. **باگ بیلد ریسپانسیو**: fa-plug-circle-check آیکون FA6 بود و سابست FA5 نداشت → fa-plug. **تست real-shell ۹/۹**: exe بسته‌بندی‌شده با درایور CDP + همتای جعلی node — beacon بیگانه در لیست لابی، دریافت beacon اپ توسط شنونده node، join→ack→connected vs NODE2، start با ۳۰ کلمه از HOST1، progress+finished آنی → «NODE2 wins» + دقت ۹۵٪. تست‌های واحد: ۷ Rust (اعتبارسنجی/ack/reject) + ۲ spec جدید (خروج وسط مسابقه، رهاکردن لابی)؛ گیت کامل پاس (vitest 2570، tsc، oxlint صفر، oxfmt).
- **فایروال ویندوز** (برای release-notes فاز ۶): اولین اجرا پرامپت فایروال می‌دهد — «Allow on private networks» برای discovery لازم است؛ با بستن پرامپت، join دستی IP هنوز کار می‌کند (TCP معمولاً در پرامپت پوشش داده می‌شود).
- **تست دو دستگاه واقعی** به مالک موکول شد (single-instance مانع دو اینستنس روی یک ماشین است) — سناریو: دو دستگاه روی یک Wi-Fi → لابی دستگاه اول Host، دستگاه دوم از nearby list یک‌کلیکی join → دوئل → نتیجه دو طرف یکسان. fallback: IP+code دستی.

### فاز ۶ — انتشار ✅ (b339523/c35940e — نسخه 0.26.0)
- sweep انگلیسی + مستندات (known-issues/changelog/manifest) + گیت کامل + ریبیلد نهایی.
- انجام‌شده: sweep فارسی در ۱۲ فایل LAN → صفر؛ bump نسخه 0.25.0→0.26.0 (tauri.conf.json + Cargo.toml + Cargo.lock با socket2)؛ **بیلد کامل امضادار**: `npx tauri build` با کلید آپدیتر → `ParallelType_0.26.0_x64-setup.exe` (16.18 MiB، SHA256 `3091d0a3…e02c`) + `.sig` (SHA256 `f97412d2…78c0d1`)؛ **اسناد کامل** در `SoftwareRelease/versions/0/26/0/` (۱۰ سند + manifest با lockfile hash — validator پاس: 27 پوشه)؛ ردیف 0.26.0 در `releases/README.md`؛ KI-48 (تست دو دستگاه) ثبت شد؛ یادداشت فایروال در release-notes/manifest؛ دو بسته‌شده: آیکون FA6 (شکست بیلد) و نام خودی کلاینت؛ گیت نهایی: **۲۵۷۰/۲۵۷۰** + tsc صفر.
- نکته فرایند: هوک pre-commit با «صفر فایل قالب‌پذیر» خطا می‌دهد — کامیت‌های مکانیکی lock/README با `--no-verify` مستندشده.
- **طرح LAN کامل شد: ۶/۶ فاز.** مانده فقط LAN-2DEV (تست دو دستگاه واقعی توسط مالک) در بک‌لاگ.

## ریسک‌های ثبت‌شده
- **AP isolation** روی Wi-Fi عمومی → discovery ناموفق؛ fallback دستی + پیام واضح.
- **فایروال ویندوز** اولین اجرا پرامپت می‌دهد (Rust listener) — مستند در release-notes.
- **CSP** باید قبل از فاز ۲ باز شود؛ وگرنه اتصال ws بلاک می‌شود.
- نام‌ها/مسابقه هرگز persisted نمی‌شوند (همان قاعده بازی‌ها).
