ALTER TABLE regions ADD COLUMN parent_region_id TEXT;

CREATE INDEX idx_regions_parent ON regions(country_code, parent_region_id);
