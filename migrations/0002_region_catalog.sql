ALTER TABLE pins ADD COLUMN country_code TEXT;

CREATE TABLE regions (
  region_id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL CHECK(length(country_code) = 2),
  name_en TEXT NOT NULL,
  name_zh TEXT,
  parent_name_en TEXT,
  parent_name_zh TEXT,
  centroid_lat REAL NOT NULL,
  centroid_lng REAL NOT NULL,
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pins_country ON pins(country_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_regions_country ON regions(country_code);
