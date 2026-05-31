import { Bot, Context, session, SessionFlavor, Keyboard } from 'grammy';
import * as dotenv from 'dotenv';
import { generateResponse, analyzeChatHistory } from './gemini';
import { clearAllHistory, clearHistory, getSetting, setSetting, getStickers, addSticker, addStickers, clearStickers, addConnection, getOwnerId, clearHistoryByChatAndOwner } from './database';
import { makeTypo, splitMessage, delay } from './utils';
import fs from 'fs';
import os from 'os';
import path from 'path';

dotenv.config();

interface SessionData {
    step: 'idle' | 'waiting_for_prompt' | 'waiting_for_chat_id';
}
type MyContext = Context & SessionFlavor<SessionData>;

const bot = new Bot<MyContext>(process.env.BOT_TOKEN!);
bot.use(session({ initial: () => ({ step: 'idle' }) }));

const pausedChats = new Map<number, number>();

const mainKb = new Keyboard()
    .text("⚙️ Изменить промпт").row()
    .text("🧠 Обучить на истории").row()
    .text("🧹 Очистить чат клиента").text("🗑 Очистить всю историю").row()
    .text("🖼 Мои стикеры").text("❌ Очистить стикеры").row()
    .resized();

// ========================
// BUSINESS CONNECTIONS
// ========================
bot.on('business_connection', async (ctx) => {
    const conn = ctx.businessConnection;
    if (conn && conn.user) {
        addConnection(conn.id, conn.user.id);
        console.log(`Установлено бизнес-соединение. Owner ID: ${conn.user.id}, Connection ID: ${conn.id}`);
    }
});

// ========================
// BUSINESS MESSAGES HANDLER
// ========================
bot.on('business_message', async (ctx) => {
    const message = ctx.businessMessage;
    if (!message || !message.business_connection_id) return;
    
    const connectionId = message.business_connection_id;
    // Находим owner_id по connection_id. Если не найдено (баг или старое соединение), используем 0 как дефолт
    const ownerId = getOwnerId(connectionId) || 0;
    
    const chatId = message.chat.id;

    // Check if message is sent by the business owner (including saved messages)
    const isOwner = (ownerId !== 0 && message.from?.id === ownerId) || (message.from?.id !== chatId);
    if (isOwner) {
        // ОТКЛЮЧЕНО ДЛЯ ТЕСТОВ: pausedChats.set(chatId, Date.now());
        return;
    }

    /* ОТКЛЮЧЕНО ДЛЯ ТЕСТОВ
    if (pausedChats.has(chatId)) {
        const lastTime = pausedChats.get(chatId)!;
        if (Date.now() - lastTime < 8 * 60 * 1000) {
            return; // paused for 8 minutes
        }
    }
    */

    let userText = message.text || message.caption || "";
    let fileId: string | undefined;
    let mimeType: string | undefined;

    if (message.photo && message.photo.length > 0) {
        fileId = message.photo[message.photo.length - 1].file_id;
        mimeType = 'image/jpeg';
    } else if (message.video) {
        fileId = message.video.file_id;
        mimeType = message.video.mime_type || 'video/mp4';
    } else if (message.audio) {
        fileId = message.audio.file_id;
        mimeType = message.audio.mime_type;
    } else if (message.voice) {
        fileId = message.voice.file_id;
        mimeType = message.voice.mime_type || 'audio/ogg';
    } else if (message.sticker) {
        userText = `[Пользователь отправил стикер: ${message.sticker.emoji || 'без эмодзи'}]`;
        if (!message.sticker.is_animated && !message.sticker.is_video) {
            fileId = message.sticker.file_id;
            mimeType = 'image/webp';
        }
    }

    if (!userText && !fileId) return;

    // 1. Reading delay
    const readDelayMs = (Math.random() * 2000) + 2000;
    await delay(readDelayMs);

    // Случайная реакция на сообщение временно отключена, так как Bot API не поддерживает это для Business Message.
    
    // Отмечаем как прочитанное (две галочки) через Bot API
    try {
        // @ts-ignore
        if (ctx.api.raw.readBusinessMessage) {
            // @ts-ignore
            await ctx.api.raw.readBusinessMessage({
                business_connection_id: connectionId,
                chat_id: chatId,
                message_id: message.message_id
            });
        }
    } catch (e) {
        // Игнорируем ошибку чтения
    }

    // Download file if any
    let tempFilePath: string | undefined;
    if (fileId) {
        try {
            const fileInfo = await ctx.api.getFile(fileId);
            if (fileInfo.file_path) {
                const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
                const response = await fetch(url);
                const buffer = await response.arrayBuffer();
                
                const ext = path.extname(fileInfo.file_path) || '';
                tempFilePath = path.join(os.tmpdir(), `${fileId}${ext}`);
                fs.writeFileSync(tempFilePath, Buffer.from(buffer));
            }
        } catch (e) {
            console.error("Failed to download file:", e);
        }
    }

    // Generate response
    const userName = message.from?.first_name || message.chat?.first_name || "";
    const answer = await generateResponse(chatId, connectionId, ownerId, userText, mimeType, tempFilePath, userName);

    if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
    }

    const parts = splitMessage(answer);
    
    // С вероятностью 15% бот ответит реплаем на конкретное сообщение
    const shouldReply = Math.random() < 0.15;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        await ctx.api.sendChatAction(chatId, 'typing', { business_connection_id: connectionId });
        
        let typeDelay = Math.min(part.length * 50, 4000);
        typeDelay *= (Math.random() * 0.4 + 0.8);
        await delay(typeDelay);

        const simulateTypo = Math.random() < 0.10;
        const sendOptions: any = { business_connection_id: connectionId };
        
        // Добавляем реплай только к первому сообщению-кусочку
        if (i === 0 && shouldReply) {
            sendOptions.reply_parameters = { message_id: message.message_id };
        }

        if (simulateTypo) {
            const typoText = makeTypo(part);
            const sentMsg = await ctx.api.sendMessage(chatId, typoText, sendOptions);
            await delay(1000);
            try {
                await ctx.api.editMessageText(chatId, sentMsg.message_id, part, { business_connection_id: connectionId });
            } catch (e) {
                console.error("Failed to edit typo:", e);
            }
        } else {
            await ctx.api.sendMessage(chatId, part, sendOptions);
        }

        await delay((Math.random() * 1000) + 500);
    }

    // Отправка случайного стикера после ответа (шанс 15%)
    const stickers = getStickers(ownerId);
    if (stickers.length > 0 && Math.random() < 0.15) {
        const randomSticker = stickers[Math.floor(Math.random() * stickers.length)];
        try {
            await ctx.api.sendSticker(chatId, randomSticker, { business_connection_id: connectionId });
        } catch(e) {}
    }
});

