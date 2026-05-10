import { v4 as uuidv4 } from 'uuid';

// In-memory conversation store
const conversations = new Map();

export function createConversation(title = 'New Chat') {
  const id = uuidv4();
  const now = new Date().toISOString();
  const conversation = { id, title, messages: [], createdAt: now, updatedAt: now };
  conversations.set(id, conversation);
  return conversation;
}

export function getConversation(id) {
  return conversations.get(id) || null;
}

export function getAllConversations() {
  return Array.from(conversations.values())
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function addMessage(conversationId, role, content) {
  const conv = conversations.get(conversationId);
  if (!conv) return null;

  const message = {
    id: uuidv4(),
    role,
    content,
    timestamp: new Date().toISOString(),
  };

  conv.messages.push(message);
  conv.updatedAt = new Date().toISOString();

  // Auto-title from first user message
  if (role === 'user' && conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = content.slice(0, 60) + (content.length > 60 ? '...' : '');
  }

  return message;
}

export function updateTitle(conversationId, title) {
  const conv = conversations.get(conversationId);
  if (!conv) return false;
  conv.title = title;
  return true;
}

export function deleteConversation(id) {
  return conversations.delete(id);
}

export function clearAllConversations() {
  conversations.clear();
}
