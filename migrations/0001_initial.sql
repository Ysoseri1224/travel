PRAGMA foreign_keys = ON;

CREATE TABLE pins (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
  lat REAL NOT NULL CHECK(lat BETWEEN -90 AND 90),
  lng REAL NOT NULL CHECK(lng BETWEEN -180 AND 180),
  place_name TEXT,
  place_names TEXT,
  region_id TEXT,
  event_date TEXT CHECK(event_date IS NULL OR event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  color TEXT NOT NULL DEFAULT '#c85f3c',
  content TEXT NOT NULL DEFAULT '',
  photo_style TEXT,
  cover_media_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE pin_media (
  pin_id TEXT NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  caption TEXT,
  PRIMARY KEY (pin_id, media_id)
);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE search_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE search_limits (
  client_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (client_hash, window_start)
);

CREATE INDEX idx_pins_region ON pins(region_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_pins_event_date ON pins(event_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_pins_deleted ON pins(deleted_at);
CREATE UNIQUE INDEX idx_pin_media_order ON pin_media(pin_id, sort_order);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_search_cache_expires ON search_cache(expires_at);
