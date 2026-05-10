const API_BASE = '/api';

export async function fetchConversations() {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

export async function fetchConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`);
  if (!res.ok) throw new Error('Failed to fetch conversation');
  return res.json();
}

export async function createConversation() {
  const res = await fetch(`${API_BASE}/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

export async function deleteConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete conversation');
  return res.json();
}

/**
 * Send a message with streaming SSE.
 * @param {string|null} conversationId
 * @param {string} message
 * @param {Function} onInit    - ({conversationId})
 * @param {Function} onChunk   - (textDelta)
 * @param {Function} onDone    - ()
 * @param {Function} onError   - (errorMsg)
 */
export async function sendMessageStream(conversationId, message, onInit, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, message }),
    });

    if (!res.ok) {
      const err = await res.json();
      onError(err.error || 'Request failed');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw);
          if (event.type === 'init')  onInit(event);
          if (event.type === 'chunk') onChunk(event.text);
          if (event.type === 'done')  onDone();
          if (event.type === 'error') onError(event.message);
        } catch (_) { /* ignore parse errors */ }
      }
    }
  } catch (err) {
    onError(err.message || 'Network error');
  }
}
