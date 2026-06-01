-- ============================================================
-- Telegram Business Bot — Supabase PostgreSQL Schema
-- Миграция с SQLite на PostgreSQL
-- ============================================================

-- 1. Таблица сообщений (история диалогов)
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL,
    connection_id TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('user', 'model')),
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_connection 
    ON messages (chat_id, connection_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at 
    ON messages (created_at);

-- 2. Таблица бизнес-соединений
CREATE TABLE IF NOT EXISTS connections (
    connection_id TEXT PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connections_owner 
    ON connections (owner_id);

-- 3. Настройки владельца (промпт, сессия и т.д.)
CREATE TABLE IF NOT EXISTS owner_settings (
    owner_id BIGINT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner_id, key)
);

-- 4. Таблица пауз (вместо in-memory Map)
CREATE TABLE IF NOT EXISTS paused_chats (
    chat_id BIGINT PRIMARY KEY,
    paused_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Таблица стикеров (вместо JSON в settings)
CREATE TABLE IF NOT EXISTS stickers (
    id BIGSERIAL PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    file_id TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, file_id)
);

CREATE INDEX IF NOT EXISTS idx_stickers_owner 
    ON stickers (owner_id);

-- ============================================================
-- Row Level Security (RLS)
-- Edge Functions используют service_role key, поэтому RLS
-- не блокирует их, но включаем для безопасности
-- ============================================================

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE paused_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE stickers ENABLE ROW LEVEL SECURITY;

-- Разрешаем service_role полный доступ (Edge Functions)
CREATE POLICY "Service role full access" ON messages
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON connections
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON owner_settings
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON paused_chats
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON stickers
    FOR ALL USING (true) WITH CHECK (true);
