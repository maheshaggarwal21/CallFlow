-- MIGRATION 001 - Core Tables

CREATE TABLE employees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(100) UNIQUE NOT NULL,
  phone         VARCHAR(15),
  role          VARCHAR(10) NOT NULL DEFAULT 'employee'
                CHECK (role IN ('owner','employee')),
  status        VARCHAR(10) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','inactive')),
  password_hash VARCHAR(100) NOT NULL,
  api_key_hash  VARCHAR(100),
  color_index   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_number VARCHAR(5) NOT NULL UNIQUE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  purpose     VARCHAR(200),
  assigned_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE intercoms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intercom_code VARCHAR(10) NOT NULL UNIQUE,
  phone_number  VARCHAR(15),
  assigned_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE devices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name  VARCHAR(100) NOT NULL,
  phone_number VARCHAR(15) NOT NULL,
  employee_id  UUID REFERENCES employees(id) ON DELETE SET NULL,
  storage_path VARCHAR(500),
  last_sync_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          VARCHAR(20) NOT NULL DEFAULT 'korecall'
                  CHECK (source IN ('korecall','android_app')),
  source_file_key VARCHAR(500) UNIQUE,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  line_number     VARCHAR(5),
  intercom_code   VARCHAR(10),
  call_direction  VARCHAR(10) NOT NULL
                  CHECK (call_direction IN ('inbound','outbound')),
  caller_phone    VARCHAR(30),
  student_name    VARCHAR(150),
  called_at       TIMESTAMPTZ NOT NULL,
  duration_secs   INTEGER NOT NULL DEFAULT 0,
  employee_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  is_misc         BOOLEAN NOT NULL DEFAULT FALSE,
  misc_reason     VARCHAR(200),
  resolution_status VARCHAR(15)
                  CHECK (resolution_status IN ('resolved','escalated')),
  audio_storage_key VARCHAR(500),
  ai_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (ai_status IN ('pending','processing','done','failed')),
  summary         TEXT,
  transcript_raw  TEXT,
  transcript_json JSONB,
  sentiment       VARCHAR(10)
                  CHECK (sentiment IN ('positive','negative','neutral')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_calls_called_at    ON calls(called_at DESC);
CREATE INDEX idx_calls_employee_id  ON calls(employee_id);
CREATE INDEX idx_calls_caller_phone ON calls(caller_phone);
CREATE INDEX idx_calls_ai_status    ON calls(ai_status);
CREATE INDEX idx_calls_is_misc      ON calls(is_misc);
CREATE INDEX idx_calls_student_name ON calls(student_name);
CREATE INDEX idx_calls_line_number  ON calls(line_number);
CREATE INDEX idx_calls_source       ON calls(source);
