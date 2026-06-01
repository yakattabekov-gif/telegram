import { GoogleGenAI } from '@google/genai';
import { getHistory, getSetting, addMessage } from './database';

const DEFAULT_PROMPT = process.env.SYSTEM_PROMPT || "Ты человек.";

export async function generateResponse(
    chatId: number, 
    connectionId: string,
    ownerId: number,
    text: string, 
    mimeType?: string, 
    filePath?: string, 
    userName?: string
): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    let sysPrompt = getSetting(ownerId, 'system_prompt', DEFAULT_PROMPT);
    
    if (userName) {
        sysPrompt += `\n\n(Системная справка: Ты сейчас общаешься с человеком, которого зовут ${userName}. Учитывай это, но не обязательно использовать имя в каждом сообщении.)`;
    }

    const history = getHistory(chatId, connectionId, 9); // Оптимизировано до 9 сообщений
    
    // Convert history for gemini
    const contents: any[] = history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
    }));
    
    let currentMessageParts: any[] = [];
    if (text) {
        currentMessageParts.push({ text });
    }

    let uploadedFile: any;
    if (filePath && mimeType) {
        try {
            uploadedFile = await ai.files.upload({
                file: filePath,
                config: { mimeType: mimeType }
            });
            currentMessageParts.push({
                fileData: {
                    fileUri: uploadedFile.uri,
                    mimeType: mimeType
                }
            });
        } catch (e) {
            console.error("Failed to upload file to Gemini:", e);
        }
    }

    if (currentMessageParts.length === 0) {
        currentMessageParts.push({ text: "Пользователь отправил не поддерживаемое или слишком большое медиа." });
    } else if (!text && uploadedFile) {
        currentMessageParts.push({ text: "Опиши или прокомментируй это медиа." });
    }

    if (currentMessageParts.length > 0) {
        contents.push({ role: 'user', parts: currentMessageParts });
    }

    // Save to DB
    let dbLogText = text;
    if (!dbLogText && filePath) {
        dbLogText = `[Отправил медиафайл]`;
    }
    addMessage(chatId, connectionId, 'user', dbLogText || '');

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents,
            config: {
                systemInstruction: sysPrompt + "\n\n(Важно: Общайся естественно, как живой человек в мессенджере. Не будь слишком роботоподобным. При необходимости можешь давать развернутые ответы.)",
                temperature: 0.7,
                maxOutputTokens: 1000, // Увеличен лимит для поддержания нормального диалога
            }
        });

        const answer = response.text || "Ой, что-то со связью, напишу чуть позже...";
        addMessage(chatId, connectionId, 'model', answer);
        
        if (uploadedFile) {
            try {
                await ai.files.delete({ name: uploadedFile.name });
            } catch (e) {
                console.error("Error deleting file from gemini:", e);
            }
        }

        return answer;
    } catch (e) {
        console.error("Error calling Gemini:", e);
        const errAnswer = "Ой, что-то со связью, напишу чуть позже...";
        addMessage(chatId, connectionId, 'model', errAnswer);
        return errAnswer;
    }
}

export async function analyzeChatHistory(fileBuffer: Buffer, ownerName: string): Promise<string> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    let parsedText = "";
    try {
        const json = JSON.parse(fileBuffer.toString('utf-8'));
        if (json.messages && Array.isArray(json.messages)) {
            for (const msg of json.messages) {
                if (msg.type === 'message') {
                    let text = "";
                    if (typeof msg.text === 'string') {
                        text = msg.text;
                    } else if (Array.isArray(msg.text)) {
                        text = msg.text.map((t: any) => typeof t === 'string' ? t : t.text).join("");
                    }
                    if (text) {
                        parsedText += `${msg.from || 'Unknown'}: ${text}\n`;
                    }
                }
            }
        }
    } catch (e) {
        // Fallback if not Telegram JSON
        parsedText = fileBuffer.toString('utf-8');
    }

    // Limit to ~200k characters to avoid passing gigabytes, which is plenty for style analysis
    if (parsedText.length > 200000) {
        parsedText = parsedText.slice(-200000);
    }

    const prompt = `Ты — эксперт по анализу стиля общения. 
Твоя задача: проанализировать предоставленную историю переписки (владельца аккаунта зовут ${ownerName}) и создать максимально подробную инструкцию для ИИ-ассистента, чтобы он мог общаться точно в таком же стиле.

В ответе опиши:
- Тон общения (формальный, дружелюбный, сухой, эмоциональный и т.д.)
- Используются ли смайлики, как часто и какие именно
- Характерные слова, фразочки, междометия
- Длина предложений, склонность писать с заглавной буквы, ставить точки в конце
- Как он здоровается и прощается

Твоя цель — составить ИНСТРУКЦИЮ (System Prompt) для другой нейросети.
Верни ТОЛЬКО готовый текст инструкции, без твоих вводных слов, начинающийся со слов "Ты человек. Твоя задача общаться с клиентами. Твой стиль общения следующий: ...".`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { role: 'user', parts: [
                    { text: prompt },
                    { text: "История переписки:\n\n" + parsedText }
                ]}
            ],
            config: {
                temperature: 0.2,
            }
        });
        return response.text || "Не удалось проанализировать.";
    } catch (e) {
        console.error("Analysis error:", e);
        throw new Error("Ошибка при анализе файла с помощью Gemini.");
    }
}
