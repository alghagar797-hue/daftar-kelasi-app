CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(160) NOT NULL,
  join_code VARCHAR(24) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(32) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'teacher' CHECK (role IN ('teacher','admin')),
  school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe migrations for installations created by older releases.
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'teacher';
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS teachers_school_id_idx ON teachers(school_id);

CREATE TABLE IF NOT EXISTS teacher_snapshots (
  teacher_id UUID PRIMARY KEY REFERENCES teachers(id) ON DELETE CASCADE,
  revision VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_events (
  id BIGSERIAL PRIMARY KEY,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  revision VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(teacher_id, revision)
);
CREATE INDEX IF NOT EXISTS sync_events_teacher_id_id_idx ON sync_events(teacher_id,id);


-- مدیر مدرسه می‌تواند بازخوردهای ثبت‌شده برای معلمان را نگهداری کند.
CREATE TABLE IF NOT EXISTS teacher_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS teacher_feedback_teacher_created_idx ON teacher_feedback(teacher_id, created_at DESC);
