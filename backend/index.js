/*
 * دفتر کلاسی — سرور ابری مدرسه (v3.0.0)
 * ---------------------------------------------------------------
 * سرور کامل و سازگار با اپلیکیشن «دفتر کلاسی من» (کلاینت v7.5.1+)
 *
 * ویژگی‌ها:
 *  - ثبت‌نام / ورود با توکن امن (HMAC-SHA256، بدون وابستگی خارجی)
 *  - هر مدرسه دادهٔ جداگانه با «کد عضویت» ؛ اولین حساب بدون کد = مدیر مدرسه
 *  - همگام‌سازی داده با تشخیص تعارض (409) مطابق پروتکل X-Daftar-Protocol:1
 *  - API پنل مدیر: overview + snapshot معلم + بازخورد
 *  - ساخت خودکار جداول در اولین اجرا (مشکل SERVER_ERROR قبلی را رفع می‌کند)
 *  - پشتیبان PostgreSQL (تولیدی) و در نبود DATABASE_URL ذخیرهٔ JSON محلی
 *
 * اجرا:  npm install && npm start
 * متغیرها: PORT, DATABASE_URL, TOKEN_SECRET, ALLOWED_ORIGIN
 */

"use strict";

const express = require("express");
const crypto = require("crypto");

const APP_VERSION = "3.0.0";
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const TOKEN_SECRET =
  (process.env.TOKEN_SECRET || process.env.JWT_SECRET || "").trim() || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // ۳۰ روز

/* ============================================================
   لایهٔ داده — دو درایور: PostgreSQL یا فایل JSON
============================================================ */

const SCHOOL_DEFAULT_NAME = "مدرسه من";

function joinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[crypto.randomInt(alphabet.length)];
  return s;
}
function newId() { return crypto.randomUUID(); }
function nowIso() { return new Date().toISOString(); }
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  try {
    const h = crypto.scryptSync(String(password), salt, 64);
    const e = Buffer.from(expectedHash, "hex");
    return h.length === e.length && crypto.timingSafeEqual(h, e);
  } catch (e) { return false; }
}

/* ---------- توکن HMAC (بدون وابستگی خارجی) ---------- */
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest());
  return body + "." + sig;
}
function readToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;
    const body = parts[0], sig = parts[1];
    const expect = b64url(crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest());
    const a = Buffer.from(sig), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!payload || !payload.tid || (payload.exp && payload.exp < Date.now())) return null;
    return payload;
  } catch (e) { return null; }
}

