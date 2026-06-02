# 🐛 Отчет об Анализе Кода и Поиске Багов (Telegram Business Bot)

Был проведен детальный аудит двух реализаций бота в проекте:
1. **Оригинальная версия (Node.js + SQLite)** в папке `src/`.
2. **Edge-версия (Deno + Supabase PostgreSQL)** в папке `supabase/functions/telegram-bot/`.

Ниже представлены найденные баги, разделенные по уровню критичности, с подробным описанием причин и готовыми решениями по их исправлению.

---

## 🔴 КРИТИЧЕСКИЕ БАГИ (Могут приводить к крашам и отказу работы)

### 1. Бот триггерит собственные ответы как сообщения клиента (Самозацикливание)
* **Где находится:** `src/bot.ts` и `supabase/functions/telegram-bot/index.ts`.
* **Симптомы:** Бот начинает отвечать на свои собственные сообщения в бизнес-чате, создавая бесконечный цикл диалога с самим собой.
* **Причина:** В обработчике `business_message` отсутствует явное игнорирование сообщений от ботов (включая самого себя). Из-за особенностей Telegram Business API исходящие сообщения от бота могут попадать в этот обработчик и не отсекаться стандартной проверкой `isOwner` (особенно если `ownerId` не успел инициализироваться или равен `0`).
* **Решение:** Добавить безусловное игнорирование любых сообщений, отправленных ботами (`from.is_bot === true`), на самом первом шаге обработчика.

#### Код исправления:
```typescript
bot.on("business_message", async (ctx) => {
    const message = ctx.businessMessage;
    if (!message || !message.business_connection_id) return;
    
    // Новое правило: полностью игнорируем любые сообщения от ботов (включая самого себя)
    if (message.from?.is_bot) {
        return;
    }
    
    // ... остальная логика ...
```

---

### 2. Ошибка парсинга разметки Telegram (Markdown Parse Error) при обучении
* **Где находится:** `src/bot.ts` (строка 283) и `supabase/functions/telegram-bot/index.ts` (строка 1005).
* **Симптомы:** При загрузке файла истории переписки бот пишет "⏳ Скачиваю и анализирую историю...", но затем выдает ошибку "❌ Произошла ошибка при анализе файла", хотя сам анализ в Gemini прошел успешно.
* **Причина:** Бот использует устаревший режим форматирования `parse_mode: 'Markdown'`. При этом он пытается вывести сгенерированный Gemini промпт (`newPrompt`) внутри обратных кавычек. Промпт от Gemini — это произвольный текст, который содержит точки, скобки, звездочки или другие спецсимволы. Telegram пытается интерпретировать эти символы как форматирование Markdown, не находит закрывающие теги и возвращает ошибку `Bad Request: can't parse entities`. Из-за этого вызов `editMessageText` падает.
* **Решение:** Перейти на режим форматирования `HTML`, который является абсолютно стабильным, и безопасно экранировать спецсимволы (`<`, `>`, `&`) перед отправкой.

#### Код исправления (для `src/bot.ts` и `index.ts`):
```typescript
const escapedPrompt = newPrompt
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

await ctx.api.editMessageText(
    ctx.chat.id,
    waitMsg.message_id,
    `✅ <b>Анализ завершен!</b> Я изучил ваш стиль общения и обновил системный промпт.\n\n` +
    `Вот новая инструкция (вы можете изменить её вручную в любой момент):\n\n<code>${escapedPrompt}</code>`,
    { parse_mode: "HTML" }
);
```

---

### 3. Утечка временных файлов на диске (Disk Space/File Descriptor Leak)
* **Где находится:** `src/bot.ts` (строки 115-139).
* **Симптомы:** Постепенное заполнение дискового пространства временной папки сервера (`tmp`), что в итоге может привести к сбою операционной системы или остановке бота.
* **Причина:** При получении медиафайлов от пользователя (фото, видео и т.д.) бот скачивает их во временный файл `tempFilePath`. Затем вызывается `generateResponse`. Если при генерации ответа Gemini падает с ошибкой (например, из-за лимитов API или отсутствия сети), выполнение функции прерывается и строчка удаления файла `fs.unlinkSync(tempFilePath)` никогда не вызывается. Файл остается лежать на диске навсегда.
* **Решение:** Использовать блок `try...finally` для гарантированного удаления временного файла вне зависимости от успешности выполнения API-запросов.

#### Код исправления (`src/bot.ts`):
```typescript
// Скачиваем файл...
let tempFilePath: string | undefined;
try {
    // ... логика скачивания ...
    
    const userName = message.from?.first_name || message.chat?.first_name || "";
    const answer = await generateResponse(chatId, connectionId, ownerId, userText, mimeType, tempFilePath, userName);

    const parts = splitMessage(answer);
    // ... отправка сообщений ...
} finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
            fs.unlinkSync(tempFilePath);
        } catch (e) {
            console.error("Failed to delete temp file:", e);
        }
    }
}
```

