-- Brand rule: no em or en dashes in UI copy. Status and dropdown label names written by earlier
-- templates ("Company size": "1–50", "51–200", ...) read "1 to 50" instead. Label ids are kept,
-- so item values (which store label ids) are untouched.
UPDATE crm.columns AS c
SET settings = jsonb_set(
  c.settings,
  '{labels}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN jsonb_typeof(t.label -> 'name') = 'string'
          THEN jsonb_set(t.label, '{name}', to_jsonb(regexp_replace(t.label ->> 'name', '\s*[–—]\s*', ' to ', 'g')))
        ELSE t.label
      END
      ORDER BY t.ord
    )
    FROM jsonb_array_elements(c.settings -> 'labels') WITH ORDINALITY AS t(label, ord)
  )
)
WHERE jsonb_typeof(c.settings -> 'labels') = 'array'
  AND (c.settings -> 'labels')::text ~ '[–—]';