/* ---------- درایور فایل JSON (حالت ساده / تست) ---------- */
class FileStore {
  constructor(dir) {
    this.path = require("path").join(dir, "store.json");
    this.data = { schools: [], teachers: [], snapshots: [], feedback: [], settings: {} };
    try { this.data = JSON.parse(require("fs").readFileSync(this.path, "utf8")); } catch (e) {}
    this._saveTimer = null;
    console.log("[daftar] storage driver: file (" + this.path + ")");
  }
  _save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        require("fs").mkdirSync(require("path").dirname(this.path), { recursive: true });
        require("fs").writeFileSync(this.path, JSON.stringify(this.data));
      } catch (e) { console.error("[daftar] file save failed:", e.message); }
    }, 120);
  }
  async init() { return; }
  async getSetting(k) { return this.data.settings[k]; }
  async setSetting(k, v) { this.data.settings[k] = v; this._save(); }
  async countTeachers() { return this.data.teachers.length; }
  async createSchool({ name, join_code, owner_teacher_id }) {
    const s = { id: newId(), name, join_code, owner_teacher_id, created_at: nowIso() };
    this.data.schools.push(s); this._save(); return s;
  }
  async getSchoolByJoinCode(code) {
    return this.data.schools.find(s => s.join_code === String(code).toUpperCase()) || null;
  }
  async getSchoolById(id) { return this.data.schools.find(s => s.id === id) || null; }
  async createTeacher({ username, password_hash, password_salt, role, school_id }) {
    const t = {
      id: newId(), username: String(username).toLowerCase(),
      password_hash, password_salt, role, school_id: school_id || null, created_at: nowIso()
    };
    this.data.teachers.push(t); this._save(); return t;
  }
  async getTeacherByUsername(u) {
    const k = String(u || "").toLowerCase();
    return this.data.teachers.find(t => t.username === k) || null;
  }
  async getTeacherById(id) { return this.data.teachers.find(t => t.id === id) || null; }
  async updateTeacher(id, fields) {
    const t = await this.getTeacherById(id); if (!t) return null;
    Object.assign(t, fields); this._save(); return t;
  }
  async listTeachersBySchool(schoolId) {
    return this.data.teachers.filter(t => t.school_id === schoolId);
  }
  async getSnapshot(teacherId) { return this.data.snapshots.find(s => s.teacher_id === teacherId) || null; }
  async saveSnapshot(teacherId, payload, revision) {
    let s = await this.getSnapshot(teacherId);
    if (!s) { s = { teacher_id: teacherId, payload: null, revision: "", updated_at: nowIso() }; this.data.snapshots.push(s); }
    s.payload = payload; s.revision = revision; s.updated_at = nowIso();
    this._save(); return s;
  }
  async addFeedback(teacherId, message, author) {
    const f = { id: newId(), teacher_id: teacherId, message, author: author || "", created_at: nowIso() };
    this.data.feedback.push(f); this._save(); return f;
  }
  async listFeedback(teacherId) {
    return this.data.feedback.filter(f => f.teacher_id === teacherId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}

/* ---------- درایور PostgreSQL (تولیدی — Render / Neon / ...) ---------- */
class PgStore {
  constructor(url) {
    const { Pool } = require("pg");
    const local = /localhost|127\.0\.0\.1/.test(url);
    this.pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: local ? false : { rejectUnauthorized: false }
    });
    console.log("[daftar] storage driver: postgresql");
  }
  async init() {
    const ddl = `
      CREATE TABLE IF NOT EXISTS dk_schools (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, join_code TEXT UNIQUE NOT NULL,
        owner_teacher_id TEXT, created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS dk_teachers (
        id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'teacher', school_id TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS dk_snapshots (
        teacher_id TEXT PRIMARY KEY REFERENCES dk_teachers(id) ON DELETE CASCADE,
        payload JSONB, revision TEXT, updated_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS dk_feedback (
        id TEXT PRIMARY KEY, teacher_id TEXT REFERENCES dk_teachers(id) ON DELETE CASCADE,
        message TEXT NOT NULL, author TEXT, created_at TIMESTAMPTZ DEFAULT now()
      );`;
    await this.pool.query(ddl);
    console.log("[daftar] database schema is ready");
  }
  async q(sql, params) { const r = await this.pool.query(sql, params); return r.rows; }
  async getSetting(k) { const r = await this.q("SELECT v FROM dk_settings WHERE k=$1", [k]).catch(() => []); return r[0] ? r[0].v : undefined; }
  async setSetting(k, v) {
    await this.q("CREATE TABLE IF NOT EXISTS dk_settings (k TEXT PRIMARY KEY, v TEXT)").catch(() => {});
    await this.q("INSERT INTO dk_settings (k,v) VALUES ($1,$2) ON CONFLICT (k) DO UPDATE SET v=$2", [k, String(v)]);
  }
  async countTeachers() { const r = await this.q("SELECT count(*)::int AS n FROM dk_teachers"); return r[0].n; }
  async createSchool({ name, join_code, owner_teacher_id }) {
    const r = await this.q(
      "INSERT INTO dk_schools (id,name,join_code,owner_teacher_id) VALUES ($1,$2,$3,$4) RETURNING *",
      [newId(), name, join_code, owner_teacher_id || null]);
    return this._school(r[0]);
  }
  _school(row) { return row ? { id: row.id, name: row.name, join_code: row.join_code, owner_teacher_id: row.owner_teacher_id, created_at: row.created_at } : null; }
  _teacher(row) { return row ? { id: row.id, username: row.username, password_hash: row.password_hash, password_salt: row.password_salt, role: row.role, school_id: row.school_id, created_at: row.created_at } : null; }
  async getSchoolByJoinCode(code) {
    const r = await this.q("SELECT * FROM dk_schools WHERE join_code=$1", [String(code).toUpperCase()]);
    return this._school(r[0]);
  }
  async getSchoolById(id) {
    const r = await this.q("SELECT * FROM dk_schools WHERE id=$1", [id]);
    return this._school(r[0]);
  }
  async createTeacher({ username, password_hash, password_salt, role, school_id }) {
    const r = await this.q(
      "INSERT INTO dk_teachers (id,username,password_hash,password_salt,role,school_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [newId(), String(username).toLowerCase(), password_hash, password_salt, role, school_id || null]);
    return this._teacher(r[0]);
  }
  async getTeacherByUsername(u) {
    const r = await this.q("SELECT * FROM dk_teachers WHERE username=$1", [String(u || "").toLowerCase()]);
    return this._teacher(r[0]);
  }
  async getTeacherById(id) {
    const r = await this.q("SELECT * FROM dk_teachers WHERE id=$1", [id]);
    return this._teacher(r[0]);
  }
  async updateTeacher(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return this.getTeacherById(id);
    const sets = keys.map((k, i) => k + "=$" + (i + 2)).join(", ");
    const r = await this.q("UPDATE dk_teachers SET " + sets + " WHERE id=$1 RETURNING *",
      [id].concat(keys.map(k => fields[k])));
    return this._teacher(r[0]);
  }
  async listTeachersBySchool(schoolId) {
    const r = await this.q("SELECT * FROM dk_teachers WHERE school_id=$1 ORDER BY created_at", [schoolId]);
    return r.map(x => this._teacher(x));
  }
  async getSnapshot(teacherId) {
    const r = await this.q("SELECT * FROM dk_snapshots WHERE teacher_id=$1", [teacherId]);
    const row = r[0]; if (!row) return null;
    return { teacher_id: row.teacher_id, payload: row.payload, revision: row.revision, updated_at: row.updated_at };
  }
  async saveSnapshot(teacherId, payload, revision) {
    await this.q(
      "INSERT INTO dk_snapshots (teacher_id,payload,revision,updated_at) VALUES ($1,$2,$3,now()) " +
      "ON CONFLICT (teacher_id) DO UPDATE SET payload=$2, revision=$3, updated_at=now()",
      [teacherId, JSON.stringify(payload || {}), revision || ""]);
    return this.getSnapshot(teacherId);
  }
  async addFeedback(teacherId, message, author) {
    await this.q("INSERT INTO dk_feedback (id,teacher_id,message,author) VALUES ($1,$2,$3,$4)",
      [newId(), teacherId, String(message || "").slice(0, 5000), author || ""]);
    return { ok: true };
  }
  async listFeedback(teacherId) {
    const r = await this.q("SELECT id,message,author,created_at FROM dk_feedback WHERE teacher_id=$1 ORDER BY created_at", [teacherId]);
    return r.map(x => ({ id: x.id, message: x.message, author: x.author, created_at: x.created_at }));
  }
}