---

### 4. Ошибка типизации TypeScript / Потенциальный краш в генераторе опечаток
* **Где находится:** `src/utils.ts` (строки 8-15) и `supabase/functions/telegram-bot/index.ts` (строки 625-631).
* **Симптомы:** С вероятностью 10% (при симуляции опечатки) бот может крашнуться с ошибкой `TypeError: Cannot read properties of undefined (reading 'length')`.
* **Причина:** Из-за включенной опции `"noUncheckedIndexedAccess": true` в TSConfig, доступ по случайному индексу массива возвращает тип `T | undefined`. В коде:
  `const idx = validIndices[Math.floor(Math.random() * validIndices.length)];`
  Переменная `idx` может быть `undefined`. Из-за этого `words[idx]` также возвращает `undefined`. При обращении к `word.length` программа выбрасывает фатальное исключение и завершает процесс бота.
* **Решение:** Добавить безопасные проверки на `undefined`.

#### Код исправления (`src/utils.ts`):
```typescript
const idx = validIndices[Math.floor(Math.random() * validIndices.length)];
if (idx === undefined) return text;

const word = words[idx];
if (!word) return text;

const pos = Math.floor(Math.random() * (word.length - 2)) + 1;
const wordWithTypo = word.slice(0, pos) + word[pos + 1] + word[pos] + word.slice(pos + 2);

words[idx] = wordWithTypo;
return words.join(' ');
```

---

## 🟡 СРЕДНЯЯ КРИТИЧНОСТЬ (Нарушают логику или мешают масштабированию)

### 5. Проблема сортировки истории в SQLite (Недетерминированный контекст)
* **Где находится:** `src/database.ts` (строка 53).
* **Симптомы:** Бот теряет нить разговора, путает реплики местами или отвечает невпопад, когда сообщения приходят быстро.
* **Причина:** Сортировка истории чата происходит по полю `timestamp`:
  ```sql
  SELECT role, content FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?
  ```
  В SQLite `timestamp` сохраняется с точностью до секунды. Если пользователь отправил два сообщения подряд в одну секунду, или бот ответил в ту же секунду, порядок их сортировки становится случайным. Gemini получает историю с перепутанными репликами.
* **Решение:** Сортировать по первичному ключу автоинкремента `id`, который гарантированно возрастает последовательно.

#### Код исправления (`src/database.ts`):
```typescript
export function getHistory(chatId: number, connectionId: string, limit: number = 20): { role: Role; content: string }[] {
    const stmt = db.prepare(`
        SELECT role, content FROM (
            SELECT role, content, id FROM messages
            WHERE chat_id = ? AND connection_id = ?
            ORDER BY id DESC
            LIMIT ?
        ) ORDER BY id ASC
    `);
    const rows = stmt.all(chatId, connectionId, limit) as { role: Role; content: string }[];
    return rows;
}
```

---

### 6. Отсутствие самовосстановления связи (Self-Healing Connections)
* **Где находится:** Обработчики `business_message` в обеих версиях.
* **Симптомы:** Если база данных бота была сброшена, очищена или перенесена, бот перестает понимать, кто является владельцем бизнес-аккаунта (`ownerId` становится `0`), и начинает отвечать на сообщения самого владельца, путая его с клиентом.
* **Причина:** Связь `connection_id -> owner_id` записывается только один раз в событии `business_connection`. Если запись в БД потеряна, событие повторно не придет, пока владелец не переподключит бота в настройках Telegram.
* **Решение:** Автоматически обучаться и восстанавливать связь при получении сообщения от владельца. Так как в бизнес-чате участвуют только двое (клиент и владелец), если отправитель сообщения не равен `chatId` (клиенту), то этот отправитель гарантированно является владельцем аккаунта! Мы можем использовать этот момент для записи связи в БД.

#### Код исправления (`supabase/functions/telegram-bot/index.ts` строка 717-724):
```typescript
        const isOwner =
            (ownerId !== 0 && message.from?.id === ownerId) ||
            (message.from?.id !== chatId);
            
        if (isOwner) {
            // Если в БД не было этой связи, автоматически восстанавливаем её!
            if (ownerId === 0 && message.from?.id) {
                await addConnection(connectionId, message.from.id);
                console.log(`[Self-Healing] Восстановлена связь для Connection: ${connectionId} -> Owner: ${message.from.id}`);
            }
            await setPausedChat(chatId);
            return;
        }
```
