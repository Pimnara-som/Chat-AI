import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();

// vLLM exposes an OpenAI-compatible REST API
const client = new OpenAI({
  baseURL: process.env.VLLM_BASE_URL || 'http://localhost:8000/v1',
  apiKey:  process.env.VLLM_API_KEY  || 'EMPTY', // vLLM doesn't require auth by default
});

const MODEL = process.env.AI_MODEL || 'Phonsiri/Gemma-4-E4B-it-PARL';
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS) || 2048;

const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  `You are a helpful AI assistant. You can speak both Thai and English fluently.
Be friendly, helpful, and concise in your responses.
Format your responses using markdown when appropriate (code blocks, lists, bold text, tables, etc.).
When writing code, always specify the language for syntax highlighting.`;

/**
 * Stream a response from vLLM using the OpenAI-compatible chat completions API.
 * @param {Array<{role:string, content:string}>} messages
 * @param {Function} onChunk  - called with each text delta string
 * @param {Function} onDone   - called with the full accumulated response text
 * @param {Function} onError  - called with an Error on failure
 */
export async function generateStreamingResponse(messages, onChunk, onDone, onError) {
  try {
    const formattedMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: formattedMessages,
      max_tokens: MAX_TOKENS,
      temperature: 0.7,
      stream: true,
    });

    let fullText = '';

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        fullText += delta;
        onChunk(delta);
      }
    }

    onDone(fullText);
  } catch (error) {
    console.error('vLLM AI Error:', error?.message || error);
    onError(error);
  }
}

