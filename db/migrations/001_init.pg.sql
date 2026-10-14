-- EKO RUMMY: esquema para PostgreSQL 15+ (equivalente al de SQLite en apps/server/src/store.ts).
-- Estado: esquema listo; el adaptador PostgreSQL del servidor está pendiente (ver docs/REPORTE_PRUEBAS.md).

CREATE TABLE IF NOT EXISTS users ( id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'player', banned BIGINT NOT NULL DEFAULT 0, rating BIGINT NOT NULL DEFAULT 1200, created_at BIGINT NOT NULL, cosmetics TEXT NOT NULL DEFAULT '[]', wallet TEXT);
CREATE TABLE IF NOT EXISTS logins (user_id TEXT NOT NULL, at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS matches ( id TEXT PRIMARY KEY, mode TEXT NOT NULL, started_at BIGINT NOT NULL, ended_at BIGINT, players TEXT NOT NULL, result TEXT, tournament_id TEXT);
CREATE TABLE IF NOT EXISTS match_players (match_id TEXT NOT NULL, user_id TEXT NOT NULL, score BIGINT NOT NULL, won BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS friends (user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (user_id, friend_id));
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter TEXT, target TEXT, match_id TEXT, reason TEXT NOT NULL, at BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'open');
CREATE TABLE IF NOT EXISTS purchases ( id TEXT PRIMARY KEY, user_id TEXT NOT NULL, product TEXT NOT NULL, amount BIGINT NOT NULL, currency TEXT NOT NULL, stripe_session TEXT UNIQUE, stripe_event TEXT, status TEXT NOT NULL, created_at BIGINT NOT NULL, refunded_at BIGINT);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS errors (at BIGINT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS flags (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (seq BIGSERIAL PRIMARY KEY, at BIGINT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS active_games (code TEXT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_mp_user ON match_players(user_id);
CREATE INDEX IF NOT EXISTS idx_logins ON logins(user_id, at);
