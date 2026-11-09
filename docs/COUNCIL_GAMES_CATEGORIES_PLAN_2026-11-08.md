# فازبندی دسته‌بندی بخش Games — شورا 2026-11-08

## قرارهای مالک (تأییدشده)
1. **دو بلوک در همان صفحه Games** (نه دو صفحه جدا): Offline Games + Online Games.
2. **Daily Gauntlet پین بالای صفحه** — خودش دسته نیست.
3. **taxonomy تایید شد به شرط عدم حذف هیچ بازی** — هر ۲۴ ورود باید جایی باشند.
4. **دکمه Online غیرفعال** + برچسب coming soon (راه‌اندازی بعداً).
5. **هیچ متن فارسی در منو/UI** — فارسی فقط محتوای تمرین/بازی است؛ همه متن‌های UI انگلیسی.

## رده‌بندی نهایی (۲۳ بازی در ۶ دسته + ۱ پین)

| دسته | icon | بازی‌ها (۲۳) |
|---|---|---|
| Speed & Race | fa-flag-checkered | word-blast, bot-duel, ghost-gp, sprint, nitro-run |
| Precision & Timing | fa-crosshairs | type-pong, crane, beat-keys, lyric-line |
| Reflex & Survival | fa-bolt | letter-strike, lane-defense, fruit-slash, firefight, sky-climber, endless-runner |
| Memory & Deduction | fa-brain | pair-keys, wordle, deck-runner, balloon-pop |
| Movement & Spatial | fa-map | type-snake, stack-attack, maze-runner |
| Two Players | fa-users | split-duel |
| — (پین) Daily Gauntlet | fa-shield-alt | جدا از دسته‌ها، بنر بالای صفحه |

جمع: ۵+۴+۶+۴+۳+۱ = ۲۳ + daily-gauntlet = **۲۴/۲۴ ✓ هیچ بازی حذف نمی‌شود**
(balloon-pop به Memory & Deduction اضافه شد — ماهیت SRS آن — تا شرط مالک برقرار بماند)

## فازها

### فاز ۱ — لایه داده رده‌بندی ✅ (2026-11-08 — cffa227)
- `utils/games/game-categories.ts`: آرایه دسته‌ها {id, title (انگلیسی), description (انگلیسی), icon, gameIds[]} — همه متن‌ها انگلیسی.
- تست‌ها: هر gameId شناخته‌شده؛ جمع gameIds = ۲۳؛ هیچ تکرار بین دسته‌ها؛ daily-gauntlet عضو هیچ دسته نیست؛ عنوان/توضیح هر دسته انگلیسی (regex بدون حروف فارسی).
- گیت: سوئیت + tsc.

### فاز ۲ — لندینگ Games (دو بلوک) ✅ (2026-11-08 — 0059266)
- GamesPage → نمای لندینگ: بلوک **Offline Games** (دکمه → نمای دسته‌ها) و بلوک **Online Games** (دکمه disabled + coming soon).
- حفظ بازی inline word-blast و مسیرهای موجود؛ هیچ route بازی تغییر نمی‌کند.
- تست صفحه: دو بلوک رندر؛ دکمه Online غیرفعال؛ کلیک Offline → نمای دسته‌ها.
- گیت: سوئیت + tsc.

### فاز ۳ — نمای دسته‌ها ✅ (2026-11-08 — 079216f)
- نمای Offline: بنر پین‌شده Daily Gauntlet بالای صفحه (کارت کامل با streak) + ۶ دسته با کارت‌های بازی (icon/title/description از app-structure).
- ناوبری برگشت به لندینگ.
- تست: ۶ دسته رندر؛ تعداد کارت‌ها = ۲۳ + بنر؛ مهر daily-gauntlet.
- گیت: سوئیت + tsc.

### فاز ۴ — پاس نهایی و انتشار ✅ (2026-11-08 — 56af129 + فاز ۵ بصری + ریبیلد 2919af49)
- پاس بصری با اسکرین‌شات در اپ واقعی (چیدمان دو بلوک + دسته‌ها + بنر).
- sweep انگلیسی: هیچ متن فارسی در UI بخش games.
- آپدیت تست‌های ساختار در صورت نیاز؛ گیت کامل + کامیت + در صورت نیاز ریبیلد.

## قاعده ماندگار (ثبت در کد)
- UI/menu text: **English only** — Persian belongs to practice content (word pools, lyrics, learn groups), never to menus.
