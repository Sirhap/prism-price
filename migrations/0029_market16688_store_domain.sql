-- Move 16688 URL values to the platform's new hostname.
-- The unique canonical URL constraint rejects collisions instead of merging shops.
-- Rewrite only exact hosts and the known URL fields in precomputed JSON.

WITH old_origins(origin) AS (VALUES
    ('https://www.16688.com.cn'),
    ('https://16688.com.cn'),
    ('http://www.16688.com.cn'),
    ('http://16688.com.cn'),
    ('https://16688.store'),
    ('http://16688.store'),
    ('http://www.16688.store')
)
UPDATE shops
SET shop_url = CASE WHEN lower(substr(shop_url, 1, instr(substr(shop_url, instr(shop_url, '://') + 3) || '/', '/') + instr(shop_url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(shop_url, instr(substr(shop_url, instr(shop_url, '://') + 3) || '/', '/') + instr(shop_url, '://') + 2)
        ELSE shop_url END,
    canonical_url = CASE WHEN lower(substr(canonical_url, 1, instr(substr(canonical_url, instr(canonical_url, '://') + 3) || '/', '/') + instr(canonical_url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(canonical_url, instr(substr(canonical_url, instr(canonical_url, '://') + 3) || '/', '/') + instr(canonical_url, '://') + 2)
        ELSE canonical_url END,
    product_summary_json = replace(replace(replace(replace(replace(replace(replace(product_summary_json,
        '"itemUrl":"https://www.16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"https://16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://www.16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"https://16688.store/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://16688.store/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://www.16688.store/', '"itemUrl":"https://www.16688.store/')
WHERE lower(substr(shop_url, 1, instr(substr(shop_url, instr(shop_url, '://') + 3) || '/', '/') + instr(shop_url, '://') + 1)) IN (SELECT origin FROM old_origins)
   OR lower(substr(canonical_url, 1, instr(substr(canonical_url, instr(canonical_url, '://') + 3) || '/', '/') + instr(canonical_url, '://') + 1)) IN (SELECT origin FROM old_origins)
   OR instr(product_summary_json, '"itemUrl":"https://www.16688.com.cn/') > 0
   OR instr(product_summary_json, '"itemUrl":"https://16688.com.cn/') > 0
   OR instr(product_summary_json, '"itemUrl":"http://www.16688.com.cn/') > 0
   OR instr(product_summary_json, '"itemUrl":"http://16688.com.cn/') > 0
   OR instr(product_summary_json, '"itemUrl":"https://16688.store/') > 0
   OR instr(product_summary_json, '"itemUrl":"http://16688.store/') > 0
   OR instr(product_summary_json, '"itemUrl":"http://www.16688.store/') > 0;

WITH old_origins(origin) AS (VALUES
    ('https://www.16688.com.cn'),
    ('https://16688.com.cn'),
    ('http://www.16688.com.cn'),
    ('http://16688.com.cn'),
    ('https://16688.store'),
    ('http://16688.store'),
    ('http://www.16688.store')
)
UPDATE offers
SET item_url = CASE WHEN lower(substr(item_url, 1, instr(substr(item_url, instr(item_url, '://') + 3) || '/', '/') + instr(item_url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(item_url, instr(substr(item_url, instr(item_url, '://') + 3) || '/', '/') + instr(item_url, '://') + 2)
        ELSE item_url END
WHERE lower(substr(item_url, 1, instr(substr(item_url, instr(item_url, '://') + 3) || '/', '/') + instr(item_url, '://') + 1)) IN (SELECT origin FROM old_origins);

WITH old_origins(origin) AS (VALUES
    ('https://www.16688.com.cn'),
    ('https://16688.com.cn'),
    ('http://www.16688.com.cn'),
    ('http://16688.com.cn'),
    ('https://16688.store'),
    ('http://16688.store'),
    ('http://www.16688.store')
)
UPDATE product_groups
SET lead_shop_url = CASE WHEN lower(substr(lead_shop_url, 1, instr(substr(lead_shop_url, instr(lead_shop_url, '://') + 3) || '/', '/') + instr(lead_shop_url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(lead_shop_url, instr(substr(lead_shop_url, instr(lead_shop_url, '://') + 3) || '/', '/') + instr(lead_shop_url, '://') + 2)
        ELSE lead_shop_url END,
    lead_item_url = CASE WHEN lower(substr(lead_item_url, 1, instr(substr(lead_item_url, instr(lead_item_url, '://') + 3) || '/', '/') + instr(lead_item_url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(lead_item_url, instr(substr(lead_item_url, instr(lead_item_url, '://') + 3) || '/', '/') + instr(lead_item_url, '://') + 2)
        ELSE lead_item_url END,
    offers_preview_json = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(offers_preview_json,
        '"shopUrl":"https://www.16688.com.cn/', '"shopUrl":"https://www.16688.store/'),
        '"shopUrl":"https://16688.com.cn/', '"shopUrl":"https://www.16688.store/'),
        '"shopUrl":"http://www.16688.com.cn/', '"shopUrl":"https://www.16688.store/'),
        '"shopUrl":"http://16688.com.cn/', '"shopUrl":"https://www.16688.store/'),
        '"shopUrl":"https://16688.store/', '"shopUrl":"https://www.16688.store/'),
        '"shopUrl":"http://16688.store/', '"shopUrl":"https://www.16688.store/'),
        '"shopUrl":"http://www.16688.store/', '"shopUrl":"https://www.16688.store/'),
        '"itemUrl":"https://www.16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"https://16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://www.16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://16688.com.cn/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"https://16688.store/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://16688.store/', '"itemUrl":"https://www.16688.store/'),
        '"itemUrl":"http://www.16688.store/', '"itemUrl":"https://www.16688.store/')
WHERE lower(substr(lead_shop_url, 1, instr(substr(lead_shop_url, instr(lead_shop_url, '://') + 3) || '/', '/') + instr(lead_shop_url, '://') + 1)) IN (SELECT origin FROM old_origins)
   OR lower(substr(lead_item_url, 1, instr(substr(lead_item_url, instr(lead_item_url, '://') + 3) || '/', '/') + instr(lead_item_url, '://') + 1)) IN (SELECT origin FROM old_origins)
   OR instr(offers_preview_json, '"shopUrl":"https://www.16688.com.cn/') > 0
   OR instr(offers_preview_json, '"shopUrl":"https://16688.com.cn/') > 0
   OR instr(offers_preview_json, '"shopUrl":"http://www.16688.com.cn/') > 0
   OR instr(offers_preview_json, '"shopUrl":"http://16688.com.cn/') > 0
   OR instr(offers_preview_json, '"shopUrl":"https://16688.store/') > 0
   OR instr(offers_preview_json, '"shopUrl":"http://16688.store/') > 0
   OR instr(offers_preview_json, '"shopUrl":"http://www.16688.store/') > 0
   OR instr(offers_preview_json, '"itemUrl":"https://www.16688.com.cn/') > 0
   OR instr(offers_preview_json, '"itemUrl":"https://16688.com.cn/') > 0
   OR instr(offers_preview_json, '"itemUrl":"http://www.16688.com.cn/') > 0
   OR instr(offers_preview_json, '"itemUrl":"http://16688.com.cn/') > 0
   OR instr(offers_preview_json, '"itemUrl":"https://16688.store/') > 0
   OR instr(offers_preview_json, '"itemUrl":"http://16688.store/') > 0
   OR instr(offers_preview_json, '"itemUrl":"http://www.16688.store/') > 0;

WITH old_origins(origin) AS (VALUES
    ('https://www.16688.com.cn'),
    ('https://16688.com.cn'),
    ('http://www.16688.com.cn'),
    ('http://16688.com.cn'),
    ('https://16688.store'),
    ('http://16688.store'),
    ('http://www.16688.store')
)
UPDATE open_store_urls
SET url = CASE WHEN lower(substr(url, 1, instr(substr(url, instr(url, '://') + 3) || '/', '/') + instr(url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(url, instr(substr(url, instr(url, '://') + 3) || '/', '/') + instr(url, '://') + 2)
        ELSE url END
WHERE lower(substr(url, 1, instr(substr(url, instr(url, '://') + 3) || '/', '/') + instr(url, '://') + 1)) IN (SELECT origin FROM old_origins);

WITH old_origins(origin) AS (VALUES
    ('https://www.16688.com.cn'),
    ('https://16688.com.cn'),
    ('http://www.16688.com.cn'),
    ('http://16688.com.cn'),
    ('https://16688.store'),
    ('http://16688.store'),
    ('http://www.16688.store')
)
UPDATE admin_settings
SET open_store_url = CASE WHEN lower(substr(open_store_url, 1, instr(substr(open_store_url, instr(open_store_url, '://') + 3) || '/', '/') + instr(open_store_url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(open_store_url, instr(substr(open_store_url, instr(open_store_url, '://') + 3) || '/', '/') + instr(open_store_url, '://') + 2)
        ELSE open_store_url END
WHERE lower(substr(open_store_url, 1, instr(substr(open_store_url, instr(open_store_url, '://') + 3) || '/', '/') + instr(open_store_url, '://') + 1)) IN (SELECT origin FROM old_origins);

WITH old_origins(origin) AS (VALUES
    ('https://www.16688.com.cn'),
    ('https://16688.com.cn'),
    ('http://www.16688.com.cn'),
    ('http://16688.com.cn'),
    ('https://16688.store'),
    ('http://16688.store'),
    ('http://www.16688.store')
)
UPDATE sponsor_ads
SET link_url = CASE WHEN lower(substr(link_url, 1, instr(substr(link_url, instr(link_url, '://') + 3) || '/', '/') + instr(link_url, '://') + 1)) IN (SELECT origin FROM old_origins)
        THEN 'https://www.16688.store' || substr(link_url, instr(substr(link_url, instr(link_url, '://') + 3) || '/', '/') + instr(link_url, '://') + 2)
        ELSE link_url END
WHERE lower(substr(link_url, 1, instr(substr(link_url, instr(link_url, '://') + 3) || '/', '/') + instr(link_url, '://') + 1)) IN (SELECT origin FROM old_origins);

-- Some previously collected merchant names and descriptions include literal storefront links.
UPDATE shops
SET shop_name = replace(shop_name, 'https://www.16688.com.cn/', 'https://www.16688.store/'),
    description = replace(replace(description, 'https://www.16688.com.cn/', 'https://www.16688.store/'),
        'https://www.16688.com.cn，', 'https://www.16688.store，')
WHERE instr(shop_name, 'https://www.16688.com.cn/') > 0
   OR instr(description, 'https://www.16688.com.cn/') > 0
   OR instr(description, 'https://www.16688.com.cn，') > 0;

UPDATE product_groups
SET lead_shop_name = replace(lead_shop_name, 'https://www.16688.com.cn/', 'https://www.16688.store/')
WHERE instr(lead_shop_name, 'https://www.16688.com.cn/') > 0;

UPDATE product_groups
SET offers_preview_json = (
    SELECT json_group_array(json(
        CASE WHEN instr(json_extract(offer.value, '$.shopName'), 'https://www.16688.com.cn/') > 0
             THEN json_set(offer.value, '$.shopName',
                  replace(json_extract(offer.value, '$.shopName'), 'https://www.16688.com.cn/', 'https://www.16688.store/'))
             ELSE offer.value END
    ) ORDER BY offer.key)
    FROM json_each(product_groups.offers_preview_json) AS offer
)
WHERE instr(offers_preview_json, 'https://www.16688.com.cn/') > 0
  AND json_valid(offers_preview_json)
  AND EXISTS (
      SELECT 1 FROM json_each(product_groups.offers_preview_json) AS offer
      WHERE instr(json_extract(offer.value, '$.shopName'), 'https://www.16688.com.cn/') > 0
  );