// ========================
// OWNER BOT (PRIVATE MESSAGES)
// ========================
bot.command("start", async (ctx) => {
    await ctx.reply(
        "👋 Привет! Я ваш Telegram Business бот на TypeScript + Gemini.\n" +
        "Используйте кнопки ниже для управления настройками и историей.",
        { reply_markup: mainKb }
    );
});

bot.hears("🗑 Очистить всю историю", async (ctx) => {
    const ownerId = ctx.from?.id || 0;
    clearAllHistory(ownerId);
    await ctx.reply("✅ История всех диалогов очищена.", { reply_markup: mainKb });
});

bot.hears("🧹 Очистить чат клиента", async (ctx) => {
    ctx.session.step = 'waiting_for_chat_id';
    await ctx.reply("Введите ID чата клиента (число) для очистки истории.\n\nВнимание: Очистка происходит для всех ваших бизнес-подключений.", { reply_markup: mainKb });
});

bot.hears("🖼 Мои стикеры", async (ctx) => {
    const ownerId = ctx.from?.id || 0;
    const stickers = getStickers(ownerId);
    await ctx.reply(`В вашей базе сохранено стикеров: ${stickers.length}.\nЧтобы добавить новые, просто отправьте мне любой стикер.`);
});

bot.hears("❌ Очистить стикеры", async (ctx) => {
    const ownerId = ctx.from?.id || 0;
    clearStickers(ownerId);
    await ctx.reply("✅ Ваша база стикеров очищена.", { reply_markup: mainKb });
});

