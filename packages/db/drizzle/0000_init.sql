-- Initial schema reference. Prefer `npm run db:push` during development.
-- Generated manually for documentation / CI bootstrap.

CREATE TYPE queue_mode AS ENUM ('casual', 'ranked');
CREATE TYPE match_status AS ENUM ('in_progress', 'completed', 'aborted');
CREATE TYPE match_result AS ENUM ('X', 'O', 'draw');
CREATE TYPE end_reason AS ENUM ('normal', 'resign', 'timeout', 'disconnect');
CREATE TYPE league_tier AS ENUM ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster');
CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'blocked');