/* ---------- انتخاب درایور ---------- */
let store;
if (/^postgres(ql)?:\/\//i.test(DATABASE_URL)) store = new PgStore(DATABASE_URL);
else store = new FileStore(process.env.DATA_DIR || require("path").join(__dirname, "data"));

/* ============================================================
   اپلیکیشن Express
============================================================ */
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "40mb" }));

/* CORS — کلاینت از WebView با origin «null» وصل می‌شود؛ حتماً لازم است */
app.use(function cors(req, res, next) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Daftar-Protocol, X-Admin-Setup-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
});

/* محدودکنندهٔ سادهٔ نرخ درخواست برای مسیرهای حساس */
const rateBucket = {};
function rateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "ip").toString().split(",")[0].trim();
  const now = Date.now(), win = 60 * 1000, max = 40;
  const b = rateBucket[ip] || (rateBucket[ip] = { n: 0, t: now });
  if (now - b.t > win) { b.n = 0; b.t = now; }
  b.n++;
  if (b.n > max) { res.status(429).json({ error: "درخواست‌های بیش از حد؛ کمی بعد تلاش کنید." }); return; }
  next();
}

function authTeacher(req) {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const payload = readToken(m[1]);
  if (!payload) return null;
  return payload; /* {tid, username, role, schoolId} */
}