bot.on('message:sticker', async (ctx) => {
    const ownerId = ctx.from?.id || 0;
    const sticker = ctx.message.sticker;
    if (sticker) {
        const setName = sticker.set_name;
        if (setName) {
            try {
                const waitMsg = await ctx.reply("⏳ Загружаю весь стикерпак...");
                const stickerSet = await ctx.api.getStickerSet(setName);
                const fileIds = stickerSet.stickers.map(s => s.file_id);
                const added = addStickers(ownerId, fileIds);
                await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, `✅ Загружен стикерпак "${stickerSet.title}"!\nВ базу добавлено новых стикеров: ${added}.`);
            } catch(e) {
                console.error("Failed to load sticker set:", e);
                addSticker(ownerId, sticker.file_id);
                await ctx.reply("✅ Стикер добавлен в базу (не удалось загрузить весь пак).");
            }
        } else {
            addSticker(ownerId, sticker.file_id);
            await ctx.reply("✅ Одиночный стикер добавлен в базу!");
        }
    }
});

bot.hears("🧠 Обучить на истории", async (ctx) => {
    await ctx.reply(
        "Вы можете отправить мне файл с историей переписки (Telegram Export в формате JSON).\n\n" +
        "Я проанализирую, как вы общаетесь, и автоматически создам системный промпт (инструкцию) для бота, чтобы он максимально точно копировал ваш стиль.\n\n" +
        "Просто перетащите сюда файл `result.json`!"
    );
});

bot.on("message:document", async (ctx) => {
    const ownerId = ctx.from?.id || 0;
    const doc = ctx.message.document;
    
    if (!doc.file_name?.endsWith('.json') && !doc.file_name?.endsWith('.txt')) {
        await ctx.reply("Пожалуйста, отправьте файл в формате .json (Telegram Export) или .txt.");
        return;
    }

    if (doc.file_size && doc.file_size > 20 * 1024 * 1024) { // 20 MB limit
        await ctx.reply("Файл слишком большой. Пожалуйста, отправьте файл до 20 МБ.");
        return;
    }

    const waitMsg = await ctx.reply("⏳ Скачиваю и анализирую историю... Это может занять около минуты. Искусственный интеллект изучает ваш стиль...");
    
    try {
        const fileInfo = await ctx.api.getFile(doc.file_id);
        if (!fileInfo.file_path) throw new Error("Нет пути к файлу");
        
        const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileInfo.file_path}`;
        const response = await fetch(url);
        const buffer = Buffer.from(await response.arrayBuffer());

        const ownerName = ctx.from?.first_name || "Владелец";
        const newPrompt = await analyzeChatHistory(buffer, ownerName);

        setSetting(ownerId, 'system_prompt', newPrompt);

        await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, 
            `✅ **Анализ завершен!** Я изучил ваш стиль общения и обновил системный промпт.\n\n` +
            `Вот новая инструкция (вы можете изменить её вручную в любой момент):\n\n\`${newPrompt}\``,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        console.error(e);
        await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, "❌ Произошла ошибка при анализе файла.");
    }
});

bot.hears("⚙️ Изменить промпт", async (ctx) => {
    const ownerId = ctx.from?.id || 0;
    const currentPrompt = getSetting(ownerId, 'system_prompt', process.env.SYSTEM_PROMPT || "Ты человек.");
    await ctx.reply(
        `Текущий системный промпт:\n\n` + currentPrompt + `\n\nОтправьте новый системный промпт следующим сообщением. Чтобы отменить, отправьте /cancel`
    );
    ctx.session.step = 'waiting_for_prompt';
});

bot.on("message:text", async (ctx) => {
    const ownerId = ctx.from?.id || 0;
    const step = ctx.session.step;

    if (step === 'waiting_for_chat_id') {
        const text = ctx.message.text.trim();
        if (/^-?\d+$/.test(text)) {
            const targetChatId = parseInt(text, 10);
            clearHistoryByChatAndOwner(targetChatId, ownerId);
            await ctx.reply(`✅ История для чата ${targetChatId} очищена.`, { reply_markup: mainKb });
        } else {
            await ctx.reply("❌ Неверный формат. Ожидался ID чата (число). Операция отменена.", { reply_markup: mainKb });
        }
        ctx.session.step = 'idle';
    } 
    else if (step === 'waiting_for_prompt') {
        const text = ctx.message.text.trim();
        if (text === "/cancel") {
            await ctx.reply("Отменено.", { reply_markup: mainKb });
        } else {
            setSetting(ownerId, 'system_prompt', text);
            await ctx.reply("✅ Системный промпт успешно обновлен!", { reply_markup: mainKb });
        }
        ctx.session.step = 'idle';
    }
});

// Start bot
async function start() {
    // Запускаем Business бота
    bot.start({
        onStart: (botInfo) => {
            console.log(`Запуск бота @${botInfo.username}...`);
        }
    });
}

start().catch(console.error);
