-- Schema هماهنگ با backend/index.js نسخه 3.1.x
-- تمام شناسه‌ها TEXT هستند تا با crypto.randomUUID() سازگار باشند.
CREATE TABLE IF NOT EXISTS dk_schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  join_code TEXT UNIQUE NOT NULL,
  owner_teacher_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dk_teachers (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'teacher',
  school_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dk_snapshots (
  teacher_id TEXT PRIMARY KEY REFERENCES dk_teachers(id) ON DELETE CASCADE,
  payload JSONB,
  revision TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dk_feedback (
  id TEXT PRIMARY KEY,
  teacher_id TEXT REFERENCES dk_teachers(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dk_settings (k TEXT PRIMARY KEY, v TEXT);
CREATE INDEX IF NOT EXISTS dk_teachers_school_id_idx ON dk_teachers(school_id);
CREATE INDEX IF NOT EXISTS dk_feedback_teacher_created_idx ON dk_feedback(teacher_id, created_at DESC);
