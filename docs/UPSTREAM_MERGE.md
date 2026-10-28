# فرایند دریافت تغییرات آپ‌استریم Monkeytype (B9)

این فورک از Monkeytype 26.43.0 (کامیت `a1dd550f`) مشتق شده. Monkeytype تقریباً هفتگی تغییر می‌کند؛ این سند روند merge بدون از دست دادن هویت دسکتاپ را ثبت می‌کند.

## ۱. وضعیت فورک نسبت به آپ‌استریم

- اسنپ‌شات pristine: کامیت `d0a5b11` (دقیقاً آپ‌استریم).
- تمام تغییرات فورک روی همین تاریخچه به‌صورت کامیت‌های جدا اعمال شده — `git log d0a5b11..HEAD` فهرست کامل تغییرات را می‌دهد.
- فایل‌های تغییر یافته (تا 0.5.2) — این‌ها تنها نقاط احتمالی conflict هستند:
  - `frontend/src/ts/utils/local-persistence.ts` (جدید)
  - `frontend/src/ts/collections/results.ts`
  - `frontend/src/ts/db.ts`، `frontend/src/ts/ready.ts`
  - `frontend/src/ts/test/test-logic.ts`
  - `frontend/src/ts/router/routes.ts`، `frontend/src/ts/router/app-router.ts`
  - `frontend/src/ts/components/layout/header/Logo.tsx` (ری‌برند)
  - `frontend/src/ts/components/pages/account/*` (AccountPage/VerifyNotice/MyProfile)
  - `frontend/src/ts/components/pages/profile/UserDetails.tsx`
  - `frontend/src/ts/utils/{json-data,version,screenshot}.ts`، `frontend/src/ts/ape/server-configuration.ts`
  - `frontend/src/ts/elements/psa.tsx`، `frontend/src/ts/cookies.ts` (مودال کوکی)
  - `frontend/src/ts/index.tsx`، `frontend/src/ts/constants/default-config.ts`، `frontend/src/ts/constants/default-result-filters.ts`
  - `frontend/src/ts/constants/{default-snapshot,languages}.ts` (فقط بخش‌های مشخص)
  - `frontend/src/index.html`، `frontend/vite.config.ts`
  - `frontend/src-tauri/**` (مستقل از آپ‌استریم)
  - `packaging/arch/**`، `frontend/__tests__/utils/local-persistence.spec.ts`، `app-shell.spec.tsx` (mock)
- فایل‌های حذف‌شده: زبان‌های غیر en/fa/code (assets) — merge زبان‌های جدید آپ‌استریم را نادیده بگیرید یا اضافه نکنید.
- `firebase-config-live.ts` و `pt-logo-paths.json` فایل‌های فورکی tracked هستند.

## ۲. روند merge (هر انتشار آپ‌استریم)

```bash
git remote add upstream https://github.com/monkeytypegame/monkeytype.git   # یک‌بار
git fetch upstream master
git checkout -b merge-<upstream-version>            # شاخه‌ی تمرین merge
git merge upstream/master                            # یا rebase اگر تمیز بود
```

- Conflictها را با این قاعده حل کنید: **رفتار آفلاین دسکتاپ برنده است** — هر جا آپ‌استریم مسیر ابری را تغییر داد، نسخه‌ی آفلاینِ فورک (فلگ `DESKTOP_OFFLINE`) حفظ شود.
- تغییرات `frontend/src/ts/constants/firebase-config*` و `.gitignore` مربوط به آن را نپذیرید (فایل tracked فورک باید بماند).
- `frontend/src/ts/collections/results.ts` و `db.ts` را با دقت مرج کنید — هسته‌ی persistence فورک آنجاست.
- اگر `packages/schemas/src/languages.ts` زبان جدید اضافه کرد: هیچ کاری لازم نیست (enum دست‌نخورده است؛ زبان جدید فقط در UI تا زمان افزودن asset نمایش داده نمی‌شود).

## ۳. چک‌لیست پس از merge (الزامی)

1. `pnpm install` (در شبکه‌ی پایدار) و `pnpm build-fe` بدون خطا.
2. `pnpm -C frontend exec vitest run` — کل مجموعه؛ وضعیت flake شناخته‌شده (KI-09) را نادیده بگیرید.
3. بیلد ویندوز + اجرا + تست دودی (بوت، تمرین، history، tray).
4. بیلد Arch در distro WSL `ParallelType-Arch` + نصب + اجرا.
5. اگر آپ‌استریم تغییر ساختاری در auth/results داد: پیوست A سند مهاجرت را بازبینی کنید.

## ۴. سیاست

- mergeها روی شاخه‌ی جدا انجام و پس از چک‌لیست به master fast-forward شوند.
- هر merge با یک ورودی در بسته‌ی SoftwareRelease نسخه‌ی جدید مستند شود.
