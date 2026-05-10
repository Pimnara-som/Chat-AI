import { useState, useCallback, useEffect } from 'react';
import { PanelLeftOpen, Cpu } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import InputBar from './components/InputBar.jsx';
import WelcomeScreen from './components/WelcomeScreen.jsx';
import {
  fetchConversations,
  fetchConversation,
  deleteConversation,
  sendMessageStream,
} from './api/chatApi.js';

const MODEL_DISPLAY = 'Gemma-4-E4B-it-PARL';

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [currentId, setCurrentId]         = useState(null);
  const [messages, setMessages]           = useState([]);
  const [isStreaming, setIsStreaming]      = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [sidebarOpen, setSidebarOpen]     = useState(true);
  const [error, setError]                 = useState(null);

  // Load sidebar conversation list
  const loadConversations = useCallback(async () => {
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch (_) {}
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Select an existing conversation
  const handleSelect = useCallback(async (id) => {
    try {
      const conv = await fetchConversation(id);
      setCurrentId(conv.id);
      setMessages(conv.messages);
      setStreamingText('');
      setError(null);
    } catch (_) { setError('Failed to load conversation'); }
  }, []);

  // New chat
  const handleNew = useCallback(() => {
    setCurrentId(null);
    setMessages([]);
    setStreamingText('');
    setError(null);
  }, []);

  // Delete conversation
  const handleDelete = useCallback(async (id) => {
    await deleteConversation(id);
    if (id === currentId) handleNew();
    loadConversations();
  }, [currentId, handleNew, loadConversations]);

  // Send message
  const handleSend = useCallback(async (text, image, mode = 'search') => {
    if (isStreaming) return;
    setError(null);

    // Optimistically add user message to UI
    const tempUserMsg = {
      id: `tmp_${Date.now()}`,
      role: 'user',
      content: text,
      image: image,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setIsStreaming(true);
    setStreamingText('');

    let resolvedConvId = currentId;

    await sendMessageStream(
      currentId,
      text,
      image,
      mode,
      // onInit
      (event) => {
        resolvedConvId = event.conversationId;
        setCurrentId(event.conversationId);
        loadConversations();
      },
      // onChunk
      (delta) => {
        setStreamingText((prev) => prev + delta);
      },
      // onDone
      async () => {
        setIsStreaming(false);
        setStreamingText('');
        // Reload full conversation to get accurate messages with IDs
        if (resolvedConvId) {
          try {
            const conv = await fetchConversation(resolvedConvId);
            setMessages(conv.messages);
          } catch (_) {}
        }
        loadConversations();
      },
      // onError
      (msg) => {
        setIsStreaming(false);
        setStreamingText('');
        setError(msg || 'Something went wrong. Please try again.');
      }
    );
  }, [isStreaming, currentId, loadConversations]);

  // Welcome screen suggestion click
  const handleSuggestion = useCallback((text) => {
    handleSend(text);
  }, [handleSend]);

  const currentTitle = conversations.find((c) => c.id === currentId)?.title || 'New chat';

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onNew={handleNew}
        onSelect={handleSelect}
        onDelete={handleDelete}
        collapsed={!sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />

      <div className="main">
        {/* Top bar */}
        <div className="topbar">
          <div className="topbar-left">
            {!sidebarOpen && (
              <button className="btn-icon" onClick={() => setSidebarOpen(true)} title="Open sidebar">
                <PanelLeftOpen size={17} />
              </button>
            )}
            <span className="topbar-title">{currentId ? currentTitle : 'AI Agent'}</span>
          </div>
          <div className="model-badge">
            <Cpu size={12} />
            {MODEL_DISPLAY}
          </div>
        </div>

        {/* Main content */}
        {messages.length === 0 && !isStreaming ? (
          <WelcomeScreen onSuggestion={handleSuggestion} />
        ) : (
          <ChatWindow
            messages={messages}
            streamingText={streamingText}
            isStreaming={isStreaming}
          />
        )}

        {/* Error banner */}
        {error && (
          <div style={{
            margin: '0 20px 8px',
            padding: '10px 16px',
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 8,
            fontSize: 13,
            color: '#fca5a5',
            maxWidth: 780,
            marginInline: 'auto',
            width: 'calc(100% - 40px)',
          }}>
            {error}
          </div>
        )}

        <InputBar onSend={handleSend} isLoading={isStreaming} />
      </div>
    </div>
  );
}
