PRAGMA foreign_keys = ON;

CREATE TABLE countries (
  country_code TEXT PRIMARY KEY CHECK(length(country_code) = 2),
  iso3 TEXT CHECK(iso3 IS NULL OR length(iso3) = 3),
  name_en TEXT NOT NULL,
  name_zh TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','building','ready','failed')),
  package_version TEXT,
  manifest_key TEXT,
  bbox_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE country_build_jobs (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL REFERENCES countries(country_code) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','building','ready','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  github_run_id TEXT,
  error TEXT,
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE UNIQUE INDEX idx_country_active_job ON country_build_jobs(country_code)
  WHERE status IN ('pending','building');
CREATE INDEX idx_country_status ON countries(status);
CREATE INDEX idx_country_jobs_status ON country_build_jobs(status, requested_at);

INSERT INTO countries
  (country_code,iso3,name_en,name_zh,status,package_version,manifest_key,bbox_json)
VALUES
  ('CN','CHN','China','中国','ready','v1','v3/countries/CN/manifest.json','[73.5,18,135.1,53.6]'),
  ('NZ','NZL','New Zealand','新西兰','ready','v1','v3/countries/NZ/manifest.json','[165,-48,179.5,-33]');