function fail(res, status, error) { res.status(status).json({ error }); }

function teacherPublic(t) {
  return { id: t.id, username: t.username, role: t.role, schoolId: t.school_id || null };
}

/* ---------- آمار مجموعهٔ دادهٔ یک معلم ---------- */
function analyzePayload(payload) {
  const out = { studentCount: 0, classCount: 0, attendanceRecords: 0, absentRecords: 0, lateRecords: 0, classes: [] };
  if (!payload || typeof payload !== "object") return out;
  for (const [key, value] of Object.entries(payload)) {
    if (!value || typeof value !== "object" || !Array.isArray(value.students)) continue;
    const students = value.students.filter(s => s && typeof s === "object");
    const att = Array.isArray(value.attendance) ? value.attendance.filter(a => a && typeof a === "object") : [];
    out.studentCount += students.length;
    if (students.length || att.length) out.classCount++;
    for (const a of att) {
      const st = String(a.status || a.state || "");
      out.attendanceRecords++;
      if (st.indexOf("غایب") >= 0 || /absent/i.test(st)) out.absentRecords++;
      if (st.indexOf("تأخیر") >= 0 || st.indexOf("تاخیر") >= 0 || /late/i.test(st)) out.lateRecords++;
    }
    out.classes.push({
      key,
      name: (payload.classNames && payload.classNames[key]) || value.name || value.className || value.grade || ("کلاس " + key),
      students, attendance: att
    });
  }
  return out;
}

/* ============================================================
   مسیرهای عمومی
============================================================ */
app.get("/api/health", function (req, res) {
  res.json({ ok: true, service: "daftar-kelasi", time: new Date().toISOString(), version: APP_VERSION });
});

/* ---------- راه‌اندازی امن مدیر مدرسه ----------
 * با ADMIN_SETUP_KEY محافظت می‌شود؛ از ساخت مدیر بدون کلید جلوگیری می‌کند.
 * با همان store فعلی کار می‌کند تا مدل داده و ذخیره‌سازی دوگانه نشود.
 */
