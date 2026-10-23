# Test Report — Daftar Kelasi Man v8.3.0 (archive verification)

**Scope of this report:** static verification of the supplied v8.3.0 ZIP only. The browser and backend test runner files referenced in the historical v8.2.0 report (`integration-tests.js`, `smoke-test.js`, `backend-tests.js`, and `scripts/pdf-sections-test.js`) are not present in this archive. Therefore, their historical PASS results are not claimed as newly executed or independently reproducible for v8.3.0.
**Result codes:** PASS = executed and verified in this review · FAIL = executed and failed · NOT TESTED = not executed or requires an unavailable device/credential.

### Checks executed for this archive

| Check | Result | Evidence |
|---|---|---|
| Root HTML JavaScript syntax | PASS | Parsed inline JavaScript blocks with Node.js `new Function` check |
| Root/site/APK HTML consistency | PASS | SHA-256 equality checked after footer version correction |
| APK version metadata | PASS | `app/build.gradle` declares versionName 8.3.0 and versionCode 41 |
| ZIP integrity | PASS | Archive extracted successfully |
| Full browser integration suite | NOT TESTED | Test runner files are not included in the ZIP |
| PDF visual rendering, Android audio, actual APK build/install | NOT TESTED | Requires browser rendering/device or GitHub signing secrets |

---

## Historical test details

The detailed tables retained below originate from the earlier v8.2.0 report and are provided as historical context only; they are not a fresh test run of the v8.3.0 archive. Do not use them as proof that the corresponding runners exist in this ZIP or that the current version passed those tests.

## A. Automated browser tests (`integration-tests.js`) — 21/21 PASS

| ID | Test | Result | Evidence |
|----|------|--------|----------|
| T1 | Register new offline account (Persian username rules, session persisted) | PASS | `session=test_teacher` |
| T2 | Add 3 students through the real UI form | PASS | students 0→3 |
| T3 | Record attendance (absence with reason) | PASS | attendance 0→1 |
| T4 | **Persistence across full page reload** (auto-login, same data, photo intact) | PASS | students 3→3, attendance 1→1, photo=true |
| T5a | Full JSON backup export (photos + voices re-inlined) | PASS | ≈10.1 KB file captured |
| T5b | Backup carries `backupMetadata` (format/version/username) and embedded photo | PASS | `format=daftar-kelasi-backup`, photo base64 found in file |
| T5c | **Backup → corrupt live data → restore** (preview/confirm shown, counts compared, names + photo restored) | PASS | 1 confirm dialog, students 3/3, all corrupted names reverted |
| T6a | School package export (teacher side) produces `.dkshare.json` | PASS | 3,888-byte package |
| T6b | Package structure (format/sender/school/crypto/signature) + **student names truly encrypted** | PASS | names not present in plaintext |
| T7 | Import with **wrong passphrase** → rejected | PASS | "امضای بسته تأیید نشد…" |
| T8 | Import with correct passphrase → verified + stored | PASS | success message with teacher/update-time |
| T9 | **Duplicate** package (same ID) → rejected, nothing overwritten | PASS | "قبلاً دریافت شده است" |
| T10 | **Stale** package (older, re-signed by "teacher") → accepted but flagged «قدیمی‌تر از آخرین بسته» | PASS | stale warning present |
| T11 | **Tampered** ciphertext → signature/GCM verification fails | PASS | rejected |
| T12 | Principal **PDF report** generated from imported package | PASS | `%PDF-` header, 1 page, saved and rendered |
| T13 | Monthly school report = **real PDF** (no print window) | PASS | `%PDF-` header, 1 page |
| T14 | Attendance PDF incl. **student photo** drawn from `media://` ref | PASS | photo visibly rendered on page image |
| T15 | Jalali conversion anchors (2026-03-21→۱۴۰۵/۰۱/۰۱, 2025-03-20→۱۴۰۳/۱۲/۳۰) | PASS | both exact |
| T16 | Honest data-status pill without a server | PASS | «ذخیره محلی · بدون سرور» |
| T17 | Sync queue stays **empty** without an endpoint | PASS | pending=0 |
| T18 | No unexpected console errors across the whole scenario | PASS | only intentional negative-test logs filtered |

