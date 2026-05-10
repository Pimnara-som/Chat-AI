import express from 'express';
import {
  getAllConversations,
  getConversation,
  createConversation,
  deleteConversation,
  updateTitle,
  clearAllConversations,
} from '../store/conversations.js';

const router = express.Router();

// GET /api/conversations
router.get('/', (req, res) => {
  const convs = getAllConversations().map((c) => ({
    id: c.id,
    title: c.title,
    messageCount: c.messages.length,
    lastMessage:
      c.messages.length > 0
        ? c.messages[c.messages.length - 1].content.slice(0, 100)
        : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  }));
  res.json(convs);
});

// POST /api/conversations
router.post('/', (req, res) => {
  const { title } = req.body;
  const conv = createConversation(title);
  res.status(201).json(conv);
});

// GET /api/conversations/:id
router.get('/:id', (req, res) => {
  const conv = getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  res.json(conv);
});

// PUT /api/conversations/:id/title
router.put('/:id/title', (req, res) => {
  const { title } = req.body;
  const ok = updateTitle(req.params.id, title);
  if (!ok) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ success: true });
});

// DELETE /api/conversations/:id
router.delete('/:id', (req, res) => {
  const ok = deleteConversation(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ success: true });
});

// DELETE /api/conversations (clear all)
router.delete('/', (req, res) => {
  clearAllConversations();
  res.json({ success: true });
});

export default router;
