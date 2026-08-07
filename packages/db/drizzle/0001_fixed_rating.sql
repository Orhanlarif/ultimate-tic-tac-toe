-- Fixed-delta rating reset: everyone starts at 300 (gold).
-- Apply with: psql "$DATABASE_URL" -f packages/db/drizzle/0001_fixed_rating.sql
-- or run the UPDATE manually after deploy.

ALTER TABLE ratings ALTER COLUMN rating SET DEFAULT 300;

UPDATE ratings
SET
  rating = 300,
  league = 'gold',
  rd = 350,
  volatility = 0.06,
  updated_at = NOW();
