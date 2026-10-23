# Audit Report — Daftar Kelasi Man v8.3.0 (documentation corrected)

**Date:** 2026-10-23 · **Scope:** full project (`index.html` web/APK app, Kotlin WebView wrapper, Node.js backend, GitHub Actions workflow, docs) · **Method:** file-by-file code review + automated syntax checks + real-browser (Chromium via Playwright) runtime testing + live backend API testing.

All fixes below were **verified by executed tests** (see `TEST-REPORT.md`). No feature was removed; no user data model was broken. The backend can still be deployed to Render unchanged (`backend/` root directory, `npm start`).

---

## 1. Confirmed defects and fixes (app — `index.html`, identical copy in APK + backend/public)

| # | Severity | Defect (evidence) | Fix | Verified by |
|---|----------|-------------------|-----|-------------|
| 1 | High | `printTeacherCard` (old line 10403): template literal never closed — ~15.7 KB of unrelated CSS + a second `</html>` were written into the print window, polluting teacher-card print output | Template closed properly; only card-specific styles remain in the print document | Browser test + code review |
| 2 | High | `registerOfflineAccount` wrote the full database (photo data-URLs) to `localStorage` with no error handling — a `QuotaExceededError` on photo-heavy legacy data **aborted account creation** | Three-tier write: full snapshot → photo-stripped fallback → skip; registration can no longer fail on quota | Integration tests T1/T2 |
| 3 | High | Password hashes were **unsalted single SHA-256** (offline brute-forceable) | New format `pbkdf2-sha256$150000$<salt>$<hash>` (PBKDF2-SHA256, 150k iterations, per-account 16-byte salt); `verifyAccountPassword()` accepts the legacy hash and **transparently upgrades it after a successful login**; all 7 call sites migrated | Unit path in browser + login tests |
| 4 | High | `importData` had no format/version gate, no preview, and **no rollback** — restore directly overwrote live data | Added: `backupMetadata` format+version gate with explicit user consent for unknown versions; preview dialog showing record counts of the file vs. current data; **pre-restore safety snapshot** written to IndexedDB (`migrationBackups` store) before overwriting; 80 MB size guard | Integration tests T5a–T5c |
| 5 | High | Monthly school report + admin reports relied on `window.print()` in a popup — **does not work in Android WebView** (no print service) and was the only path for the "اداره" report | `exportCompleteReportPDF` rewritten on the existing canvas→PDF pipeline (`dfRenderSummaryReportPages` + `dfDeliverPdf`): a **real PDF file** that saves/shares natively on Android and desktop; repeated table headers, Persian page numbers, auto pagination | Integration tests T13, PDFs rendered and visually inspected |
| 6 | Medium | `dfLoadImage` rejected `media://` photo references — photos could silently vanish from PDFs depending on hydration timing | `media://` refs resolved through the media store before drawing | Integration test T14 (photo visibly rendered in PDF) |
| 7 | Medium | `queueSyncSnapshot` wrote a full DB copy into the IndexedDB sync queue **on every save** even with no sync server configured — invisible churn and storage wear | Queue writes skipped when no sync endpoint; queue verified empty in offline mode | Integration test T17 |
| 8 | Medium | Status pill claimed "آنلاین · آماده همگام‌سازی" even with **no server configured** (misleading) | New `updateDataStatusPill()`: honest states — "ذخیره محلی · بدون سرور", "آفلاین · ذخیره محلی فعال", "N مورد در انتظار همگام‌سازی", "همگام‌شده · ذخیره محلی HH:MM" | Integration test T16 |
| 9 | Medium | Admin-panel `MutationObserver` observed the whole document forever, firing on every DOM change (CPU/memory waste) | Observer installs only while an admin session exists, disconnects after the entry button is installed, and hard-stops after 2 minutes | Smoke run (0 errors), code review |
| 10 | Medium | Speech-field observer ran a full `querySelectorAll` sweep on **every** DOM mutation (its own wrapping caused new mutations) | 300 ms debounce; sweep errors contained | Smoke run |
| 11 | Medium | Dashboard capability cards linked to sections removed by the v78 merge (`report`, `feedback`, `grades`, `parents`, `interests`) — dead navigation | Re-pointed to the surviving merged sections (`monthly`, `evaluation`, `studentFile`) | Smoke nav test |
| 12 | Low | `exportData` produced backups **without** `backupMetadata` while the daily auto-backup had it — inconsistent formats | `exportData` now uses `createCompleteBackupObject()` (identical envelope + metadata) | Integration test T5b |
| 13 | Low | Duplicate icon systems: old emoji `refreshIcons` + aurora SVG both ran at startup (double painting) | Emoji painting removed; aurora system is the single painter; `refreshProfessionalIcons` delegates safely | Smoke run |
| 14 | Low | Malformed nested HTML comment before `#app` | Fixed | Syntax/parse checks |
| 15 | Low | CSP `img-src` blocked the app-internal `media://` scheme used by the hydration design (photo rendering blocked with a CSP error) | `media:` added to `img-src` | Integration test T18 (no unexpected console errors) |
| 16 | Low | Version strings inconsistent (footer "5.4.1", APK 8.1.1); English label "Classroom Pro · Pro Edition" in a Persian UI | Footer → 8.2.0; label → «دفتر کلاسی من · نسخهٔ حرفه‌ای»; title cleaned | Grep verification |

