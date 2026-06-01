# 🚀 Развёртывание Telegram Business Bot на Lovable + Supabase

## Обзор

Бот мигрирован с Node.js + SQLite на **Supabase Edge Functions (Deno) + PostgreSQL**.  
Вся логика сохранена: автоответы через Gemini AI, имитация человека (опечатки, задержки, стикеры), обучение на истории переписки.

---

## Предварительные требования

- Аккаунт [Lovable.dev](https://lovable.dev)
- Аккаунт [Supabase](https://supabase.com)
- Telegram Bot Token от [@BotFather](https://t.me/BotFather) (бот должен иметь Telegram Business подключение)
- Google Gemini API Key из [Google AI Studio](https://aistudio.google.com/apikey)
- (Опционально) [Supabase CLI](https://supabase.com/docs/guides/cli) для деплоя из терминала

---

## Шаг 1: Создание проекта в Supabase

1. Зайдите на [app.supabase.com](https://app.supabase.com)
2. Нажмите **New Project**
3. Выберите регион, задайте пароль БД
4. Дождитесь создания проекта
5. Запишите:
   - **Project URL** — `https://ваш-проект.supabase.co`
   - **Service Role Key** — в Settings → API → `service_role` (секретный ключ!)
   - **Project Ref** — ID проекта (видно в URL: `app.supabase.com/project/ВАШ_REF`)

---

## Шаг 2: Создание таблиц (миграция БД)

1. Откройте **SQL Editor** в Supabase Dashboard
2. Скопируйте содержимое файла:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
3. Вставьте в SQL Editor и нажмите **Run**
4. Убедитесь, что таблицы созданы:
   - `messages` — история сообщений
   - `connections` — бизнес-соединения
   - `owner_settings` — настройки (промпт, сессия)
   - `paused_chats` — паузы после ответа владельца
   - `stickers` — стикеры для отправки

---

## Шаг 3: Настройка секретов

### Вариант A: Через Supabase CLI

```bash
# Установите CLI, если ещё нет
npm install -g supabase

# Залогиньтесь
supabase login

# Привяжите проект
supabase link --project-ref ВАШ_PROJECT_REF

# Установите секреты
supabase secrets set BOT_TOKEN="ваш_токен_бота"
supabase secrets set GEMINI_API_KEY="ваш_ключ_gemini"
supabase secrets set SUPABASE_URL="https://ваш-проект.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="ваш_service_role_ключ"
supabase secrets set SYSTEM_PROMPT="Ты обычный человек, общаешься в Telegram. Тебе пишет собеседник. Твоя задача поддерживать беседу естественно."
```

### Вариант B: Через Dashboard

1. Settings → Edge Functions → Environment Variables
2. Добавьте каждую переменную:
   - `BOT_TOKEN`
   - `GEMINI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SYSTEM_PROMPT`

---

## Шаг 4: Деплой Edge Function

```bash
# Из корня проекта
supabase functions deploy telegram-bot --no-verify-jwt
```

> ⚠️ Флаг `--no-verify-jwt` **обязателен** — Telegram отправляет webhook-запросы без JWT-токена Supabase.

Ваша функция будет доступна по адресу:
```
https://ВАШ_PROJECT_REF.supabase.co/functions/v1/telegram-bot
```

---

## Шаг 5: Установка Webhook в Telegram

Выполните в терминале (или в браузере):

```bash
curl "https://api.telegram.org/botВАШ_BOT_TOKEN/setWebhook?url=https://ВАШ_PROJECT_REF.supabase.co/functions/v1/telegram-bot"
```

Ожидаемый ответ:
```json
{"ok": true, "result": true, "description": "Webhook was set"}
```

### Проверка webhook:
```bash
curl "https://api.telegram.org/botВАШ_BOT_TOKEN/getWebhookInfo"
```

---

## Шаг 6: Подключение к Lovable (опционально)

Если вы хотите создать React-админку для управления ботом через Lovable:

1. Откройте проект в [Lovable](https://lovable.dev)
2. Перейдите в **Integrations → Supabase**
3. Подключите ваш Supabase-проект
4. Edge Function уже задеплоена и работает — Lovable будет использовать Supabase для фронтенда

---

## Устранение неполадок

### Бот не отвечает на сообщения
1. Проверьте webhook: `getWebhookInfo` (см. выше)
2. Посмотрите логи Edge Function:  
   **Supabase Dashboard → Edge Functions → telegram-bot → Logs**
3. Убедитесь, что секреты установлены: `supabase secrets list`

### Ошибка 401/403 при вызове функции
- Убедитесь, что деплой был с флагом `--no-verify-jwt`
- Перезадеплойте: `supabase functions deploy telegram-bot --no-verify-jwt`

### Ошибка «relation does not exist»
- Миграция не была выполнена. Запустите SQL из `001_initial_schema.sql` заново

### Бот отвечает на сообщения владельца
- Проверьте, что бизнес-соединение установлено (бот должен быть подключен в настройках Telegram Business)
- При первом подключении бот сохраняет `connection_id → owner_id`. Если это не произошло, бот не знает, кто владелец

### Таймаут Edge Function
- Supabase Edge Functions имеют лимит ~150 секунд
- Если анализ истории занимает слишком долго, попробуйте файл поменьше
- Gemini 2.5 Flash обычно отвечает за 5-15 секунд

---

## Отличия от оригинала

| Фича | Оригинал (Node.js) | Lovable (Supabase) |
|---|---|---|
| Среда выполнения | Node.js + tsx | Deno Edge Functions |
| База данных | SQLite (better-sqlite3) | PostgreSQL (Supabase) |
| Режим бота | Long polling (`bot.start()`) | Webhook (`webhookCallback`) |
| Сессии | In-memory (grammY session) | БД (`owner_settings` таблица) |
| Паузы чатов | In-memory `Map` | БД (`paused_chats` таблица) |
| Стикеры | JSON-строка в settings | Отдельная таблица `stickers` |
| Обработка файлов | Файловая система (tmp) | In-memory `Uint8Array` + base64/Blob |
| Деплой | Ручной (`npm start`) | `supabase functions deploy` |
| Масштабирование | Один процесс | Serverless (авто-масштабирование) |
| Устойчивость | Падает при краше | Stateless, автовосстановление |

---

## Структура файлов

```
supabase/
├── migrations/
│   └── 001_initial_schema.sql    # SQL-схема для PostgreSQL
└── functions/
    └── telegram-bot/
        └── index.ts              # Вся логика бота (Edge Function)
```

---

## Полезные команды

```bash
# Логи функции в реальном времени
supabase functions logs telegram-bot --tail

# Обновить секреты
supabase secrets set SYSTEM_PROMPT="Новый промпт"

# Удалить webhook (если нужно вернуться к polling-версии)
curl "https://api.telegram.org/botВАШ_BOT_TOKEN/deleteWebhook"

# Проверить статус функции
supabase functions list
```
