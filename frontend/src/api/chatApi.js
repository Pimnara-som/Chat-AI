const API_BASE = '/api';

// Get or create userId
function getUserId() {
  let userId = localStorage.getItem('chat_user_id');
  if (!userId) {
    userId = 'user_' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem('chat_user_id', userId);
  }
  return userId;
}

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
    const res = await fetch(`${API_BASE}/conversations`, {
      headers: { 'X-User-Id': getUserId() }
    });
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    const data = await safeJson(res);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('fetchConversations failed:', err.message);
    return [];
  }
}

export async function fetchConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, {
    headers: { 'X-User-Id': getUserId() }
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  const data = await safeJson(res);
  if (!data) throw new Error('Empty response from server');
  return data;
}

export async function createConversation() {
  const res = await fetch(`${API_BASE}/conversations`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'X-User-Id': getUserId()
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return safeJson(res);
}

export async function deleteConversation(id) {
  const res = await fetch(`${API_BASE}/conversations/${id}`, { 
    method: 'DELETE',
    headers: { 'X-User-Id': getUserId() }
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return safeJson(res);
}

/**
 * Send a message with streaming SSE.
 * @param {string|null} conversationId
 * @param {string} message
 * @param {string|null} image
 * @param {Function} onInit    - ({conversationId})
 * @param {Function} onChunk   - (textDelta)
 * @param {Function} onDone    - ()
 * @param {Function} onError   - (errorMsg)
 */
export async function sendMessageStream(conversationId, message, image, mode = 'search', onInit, onChunk, onDone, onError) {
  try {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-User-Id': getUserId()
      },
      body: JSON.stringify({ conversationId, message, image, mode }),
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
          if (event.type === 'init')         onInit(event);
          if (event.type === 'chunk')        onChunk({ text: event.text, kind: 'answer' });
          if (event.type === 'thought_start') onChunk({ text: '', kind: 'thought_start' });
          if (event.type === 'thought_chunk') onChunk({ text: event.text, kind: 'thought' });
          if (event.type === 'thought_end')   onChunk({ text: '', kind: 'thought_end' });
          if (event.type === 'done')         onDone();
          if (event.type === 'error')        onError(event.message);
        } catch (_) { /* ignore malformed SSE lines */ }
      }
    }
  } catch (err) {
    const msg = err.message || 'Network error';
    // Provide clearer message when backend is unreachable
    onError(msg.includes('fetch') ? 'Cannot connect to backend. Is the server running?' : msg);
  }
}