app.post("/api/admin/setup", rateLimit, async function (req, res) {
  const configuredKey = String(process.env.ADMIN_SETUP_KEY || "");
  const suppliedKey = String(req.headers["x-admin-setup-key"] || "");
  if (configuredKey.length < 20 || suppliedKey.length !== configuredKey.length ||
      !crypto.timingSafeEqual(Buffer.from(suppliedKey), Buffer.from(configuredKey))) {
    return res.status(403).json({ error: "SETUP_FORBIDDEN", message: "کلید راه‌اندازی نامعتبر است." });
  }
  try {
    const schoolName = String((req.body && req.body.schoolName) || "").trim().slice(0, 160);
    const username = String((req.body && req.body.username) || "").trim().toLowerCase();
    const password = String((req.body && req.body.password) || "");
    if (!schoolName || !/^[a-z0-9_\u0600-\u06FF\u200c.]{3,32}$/.test(username) || password.length < 10) {
      return res.status(400).json({ error: "INVALID_SETUP_DATA", message: "نام مدرسه و نام کاربری معتبر لازم است؛ رمز مدیر حداقل ۱۰ نویسه باشد." });
    }
    if (await store.getTeacherByUsername(username)) {
      return res.status(409).json({ error: "USERNAME_EXISTS", message: "این نام کاربری قبلاً ثبت شده است." });
    }
    const school = await store.createSchool({ name: schoolName, join_code: joinCode(), owner_teacher_id: null });
    const passwordData = hashPassword(password);
    const admin = await store.createTeacher({ username, password_hash: passwordData.hash, password_salt: passwordData.salt, role: "admin", school_id: school.id });
    await store.updateTeacher(admin.id, {});
    // Initial snapshot is optional for this store; create an empty one so admin panel sees a consistent record.
    await store.saveSnapshot(admin.id, {}, "initial");
    // Set owner after the admin ID exists, using the same school record and no schema migration.
    if (store instanceof PgStore) await store.q("UPDATE dk_schools SET owner_teacher_id=$1 WHERE id=$2", [admin.id, school.id]);
    else { school.owner_teacher_id = admin.id; store._save(); }
    return res.status(201).json({ ok: true, school: { id: school.id, name: school.name, joinCode: school.join_code }, admin: { username: admin.username, role: admin.role } });
  } catch (e) {
    console.error("[admin/setup]", e);
    if (e && e.code === "23505") return res.status(409).json({ error: "USERNAME_EXISTS", message: "این نام کاربری قبلاً ثبت شده است." });
    return res.status(500).json({ error: "SERVER_ERROR", message: "ساخت حساب مدیر انجام نشد؛ لاگ سرور را بررسی کنید." });
  }
});

/* ---------- ثبت‌نام ----------
 * بدون کد مدرسه  → ساخت مدرسهٔ جدید + نقش admin (اولین حساب = مدیر)
 * با کد مدرسه    → عضویت به‌عنوان teacher در همان مدرسه
 * نام کاربری تکراری + رمز درست + کد مدرسه → اتصال حساب موجود به مدرسه (مسیر بازگشتِ کلاینت)
 */
