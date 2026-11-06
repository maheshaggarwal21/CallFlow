-- Simplified lead form (client, 7 Nov): "Guitar" is a plain Yes/No on the lead.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_guitar BOOLEAN;

-- Carry over answers already given to the old "Has a guitar?" question
UPDATE leads SET has_guitar = (
  SELECT a->>'value' = 'Yes' FROM jsonb_array_elements(answers) a
  WHERE a->>'label' ILIKE '%guitar%' AND a->>'value' IN ('Yes', 'No') LIMIT 1)
WHERE has_guitar IS NULL AND jsonb_typeof(answers) = 'array';
