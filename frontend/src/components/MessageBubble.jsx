import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Bot, User, Copy, Check, ChevronDown, ChevronRight, BrainCircuit } from 'lucide-react';

function CodeBlock({ language, value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span>{language || 'code'}</span>
        <button className={`code-copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy}>
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: 13, background: '#0d0d14' }}
        showLineNumbers={value.split('\n').length > 5}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

function ThoughtBlock({ content, isStreaming }) {
  // If streaming, keep it open. Otherwise, default to closed but allow user to toggle.
  const [userOpened, setUserOpened] = useState(false);
  const isOpen = isStreaming || userOpened;

  return (
    <div className="thought-container">
      <button 
        className={`thought-header ${isOpen ? 'active' : ''}`} 
        onClick={() => setUserOpened(!userOpened)}
        disabled={isStreaming} // Disable manual toggle while streaming to prevent flickering
        type="button"
      >
        <div className="thought-title">
          <BrainCircuit size={16} className="thought-icon" />
          <span>{isStreaming ? 'AI กำลังวิเคราะห์... (Thinking)' : 'Thought Process (กระบวนการคิด)'}</span>
        </div>
        {!isStreaming && (isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
      </button>
      {isOpen && (
        <div className="thought-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ message, isLastAI }) {
  const isUser = message.role === 'user';
  const isStreaming = isLastAI && !message.done; // We'll need to pass this from Chat component

  const components = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const value = String(children).replace(/\n$/, '');
      if (!inline && match) {
        return <CodeBlock language={match[1]} value={value} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  };

  // Extract <think>...</think> content
  let displayContent = message.content || '';
  let thoughtContent = '';

  const thinkMatch = displayContent.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  if (thinkMatch) {
    thoughtContent = thinkMatch[1];
    displayContent = displayContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
  }

  return (
    <div className={`msg-row ${isUser ? 'user' : 'ai'}`}>
      <div className={`msg-avatar ${isUser ? 'user' : 'ai'}`}>
        {isUser
          ? <User size={16} color="var(--text-secondary)" />
          : <Bot size={16} color="#fff" />
        }
      </div>
      <div className="msg-content">
        <div className="msg-bubble">
          {message.image && (
            <img src={message.image} alt="Uploaded" className="msg-image" />
          )}
          
          {thoughtContent && (
            <ThoughtBlock 
              content={thoughtContent} 
              isStreaming={isStreaming || displayContent === ''} 
            />
          )}

          {isUser ? (
            <span style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</span>
          ) : (
            displayContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {displayContent}
              </ReactMarkdown>
            ) : (
              !thoughtContent && <span className="typing-dots">...</span>
            )
          )}
        </div>
        {message.timestamp && (
          <div className="msg-time">{formatTime(message.timestamp)}</div>
        )}
      </div>
    </div>
  );
}