app.post("/api/auth/register", rateLimit, async function (req, res) {
  try {
    const username = String((req.body && req.body.username) || "").trim().toLowerCase();
    const password = String((req.body && req.body.password) || "");
    const schoolCode = String((req.body && req.body.schoolCode) || "").trim().toUpperCase();
    const schoolName = String((req.body && req.body.schoolName) || "").trim();

    if (!/^[a-z0-9_\u0600-\u06FF\u200c.]{3,32}$/.test(username))
      return fail(res, 400, "نام کاربری باید ۳ تا ۳۲ کاراکتر و بدون فاصله باشد.");
    if (password.length < 6)
      return fail(res, 400, "رمز عبور باید حداقل ۶ کاراکتر باشد.");

    const existing = await store.getTeacherByUsername(username);

    if (existing && schoolCode) {
      /* مسیر «اتصال حساب قبلی به مدرسه» از کلاینت: ورود مجدد با رمز درست */
      if (!verifyPassword(password, existing.password_salt, existing.password_hash))
        return fail(res, 401, "نام کاربری قبلاً ثبت شده و رمز واردشده نادرست است.");
      const school = await store.getSchoolByJoinCode(schoolCode);
      if (!school) return fail(res, 404, "کد مدرسه معتبر نیست.");
      const updated = await store.updateTeacher(existing.id, { school_id: school.id, role: "teacher" });
      const token = signToken({ tid: updated.id, username: updated.username, role: updated.role, schoolId: school.id, exp: Date.now() + TOKEN_TTL_MS });
      return res.json({ ok: true, token, teacher: teacherPublic(updated), school: { id: school.id, name: school.name, join_code: school.join_code } });
    }

    if (existing) return fail(res, 409, "این نام کاربری قبلاً ثبت شده است.");

    const { salt, hash } = hashPassword(password);

    if (schoolCode) {
      const school = await store.getSchoolByJoinCode(schoolCode);
      if (!school) return fail(res, 404, "کد مدرسه معتبر نیست.");
      const teacher = await store.createTeacher({ username, password_hash: hash, password_salt: salt, role: "teacher", school_id: school.id });
      const token = signToken({ tid: teacher.id, username: teacher.username, role: teacher.role, schoolId: school.id, exp: Date.now() + TOKEN_TTL_MS });
      return res.json({ ok: true, token, teacher: teacherPublic(teacher), school: { id: school.id, name: school.name, join_code: school.join_code } });
    }

    /* اولین حساب بدون کد → مدیر و بنیان‌گذار مدرسه */
    let code = joinCode();
    for (let i = 0; i < 5; i++) { if (!(await store.getSchoolByJoinCode(code))) break; code = joinCode(); }
    const teacher = await store.createTeacher({ username, password_hash: hash, password_salt: salt, role: "admin", school_id: null });
    const school = await store.createSchool({
      name: schoolName || (SCHOOL_DEFAULT_NAME + " — " + teacher.username),
      join_code: code, owner_teacher_id: teacher.id
    });
    await store.updateTeacher(teacher.id, { school_id: school.id });
    const finalTeacher = await store.getTeacherById(teacher.id);
    const token = signToken({ tid: finalTeacher.id, username: finalTeacher.username, role: "admin", schoolId: school.id, exp: Date.now() + TOKEN_TTL_MS });
    res.json({ ok: true, token, teacher: teacherPublic(finalTeacher), school: { id: school.id, name: school.name, join_code: school.join_code } });
  } catch (e) {
    console.error("[register]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

/* ---------- ورود ---------- */
app.post("/api/auth/login", rateLimit, async function (req, res) {
  try {
    const username = String((req.body && req.body.username) || "").trim().toLowerCase();
    const password = String((req.body && req.body.password) || "");
    const teacher = await store.getTeacherByUsername(username);
    if (!teacher) return fail(res, 401, "نام کاربری یا رمز عبور نادرست است.");
    if (!verifyPassword(password, teacher.password_salt, teacher.password_hash))
      return fail(res, 401, "نام کاربری یا رمز عبور نادرست است.");
    const token = signToken({ tid: teacher.id, username: teacher.username, role: teacher.role, schoolId: teacher.school_id || null, exp: Date.now() + TOKEN_TTL_MS });
    res.json({ ok: true, token, teacher: teacherPublic(teacher) });
  } catch (e) {
    console.error("[login]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

/* ---------- پروفایل فعلی ---------- */
app.get("/api/auth/me", async function (req, res) {
  try {
    const auth = authTeacher(req);
    if (!auth) return fail(res, 401, "UNAUTHORIZED");
    const teacher = await store.getTeacherById(auth.tid);
    if (!teacher) return fail(res, 401, "UNAUTHORIZED");
    const school = teacher.school_id ? await store.getSchoolById(teacher.school_id) : null;
    res.json({
      user: {
        id: teacher.id, username: teacher.username, role: teacher.role,
        school_id: teacher.school_id || null,
        schoolName: school ? school.name : null,
        join_code: school ? school.join_code : null
      }
    });
  } catch (e) {
    console.error("[me]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

/* ---------- عضویت معلم به مدرسه با کد ---------- */
app.post("/api/school/join", async function (req, res) {
  try {
    const auth = authTeacher(req);
    if (!auth) return fail(res, 401, "UNAUTHORIZED");
    const code = String((req.body && req.body.schoolCode) || "").trim().toUpperCase();
    if (!code) return fail(res, 400, "کد مدرسه را وارد کنید.");
    const school = await store.getSchoolByJoinCode(code);
    if (!school) return fail(res, 404, "کد مدرسه معتبر نیست.");
    await store.updateTeacher(auth.tid, { school_id: school.id, role: "teacher" });
    res.json({ ok: true, school: { id: school.id, name: school.name, join_code: school.join_code } });
  } catch (e) {
    console.error("[join]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

/* ============================================================
   همگام‌سازی داده (پروتکل ۱)
============================================================ */
app.get("/api/sync/pull", async function (req, res) {
  try {
    const auth = authTeacher(req);
    if (!auth) return fail(res, 401, "UNAUTHORIZED");
    const snap = await store.getSnapshot(auth.tid);
    res.json({
      payload: snap ? (snap.payload || {}) : {},
      revision: snap ? (snap.revision || "initial") : "initial",
      updated_at: snap ? snap.updated_at : null
    });
  } catch (e) {
    console.error("[pull]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

app.post("/api/sync/push", async function (req, res) {
  try {
    const auth = authTeacher(req);
    if (!auth) return fail(res, 401, "UNAUTHORIZED");
    const body = req.body || {};
    const revision = String(body.revision || "").slice(0, 128);
    const baseRevision = String(body.baseRevision || "initial").slice(0, 128);
    const payload = body.payload;
    if (!revision) return fail(res, 400, "revision الزامی است.");
    if (!payload || typeof payload !== "object") return fail(res, 400, "payload نامعتبر است.");

    const snap = await store.getSnapshot(auth.tid);
    const serverRevision = snap ? (snap.revision || "initial") : "initial";
    if (snap && serverRevision !== "initial" && baseRevision !== serverRevision) {
      /* تعارض: دادهٔ تازه‌تر روی سرور هست */
      return res.status(409).json({
        error: "SYNC_CONFLICT",
        message: "روی سرور نسخهٔ تازه‌تری از داده‌ها هست.",
        payload: snap.payload || {},
        revision: serverRevision
      });
    }
    await store.saveSnapshot(auth.tid, payload, revision);
    res.json({ ok: true, revision, synced_at: nowIso() });
  } catch (e) {
    console.error("[push]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

/* ============================================================
   API پنل مدیر مدرسه
============================================================ */
function requireAdmin(req, res) {
  const auth = authTeacher(req);
  if (!auth) { fail(res, 401, "UNAUTHORIZED"); return null; }
  if (auth.role !== "admin") { fail(res, 403, "این بخش فقط برای مدیر مدرسه است."); return null; }
  return auth;
}

app.get("/api/admin/overview", async function (req, res) {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    const me = await store.getTeacherById(auth.tid);
    if (!me || !me.school_id) return fail(res, 400, "مدرسهٔ شما یافت نشد؛ با پشتیبانی تماس بگیرید.");
    const school = await store.getSchoolById(me.school_id);
    if (!school) return fail(res, 400, "مدرسهٔ شما یافت نشد.");

    const teachers = await store.listTeachersBySchool(school.id);
    const stats = { teacherCount: teachers.length, studentCount: 0, classCount: 0, attendanceRecords: 0, absentRecords: 0, lateRecords: 0 };
    const teacherRows = [];
    const classRows = [];
    for (const t of teachers) {
      const snap = await store.getSnapshot(t.id);
      const an = analyzePayload(snap ? snap.payload : null);
      stats.studentCount += an.studentCount;
      stats.classCount += an.classCount;
      stats.attendanceRecords += an.attendanceRecords;
      stats.absentRecords += an.absentRecords;
      stats.lateRecords += an.lateRecords;
      for (const c of an.classes) classRows.push({
        classKey: c.key, className: c.name, teacher: t.username,
        studentCount: c.students.length, attendanceRecords: c.attendance.length,
        absentRecords: c.attendance.filter(a => /غایب|غائب|absent/i.test(String(a.status || a.state || ""))).length,
        lateRecords: c.attendance.filter(a => /تأخیر|تاخیر|late/i.test(String(a.status || a.state || ""))).length
      });
      teacherRows.push({
        id: t.id, username: t.username, role: t.role,
        studentCount: an.studentCount, attendanceRecords: an.attendanceRecords,
        absentRecords: an.absentRecords, lateRecords: an.lateRecords,
        lastSync: snap ? snap.updated_at : null
      });
    }
    res.json({
      school: { id: school.id, name: school.name, join_code: school.join_code },
      generatedAt: nowIso(),
      stats, teachers: teacherRows, classes: classRows
    });
  } catch (e) {
    console.error("[admin/overview]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

app.get("/api/admin/teacher/:id/snapshot", async function (req, res) {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    const me = await store.getTeacherById(auth.tid);
    const target = await store.getTeacherById(req.params.id);
    if (!target) return fail(res, 404, "این حساب یافت نشد.");
    if (!me || !me.school_id || target.school_id !== me.school_id)
      return fail(res, 403, "دسترسی فقط به معلمان مدرسهٔ خودتان مجاز است.");
    const snap = await store.getSnapshot(target.id);
    res.json({
      id: target.id,
      username: target.username,
      role: target.role,
      updated_at: snap ? snap.updated_at : null,
      payload: snap ? (snap.payload || {}) : {}
    });
  } catch (e) {
    console.error("[admin/snapshot]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

app.get("/api/admin/teacher/:id/feedback", async function (req, res) {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    const me = await store.getTeacherById(auth.tid);
    const target = await store.getTeacherById(req.params.id);
    if (!target) return fail(res, 404, "این حساب یافت نشد.");
    if (!me || !me.school_id || target.school_id !== me.school_id)
      return fail(res, 403, "دسترسی فقط به معلمان مدرسهٔ خودتان مجاز است.");
    const feedback = await store.listFeedback(target.id);
    res.json({ ok: true, feedback });
  } catch (e) {
    console.error("[admin/feedback:get]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

app.post("/api/admin/teacher/:id/feedback", async function (req, res) {
  try {
    const auth = requireAdmin(req, res); if (!auth) return;
    const me = await store.getTeacherById(auth.tid);
    const target = await store.getTeacherById(req.params.id);
    if (!target) return fail(res, 404, "این حساب یافت نشد.");
    if (!me || !me.school_id || target.school_id !== me.school_id)
      return fail(res, 403, "دسترسی فقط به معلمان مدرسهٔ خودتان مجاز است.");
    const message = String((req.body && req.body.message) || "").trim();
    if (!message) return fail(res, 400, "متن بازخورد خالی است.");
    await store.addFeedback(target.id, message, me.username);
    res.json({ ok: true });
  } catch (e) {
    console.error("[admin/feedback:post]", e);
    fail(res, 500, "SERVER_ERROR");
  }
});

/* مسیر ریشه — پیام راهنما */
app.get("/", function (req, res) {
  res.type("text/plain; charset=utf-8").send(
    "سرور ابری «دفتر کلاسی» فعال است. وضعیت: /api/health\n"
  );
});

/* خطاهای JSON نامعتبر */
app.use(function (err, req, res, next) {
  if (err && err.type === "entity.too.large") return fail(res, 413, "حجم دادهٔ ارسالی بیش از حد مجاز است.");
  if (err) return fail(res, 400, "درخواست نامعتبر است.");
  next();
});

(async function main() {
  try { await store.init(); }
  catch (e) {
    console.error("[daftar] FAILED to initialize storage:", e.message);
    process.exit(1);
  }
  app.listen(PORT, function () {
    console.log("[daftar] server v" + APP_VERSION + " listening on port " + PORT);
    if (!DATABASE_URL) {
      console.warn("[daftar] WARNING: DATABASE_URL تنظیم نشده؛ داده‌ها فقط در فایل محلی ذخیره می‌شوند.");
      console.warn("         برای Render حتماً یک PostgreSQL بسازید و DATABASE_URL را در Environment قرار دهید.");
    }
  });
})();
