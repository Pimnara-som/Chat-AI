import express from 'express';
import { generateStreamingResponse } from '../services/aiService.js';
import {
  getConversation,
  addMessage,
  createConversation,
} from '../store/conversations.js';

const router = express.Router();

// POST /api/chat/stream — SSE streaming chat
router.post('/stream', async (req, res) => {
  const { conversationId, message } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  let conv;
  if (conversationId) {
    conv = getConversation(conversationId);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  } else {
    conv = createConversation();
  }

  // Save user message
  const userMsg = addMessage(conv.id, 'user', message.trim());

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send init event with conversation info
  res.write(
    `data: ${JSON.stringify({ type: 'init', conversationId: conv.id, messageId: userMsg.id })}\n\n`
  );

  // Build message history for AI
  const messages = conv.messages.map((m) => ({ role: m.role, content: m.content }));

  await generateStreamingResponse(
    messages,
    (chunkText) => {
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkText })}\n\n`);
    },
    (fullText) => {
      const assistantMsg = addMessage(conv.id, 'assistant', fullText);
      res.write(
        `data: ${JSON.stringify({ type: 'done', messageId: assistantMsg.id })}\n\n`
      );
      res.end();
    },
    (error) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    }
  );
});

export default router;
