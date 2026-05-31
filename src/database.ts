import Database from 'better-sqlite3';

const db = new Database('chat_history.db');

db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        role TEXT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        connection_id TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS connections (
        connection_id TEXT PRIMARY KEY,
        owner_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS owner_settings (
        owner_id INTEGER,
        key TEXT,
        value TEXT,
        PRIMARY KEY (owner_id, key)
    );
`);

// Пробуем добавить колонку connection_id в старую таблицу messages, если ее нет
try {
    db.exec(`ALTER TABLE messages ADD COLUMN connection_id TEXT DEFAULT ''`);
} catch (e) {
    // Игнорируем ошибку, если колонка уже существует
}

export type Role = 'user' | 'model';

// --- Connections ---
export function addConnection(connectionId: string, ownerId: number) {
    const stmt = db.prepare('INSERT OR REPLACE INTO connections (connection_id, owner_id) VALUES (?, ?)');
    stmt.run(connectionId, ownerId);
}

export function getOwnerId(connectionId: string): number | null {
    const stmt = db.prepare('SELECT owner_id FROM connections WHERE connection_id = ?');
    const row = stmt.get(connectionId) as { owner_id: number } | undefined;
    return row ? row.owner_id : null;
}

// --- Messages ---
export function addMessage(chatId: number, connectionId: string, role: Role, content: string) {
    const stmt = db.prepare('INSERT INTO messages (chat_id, connection_id, role, content) VALUES (?, ?, ?, ?)');
    stmt.run(chatId, connectionId, role, content);
}

export function getHistory(chatId: number, connectionId: string, limit: number = 20): { role: Role; content: string }[] {
    const stmt = db.prepare(`
        SELECT role, content FROM (
            SELECT role, content, timestamp FROM messages
            WHERE chat_id = ? AND connection_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        ) ORDER BY timestamp ASC
    `);
    const rows = stmt.all(chatId, connectionId, limit) as { role: Role; content: string }[];
    return rows;
}

export function clearHistory(chatId: number, connectionId: string) {
    const stmt = db.prepare('DELETE FROM messages WHERE chat_id = ? AND connection_id = ?');
    stmt.run(chatId, connectionId);
}

export function clearAllHistory(ownerId: number) {
    // Удаляем историю для всех connection_id, которые принадлежат этому ownerId
    const stmt = db.prepare(`
        DELETE FROM messages 
        WHERE connection_id IN (SELECT connection_id FROM connections WHERE owner_id = ?)
    `);
    stmt.run(ownerId);
}

export function clearHistoryByChatAndOwner(chatId: number, ownerId: number) {
    const stmt = db.prepare(`
        DELETE FROM messages 
        WHERE chat_id = ? AND connection_id IN (SELECT connection_id FROM connections WHERE owner_id = ?)
    `);
    stmt.run(chatId, ownerId);
}

// --- Settings ---
export function getSetting(ownerId: number, key: string, defaultValue: string): string {
    const stmt = db.prepare('SELECT value FROM owner_settings WHERE owner_id = ? AND key = ?');
    const row = stmt.get(ownerId, key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
}

export function setSetting(ownerId: number, key: string, value: string) {
    const stmt = db.prepare(`
        INSERT INTO owner_settings (owner_id, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT(owner_id, key) DO UPDATE SET value = excluded.value
    `);
    stmt.run(ownerId, key, value);
}

// --- Stickers ---
export function getStickers(ownerId: number): string[] {
    const val = getSetting(ownerId, 'stickers', '[]');
    try {
        return JSON.parse(val);
    } catch {
        return [];
    }
}

export function addSticker(ownerId: number, fileId: string) {
    const stickers = getStickers(ownerId);
    if (!stickers.includes(fileId)) {
        stickers.push(fileId);
        setSetting(ownerId, 'stickers', JSON.stringify(stickers));
    }
}

export function addStickers(ownerId: number, fileIds: string[]): number {
    const stickers = getStickers(ownerId);
    let addedCount = 0;
    for (const fileId of fileIds) {
        if (!stickers.includes(fileId)) {
            stickers.push(fileId);
            addedCount++;
        }
    }
    if (addedCount > 0) {
        setSetting(ownerId, 'stickers', JSON.stringify(stickers));
    }
    return addedCount;
}

export function clearStickers(ownerId: number) {
    setSetting(ownerId, 'stickers', '[]');
}