## B. Smoke test (`smoke-test.js`) — PASS

Register → open class → click **all 19 sidebar sections** → core section opens: **0 console errors, 0 page errors**.

## C. Backend API tests (`backend-tests.js`, real server process) — 20/20 PASS

| ID | Test | Result | Evidence |
|----|------|--------|----------|
| B1 | `/api/health` version 3.2.0 | PASS | exact JSON |
| B2 | Security headers (`nosniff`, `DENY`, `no-referrer`) | PASS | headers present |
| B3 | Admin setup without setup key → 403 | PASS | |
| B4 | First account = admin + school + join code | PASS | role=admin |
| B5 | Duplicate username (different case/digits) → 409 | PASS | |
| B6 | Teacher joins via join code | PASS | role=teacher |
| B7 | Invalid school code → 404 | PASS | |
| B8/B9 | Sync push + pull round trip | PASS | payload intact |
| B10 | Stale `baseRevision` → **409 SYNC_CONFLICT** | PASS | |
| B11 | **School isolation**: second school's admin sees only own teacher | PASS | teachers=modir02 |
| B12 | Teacher blocked from admin panel (403) | PASS | |
| B13 | Admin overview statistics (students, absences) | PASS | students=1, absent=1 |
| B14 | Admin transfer → target becomes admin, **previous admin demoted immediately** (DB role check, stale token ineffective) + owner_teacher_id updated | PASS | |
| B15 | Change credentials on server: new password works, old rejected | PASS | |
| B16 | Unknown `/api/*` path → JSON 404 | PASS | |
| B17 | Rate limiting → 429 | PASS | |
| B18 | Two concurrent pushes → one 200, other 409 (no silent overwrite) | PASS | statuses=200,409 |
| B19 | Root page served (the app itself) | PASS | ≈958 KB |
| B20 | `store.json` valid after run (atomic write) | PASS | parses |

## D. Static checks

| Check | Result |
|-------|--------|
| `new Function` parse of all 8 script blocks in `index.html` | PASS (0 syntax errors) |
| `node --check backend/index.js` | PASS |
| Root `index.html` ≡ `app/src/main/assets/index.html` ≡ `backend/public/index.html` (md5 46c801b4…) | PASS |
| GitHub workflow YAML valid | PASS |
| PDF visual inspection (3 PDFs rendered to PNG and reviewed): Persian letter shaping, RTL alignment, Jalali dates, Persian page numbers, no missing glyphs | PASS |

## E. Manual tests — NOT TESTED in this environment (require physical device/credentials)

| Test | Why not | What to check on your side |
|------|---------|---------------------------|
| Real microphone speech-to-text on Android (fa-IR) | No Android device/emulator here | After installing the APK: tap any «گفتار» mic button, speak Persian; status line must show the recognized text and remain editable |
| Offline on-device speech recognition (Android 12+) | Device-dependent feature | Airplane mode → mic button; app should try on-device recognizer and either work (if the language pack is installed) or show the honest network-required message |
| Actual APK build & install via GitHub Actions | Keystore secrets unavailable here | Run the workflow; install artifact `DaftarKelasi-APK-v8.2.0` over the existing app (do **not** uninstall first) |
| Real-device audio recording/playback | Requires device | Record a voice note in ارزشیابی, play it back, restart app, play again |
| File-transfer of `.dkshare.json` via WhatsApp/Bluetooth | Requires two devices | Send the package from teacher phone to principal phone, import there |
| Render/PostgreSQL deployment of backend v3.2.0 | No production credentials (by rule: no live deployment without authorization) | Optional: deploy `backend/`, then `/api/health` should report `3.2.0` |
| Print dialog on desktop browsers | Environment has no printer service | Use «ذخیره به‌صورت PDF» in the browser dialog when testing کارت معلم printing |

## F. Regression check

No existing feature was removed. Data schema unchanged (`dataSchemaVersion` stays 5; migration is additive). Backups created by previous versions remain restorable (legacy files without `backupMetadata` are accepted with an informative notice; legacy password hashes upgrade transparently on first login).
