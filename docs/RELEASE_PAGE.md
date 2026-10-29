# صفحه‌ی ریلیز ParallelType (الگوی توزیع — B7 تکمیل)

**تاریخ:** 2026-10-28 | **نسخه‌ی الگو:** 0.6.1 | **وضعیت:** آماده برای میزبانی؛ انتشار عمومی نیازمند تصمیم نهایی B7

## ۱. محتوای صفحه‌ی ریلیز (الگوی هر نسخه)

هر ریلیز باید شامل این‌ها باشد (فولدر `updates/` میزبان = الگوی آماده):

| فایل | نقش |
|---|---|
| `ParallelType_x.y.z_x64-setup.exe` | نصب‌کننده ویندوز (NSIS) |
| `ParallelType_x.y.z_x64-setup.exe.sig` | امضای آپدیت (minisign با کلید `C:\WSL\paralleltype-updater.key.pub`) |
| `updates.json` | مانیفست آپدیت‌کننده (version/notes/pub_date/platforms/signature/url) |
| `source-code.tar.gz` | **الزام GPL-3.0 بند ۶:** snapshot دقیق کامیت همان نسخه (`git archive`) |
| `LICENSE` | متن GPL-3.0 |

## ۲. updates.json (تولیدشده و تست‌شده در 0.6.0→0.6.1 E2E)

```json
{
  "version": "x.y.z",
  "notes": "خلاصه‌ی ریلیز",
  "pub_date": "ISO-8601 UTC",
  "platforms": {
    "windows-x86_64": {
      "signature": "<محتوای فایل .sig>",
      "url": "https://<host>/ParallelType_x.y.z_x64-setup.exe"
    }
  }
}
```

تولید خودکار پس از هر بیلد ویندوزی: `updates/make-updates-json.py` (ورودی: نسخه، مسیر sig) — endpoint در `tauri.conf.json → plugins.updater.endpoints` (یک نقطه‌ی تغییر).

## ۳. نتیجه‌ی license-checker (39 پکیج production)

- 33 MIT، 2 ISC، 1 BSD-2-Clause، 1 CC0-1.0، 1 Apache-2.0 — بدون مانع.
- **1 استثنا: `@leonabcd123/modern-caps-lock` = GPL-3.0-or-later** — با GPL-3.0 کل محصول سازگار است (copyleft همسو) ✓. خروجی کامل: `docs/DEPENDENCY_LICENSES.txt`.

## ۴. چک‌لیست انتشار عمومی (قبل از اولین ریلیز عمومی)

1. تکمیل بازبینی GPL: `docs/GPL_COMPLIANCE.md` (باقی: صفحه‌ی ریلیز منبع + license-checker در ریلیز) ✓ این سند.
2. میزبانی HTTPS (GitHub Releases کافی است — updater فقط به endpoint در tauri.conf اشاره می‌کند).
3. حذف `dangerousInsecureTransportProtocol` — اکنون حذف شده ✓ (فقط برای تست محلی بود).
4. امضای Authenticode نصب‌کننده (اختیاری، جدا از updater signing).
5. ذکر صریح در ریلیز: «Based on Monkeytype — GPL-3.0» + لینک منبع.
