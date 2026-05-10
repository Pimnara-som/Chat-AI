import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';
import { Bot } from 'lucide-react';

function TypingIndicator() {
  return (
    <div className="msg-row ai">
      <div className="msg-avatar ai">
        <Bot size={16} color="#fff" />
      </div>
      <div className="msg-content">
        <div className="msg-bubble">
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatWindow({ messages, streamingText, isStreaming }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, isStreaming]);

  return (
    <div className="chat-window">
      <div className="chat-inner">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} isStreaming={false} />
        ))}

        {/* Streaming message currently being typed */}
        {isStreaming && streamingText && (
          <MessageBubble
            isStreaming={true}
            message={{ id: '__streaming__', role: 'assistant', content: streamingText }}
          />
        )}

        {/* Typing indicator while waiting for very first chunk */}
        {isStreaming && !streamingText && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

