# Arch Linux packaging (B13) — وضعیت و راهنما

**وضعیت: آماده‌سازی‌شده، هنوز روی Arch واقعی تست نشده است.** cross-build لینوکس از ویندوز ممکن نیست؛ اعتبارسنجی نیازمند یک محیط Arch (ماشین واقعی، VM یا chroot) است.

## فایل‌ها
- `PKGBUILD` — بسته‌ی `monkeytype-desktop` (نسخه همگام با نسخه دسکتاپ)
- `monkeytype-desktop.desktop` — ورودی دسکتاپ

## وابستگی‌های کلیدی Tauri روی Arch
- `webkit2gtk-4.1` و `gtk3` (depends) — روی Arch موجودند.
- `rust`، `clang`، `pkg-config`، `nodejs>=24`، `pnpm` (makedepends).
- نسخه‌ی Node: مخازن Arch بسته‌ی `nodejs` را با نسخه‌ی جاری می‌دهند؛ اگر <24 بود، از AUR (`nodejs-lts-jod`/`nodejs-current`) یا nvm استفاده کنید.

## مراحل اعتبارسنجی روی Arch
1. از ریشه‌ی مخزن یک tarball بسازید: `git archive --format=tar.gz -o monkeytype-desktop-0.4.0.tar.gz HEAD` (یا هر snapshot).
2. `makepkg -g` برای محاسبه‌ی sha256 و قرار دادن آن در PKGBUILD.
3. `makepkg -si` — بیلد کامل (vite + cargo) و نصب.
4. تست‌های دستی معادل ویندوز: اجرا، تمرین تایپ، history بعد از restart، hotkey (روی لینوکس مسیر ثبت global shortcut از طریق `global-hotkey` crate است — در محیط‌های Wayland ممکن است محدودیت داشته باشد؛ X11 را اول تست کنید)، tray (روی GNOME افزونه‌ی AppIndicator لازم است)، backup/restore.
5. نتیجه را در SoftwareRelease ثبت کنید.

## نکته‌های شناخته‌شده
- `options=(!strip)` گذاشته شده چون Cargo خودش strip می‌کند (profile.release با strip=true).
- روی Wayland، آیکون tray و موقعیت پنجره ممکن است تفاوت داشته باشد؛ اگر `webkit2gtk` کرش کرد، ابتدا `WEBKIT_DISABLE_COMPOSITING_MODE=1` را امتحان کنید (مشکل شناخته‌شده‌ی Tauri روی برخی درایورها).
- CLI داخلی اپ (`ctrl+shift+p`) و همه‌ی قابلیت‌ها platform-agnostic هستند.