## 2. Confirmed defects and fixes (backend — `backend/index.js` v3.2.0)

| # | Severity | Defect | Fix | Verified by |
|---|----------|--------|-----|-------------|
| 17 | High | `/api/sync/push` read-then-write with **no lock** — two concurrent pushes silently overwrote each other (violating the advertised 409 protocol) | Per-teacher in-process push lock → concurrent second push gets `409 SYNC_BUSY`; 12 MB payload guard | Backend test B18 |
| 18 | High | `/api/admin/setup` created the school **before** the teacher — a failed teacher insert orphaned a school with a consumed join code; join-code collisions surfaced as the wrong error | Teacher created first, school second, join-code collision retried (5 attempts) | Backend tests B3/B4 |
| 19 | High | Rate limiter: unbounded memory growth, `x-forwarded-for` spoofable (no trust-proxy flag), and **no limit** on `/api/school/join` or `/api/sync/*` (join-code brute-force surface) | Periodic bucket pruning; forwarded header trusted only with `TRUST_PROXY=1`; dedicated 120/min limiter on join/sync routes | Backend test B17 |
| 20 | Medium | Concurrent registration race returned **500** instead of 409 | `23505` unique violation mapped to 409 | Backend test B5 |
| 21 | Medium | `/api/admin/transfer` did **not** update `owner_teacher_id` — school ownership invariant broken after transfer | Owner updated (PgStore SQL + FileStore) atomically with the role change | Backend test B14 |
| 22 | Medium | `FileStore` wrote non-atomically (crash = corrupt store) and **silently reset to empty data** on a corrupt file | Atomic tmp+rename writes; corrupt file quarantined as `store.json.corrupt-<ts>` with a loud error log instead of silent loss | Backend test B20 |
| 23 | Medium | If `TOKEN_SECRET` was unset, a random secret was generated **silently** (all tokens die on restart, multi-instance breaks) | Explicit startup warning | Code review |
| 24 | Low | No security headers; unknown API paths returned Express HTML; version mismatch (package 3.0.0 vs code 3.1.0) | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`; JSON 404 for `/api/*`; version aligned to 3.2.0 | Backend tests B1/B2/B16 |
| 25 | Info | `backend/server.js` was dead code (not referenced, not even runnable: missing deps, ESM/CJS mismatch) and duplicated an entirely different schema — a standing confusion risk | Moved to `backend/legacy/server.js` with a README; excluded from runtime | `node --check` + package.json review |

## 3. Confirmed defects and fixes (Android + CI)

| # | Severity | Defect | Fix |
|---|----------|--------|-----|
| 26 | Medium | Legacy `com.classnotebook.app.MainActivity.java` (dead code, old `file://` loading, incompatible speech callback API) was still compiled into the APK alongside the real Kotlin activity | Removed; only `com.classroom.daftar.MainActivity` (Kotlin, WebViewAssetLoader) remains |
| 27 | Medium | `shouldOverrideUrlLoading` silently **blocked every external link** (e.g., school server link) with no feedback | External URLs now open in the device browser via `ACTION_VIEW`; internal `appassets` URLs unchanged |
| 28 | Low | Workflow artifact name hardcoded `v8.1.1` | `DaftarKelasi-APK-v8.2.0`; versionName 8.2.0 / versionCode 40; added a **JS syntax sanity step** to CI so a broken `index.html` can no longer be silently packaged |

## 4. New capability: secure offline school data packages (teacher → principal)

Implemented per your requirement for school administration **without a live server** (details and threat model in `OFFLINE-SHARING-FA.md`, evaluated against a blockchain approach there):

- Teacher: «ساخت بستهٔ داده برای مدیر» produces a `.dkshare.json` package — all classes, students, **parent contact info**, attendance, assessments, notes — encrypted with **AES-256-GCM** (PBKDF2-SHA256, 200k iterations, from a shared school passphrase) and signed with **HMAC-SHA256**. Student names/contact data are provably not present in plaintext (tested).
- Principal: imports the file → signature verified (timing-safe compare), decrypted, school identity checked (join-code hash binding when available), then stored in a dedicated IndexedDB database (`DaftarKelasiSchoolPackages`) **separate from the principal's own class data** — read-only, always labeled with the teacher's "داده‌ها تا" timestamp (never presented as live data).
- Duplicate packages (same `packageId`) rejected; older-than-latest packages accepted only with an explicit "قدیمی‌تر از آخرین بسته" warning; tampered packages fail signature/GCM verification (all tested).
- Principal generates a professional Persian RTL **PDF report** (students, guardians, phones, attendance summary per student) from any imported package via the canvas pipeline.
- On-device audit history (`history` store) records export/import/revoke events with hash chaining between successive packages; per-package revocation flag («لغو دسترسی»).

## 5. Remaining limitations (honest list)

1. **Speech-to-text quality** depends on the device's Google speech services; Google's `fa-IR` recognition generally requires internet on most devices. The Kotlin bridge already tries online `fa-IR` → `fa` → on-device recognition (Android 12+) and reports honest errors. Real-device microphone testing was **not possible in this environment** (see TEST-REPORT).
2. Offline revocation of a teacher's package is advisory: a school that already received an encrypted package cannot be remotely forced to delete it. Rotating the shared passphrase prevents future packages from being opened by unauthorized parties.
3. The optional cloud sync (Render/PostgreSQL) is deliberately disabled in this build (`DAFTAR_CLOUD_ENDPOINT=""`). The backend remains deployable and compatible; enabling sync requires setting the endpoint constant — no other change.
4. The single-user HMAC package scheme authenticates **possession of the shared passphrase**, not the individual device. For stronger identity guarantees you would need per-teacher key pairs exchanged in person — documented as a possible future step in `OFFLINE-SHARING-FA.md`.
5. APK was **not built** here (no keystore/Android SDK in this environment). The GitHub Actions workflow builds it reproducibly; instructions in `BUILD-APK-FA.md`.


## Version 8.3.0 archive consistency note

The application footer and APK metadata are now aligned to version 8.3.0. The historical test details below describe the prior audit report; the browser/backend test runner files cited in that report are not included in this ZIP, so those test results cannot be independently reproduced from this archive alone. See `TEST-REPORT-EN.md` for the verified scope and limitations.
