export function makeTypo(text: string): string {
    if (text.length < 5) return text;
    const words = text.split(' ');
    const validIndices = words.map((w, i) => w.length > 3 ? i : -1).filter(i => i !== -1);
    
    if (validIndices.length === 0) return text;
    
    const idx = validIndices[Math.floor(Math.random() * validIndices.length)];
    const word = words[idx];
    
    const pos = Math.floor(Math.random() * (word.length - 2)) + 1;
    const wordWithTypo = word.slice(0, pos) + word[pos + 1] + word[pos] + word.slice(pos + 2);
    
    words[idx] = wordWithTypo;
    return words.join(' ');
}

export function splitMessage(text: string): string[] {
    const parts: string[] = [];
    const paragraphs = text.split('\n\n');
    
    for (const p of paragraphs) {
        const trimmed = p.trim();
        if (!trimmed) continue;
        
        if (trimmed.length > 120) {
            const sentences = trimmed.match(/[^.!?]+[.!?]+/g) || [trimmed];
            let chunk = "";
            for (const s of sentences) {
                if (chunk.length + s.length > 120) {
                    if (chunk) parts.push(chunk.trim());
                    chunk = s + " ";
                } else {
                    chunk += s + " ";
                }
            }
            if (chunk.trim()) parts.push(chunk.trim());
        } else {
            parts.push(trimmed);
        }
    }
    
    const finalParts: string[] = [];
    let temp = "";
    for (const part of parts) {
        if (temp.length + part.length < 80) {
            temp += part + " ";
        } else {
            if (temp) finalParts.push(temp.trim());
            temp = part + " ";
        }
    }
    if (temp.trim()) finalParts.push(temp.trim());
    
    if (finalParts.length === 0) finalParts.push(text);
    return finalParts;
}

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
