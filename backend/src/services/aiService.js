import { HfInference } from '@huggingface/inference';
import dotenv from 'dotenv';
dotenv.config();

const hf = new HfInference(process.env.HF_API_KEY);
const MODEL = process.env.AI_MODEL || 'Phonsiri/Gemma-4-E4B-it-PARL';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 2048;

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `You are a helpful AI assistant. You can speak both Thai and English fluently. 
Be friendly, helpful, and concise in your responses. 
Format your responses using markdown when appropriate (code blocks, lists, bold text, tables, etc.).
When writing code, always specify the language for syntax highlighting.`;

/**
 * Stream a response from HuggingFace Inference API.
 * @param {Array<{role:string, content:string}>} messages
 * @param {Function} onChunk  - called with each text delta
 * @param {Function} onDone   - called with full accumulated text
 * @param {Function} onError  - called on error
 */
export async function generateStreamingResponse(messages, onChunk, onDone, onError) {
  try {
    const formattedMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    let fullText = '';

    const stream = hf.chatCompletionStream({
      model: MODEL,
      messages: formattedMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || '';
      if (delta) {
        fullText += delta;
        onChunk(delta);
      }
    }

    onDone(fullText);
  } catch (error) {
    console.error('HuggingFace AI Error:', error);
    onError(error);
  }
}
