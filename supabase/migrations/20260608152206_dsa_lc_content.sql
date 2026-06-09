ALTER TABLE dsa_problems
  ADD COLUMN IF NOT EXISTS lc_content             TEXT,
  ADD COLUMN IF NOT EXISTS lc_topic_tags          TEXT[],
  ADD COLUMN IF NOT EXISTS lc_hints               TEXT[],
  ADD COLUMN IF NOT EXISTS lc_example_testcases   TEXT;

-- 20260608000001_dsa_lc_content.sql