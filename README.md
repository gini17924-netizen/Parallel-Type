<p align="center">
  <img src="banner.svg" alt="ParallelType — a Persian desktop typing fork" width="800"/>
</p>

# ParallelType — پارالل‌تایپ

**فارسی:** دسکتاپ فارسیِ تایپ‌تست — فورک Tauri نسخهٔ [monkeytype](https://github.com/monkeytypegame/monkeytype) (GPL-3.0). دو تمرین فارسیِ اختصاصی (keybr فارسی و smart drill)، نقطه‌گذاری سفارشی، Year Wrapped، ۲۴ بازی دسکتاپ، چالش روزانه — و **موج آنلاین کامل: ۲۰ بازی دو نفره روی LAN بدون هیچ سرور خارجی** + اولین versus واقعی (type-pong با state-sync).

**English:** a Persian desktop fork of monkeytype, built on Tauri — offline-first typing practice with Persian-specific drills, 24 desktop games, and a complete online wave: **20 head-to-head games over LAN with no external server**, including the first real versus (authoritative-host type-pong with snapshot state-sync at 20/s).

## دانلود / Download

- نصب‌کننده امضادار ویندوز: [Releases](https://github.com/gini17924-netizen/Parallel-Type/releases/latest)
- آپدیتر داخل اپ فعال است (endpoint: `releases/latest/download/latest.json` از همین ریپو).
- ⚠️ فایروال ویندوز در اولین اجرای آنلاین پرامپت می‌دهد — «Allow on private networks».

## موج آنلاین در یک نگاه / The online wave

| الگو | بازی‌ها | داوری |
|---|---|---|
| **R** — مسابقه seeded تا هدف | Sky Climber، Endless Runner، Nitro Run، Maze Runner | زمان خط پایان |
| **S** — امتیاز-مسابقه (۱۲ بازی) | Word Blast، Sprint، Ghost GP، Split Duel، Stack Attack، Balloon Pop، Pair Keys، Wordle، Type Snake، Letter Strike، Lane Defense، Fruit Slash، Firefight، Crane، Beat Keys | امتیاز/مرگ/هورن/بقا — per-game |
| **H** — hot-seat → LAN | Bot Duel | پیس‌ساز ریموت، finishMs |
| **V** — versus واقعی | Type Pong | موتور authoritative روی هاست + snapshot 20/s؛ بازی تا N |

- اتصال از لابی `/games/online`: UDP broadcast discovery + join با یک کلیک (fallback دستی ip+code).
- استریم‌های seeded مشترک (بدون ارسال کلمات) — هر دو ماشین همان محتوا را می‌بینند.
- مسابقه آنلاین هرگز آمار محلی را نمی‌نویسد؛ قطع/خروج/تب‌سوییچ → void.

## ساخت از سورس / Build from source

```bash
pnpm install
npm run build          # madge + ts-check + vite
npx tauri build        # NSIS + updater signature (TAURI_SIGNING_PRIVATE_KEY لازم است)
```

- گیت‌ها: `npx tsc --noEmit` + `npx vitest run` + oxlint (هر دو کانفیگ) + `cargo test` در `frontend/src-tauri`.
- سناریوی تست دو دستگاه: `TEST_RUN_2_DEVICES.md` (در ریشه ورک‌اسپیس).

## اعتبار / Credits

- آپ‌استریم: [monkeytype](https://github.com/monkeytypegame/monkeytype) — این فورک تحت همان **GPL-3.0** منتشر می‌شود؛ تمام تغییرات در تاریخچه گیت باز است.
- فونت فارسی: Vazirmatn. صدای آپ‌استریم و همه اعتبارهای سوم‌شخص طبق LICENSE باقی است.
