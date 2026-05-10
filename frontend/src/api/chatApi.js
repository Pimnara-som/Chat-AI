const API_BASE = '/api';

/** Safely parse JSON from a Response — avoids crash on empty / HTML bodies */
async function safeJson(res) {
  const text = await res.text();
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

export async function fetchConversations() {
  try {
    const res = await fetch(`${API_BASE}/conversations`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await safeJson(res);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('fetchConversations failed:', err.message);
    return [];
  }
}

export async function fetchConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`);
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = await safeJson(res);
  if (!data) throw new Error('Empty response from server');
  return data;
}

export async function createConversation() {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return safeJson(res);
}

export async function deleteConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return safeJson(res);
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
      // Safely read error body — may be empty or HTML
      const errData = await safeJson(res);
      onError(errData?.error || `Request failed (${res.status})`);
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
      buffer = lines.pop(); // keep incomplete line in buffer

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
        } catch (_) { /* ignore malformed SSE lines */ }
      }
    }
  } catch (err) {
    const msg = err.message || 'Network error';
    // Provide clearer message when backend is unreachable
    onError(msg.includes('fetch') ? 'Cannot connect to backend. Is the server running?' : msg);
  }
}

