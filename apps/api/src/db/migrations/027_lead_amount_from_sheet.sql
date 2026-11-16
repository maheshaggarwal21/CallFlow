-- Amount shows what the lead sheet's Amount column shows, on every lead (client, 17 Nov 2026). Until now it was
-- kept only for joined (N) leads and "Free" was dropped. Same rule as sheetAmount() in lib/crm/rules.ts:
-- "Free" → 0 (shown as Free), a number → that number, anything else → blank. The newest sheet row of the lead
-- wins (a re-enquiry's row, else the first row). Leads that never came from the sheet are left alone.
WITH cell AS (
  SELECT l.id,
         COALESCE((SELECT i.meta -> 'row' ->> 'amount' FROM lead_interactions i
                   WHERE i.lead_id = l.id AND i.kind = 'reenquiry' AND COALESCE(i.meta -> 'row' ->> 'amount', '') <> ''
                   ORDER BY i.created_at DESC LIMIT 1),
                  l.raw ->> 'amount') AS s
  FROM leads l
  WHERE l.raw ? 'amount'
), parsed AS (
  SELECT id, CASE WHEN s ~* 'free' THEN 0
                  WHEN s ~ '[0-9]' THEN substring(replace(s, ',', '') from '[0-9]+(?:\.[0-9]+)?')::numeric END AS amount
  FROM cell
)
UPDATE leads l SET amount = CASE WHEN p.amount <= 100000 THEN p.amount END
FROM parsed p
WHERE p.id = l.id AND l.amount IS DISTINCT FROM (CASE WHEN p.amount <= 100000 THEN p.amount END);
