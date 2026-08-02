UPDATE regions
SET name_en = 'Wellington', name_zh = '惠灵顿', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE region_id = 'r1_nzl_76426892B25406189221199';

UPDATE regions
SET name_en = 'Queenstown', name_zh = '皇后镇', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE region_id = 'r1_nzl_76426892B58919482239418';
