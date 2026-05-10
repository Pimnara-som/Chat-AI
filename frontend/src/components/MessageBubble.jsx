import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Bot, User, Copy, Check, ChevronDown, ChevronRight, BrainCircuit, Loader2 } from 'lucide-react';

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
  const [isOpen, setIsOpen] = useState(isStreaming); // open while streaming, closed after

  // When streaming ends, auto-close
  useEffect(() => {
    if (!isStreaming) setIsOpen(false);
  }, [isStreaming]);

  return (
    <div className="thought-container">
      <button
        className={`thought-header ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(v => !v)}
        type="button"
      >
        <div className="thought-title">
          {isStreaming
            ? <Loader2 size={15} className="thought-icon spinning" />
            : <BrainCircuit size={15} className="thought-icon" />
          }
          <span>{isStreaming ? 'กำลังวิเคราะห์...' : 'กระบวนการคิด'}</span>
        </div>
        <span className="thought-chevron">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {isOpen && content && (
        <div className="thought-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Parse agent output:
 *  - <think>...</think>  → thoughtContent  (native Gemma thinking)
 *  - "thought":"..." JSON → thoughtContent  (agent ReAct step)
 *  - "answer":"..."       → displayContent  (final answer)
 *  - raw intermediate JSON → hide from display, show thought only
 */
function parseContent(raw) {
  let display = raw || '';
  let thought = '';

  // 1. Native <think>...</think> tags (Gemma native thinking)
  const thinkMatch = display.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  if (thinkMatch) {
    thought = thinkMatch[1].trim();
    display = display.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    return { display, thought };
  }

  // 2. <|channel|>thought ... (model internal channel format)
  // More robust regex: allow optional space after <|channel|> and handle multiple thought patterns
  const channelThoughtMatch = display.match(/<\|channel\|>\s*thought\s*([\s\S]*?)(?:<\|channel\|>|$)/i);
  if (channelThoughtMatch) {
    thought = channelThoughtMatch[1].trim();
    // Remove the thought block from display
    display = display.replace(/<\|channel\|>\s*thought[\s\S]*?(?:<\|channel\|>|$)/i, '').trim();
    // Also strip any remaining <|channel|> tags or <|turn|> tags
    display = display.replace(/<\|channel\|>[^<]*/g, '').replace(/<\|turn\|>/g, '').trim();
    return { display, thought };
  }

  // 3. Strip any leftover <|channel|> prefixes from display
  if (display.includes('<|channel|>')) {
    // Extract text after the last channel tag as thought
    const lastChannelMatch = display.match(/<\|channel\|>(\w+)\s*([\s\S]*)/);
    if (lastChannelMatch) {
      thought = `[${lastChannelMatch[1]}] ${lastChannelMatch[2].trim()}`;
    }
    display = display.replace(/<\|channel\|>[\s\S]*/g, '').trim();
    return { display, thought };
  }

  // 4. Agent JSON format ("thought" / "action" / "answer" fields)
  const hasJson = display.includes('"thought":') || display.includes('"action":');
  if (!hasJson) return { display, thought };

  // Extract thought field
  const tMatch = display.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (tMatch) thought = tMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');

  // Extract answer field (finish action)
  const aMatch = display.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (aMatch) {
    display = aMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  } else {
    // Intermediate step — hide raw JSON, show nothing in main bubble
    display = '';
  }

  return { display, thought };
}

export default function MessageBubble({ message, isStreaming }) {
  const isUser = message.role === 'user';

  const components = {
    code({ node, inline, className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || '');
      const value = String(children).replace(/\n$/, '');
      if (!inline && match) return <CodeBlock language={match[1]} value={value} />;
      return <code className={className} {...props}>{children}</code>;
    },
    a: ({ node, href, children, ...props }) => {
      if (href && href.startsWith('citation:')) {
        return (
          <a href={href} className="citation-link" title={`View Reference`} {...props}>
            {children}
          </a>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
  };

  const { display: displayContent, thought: thoughtContent } = parseContent(message.content);

  // Preprocess displayContent to convert [1], [1, 5] into markdown links
  let processedDisplay = displayContent;
  if (processedDisplay) {
    processedDisplay = processedDisplay.replace(/\[([\d,\s]+)\]/g, (match, nums) => {
      if (/^\d+(?:,\s*\d+)*$/.test(nums)) {
        return `[${match}](citation:${nums.replace(/\s+/g, '')})`;
      }
      return match;
    });
    // Final cleanup of any lingering model tags
    processedDisplay = processedDisplay.replace(/<\|channel\|>/g, '').replace(/<\|turn\|>/g, '').trim();
  }

  // isStreaming prop is passed from ChatWindow for the live streaming bubble
  const showThinkingSpinner = isStreaming && !thoughtContent && !displayContent;

  return (
    <div className={`msg-row ${isUser ? 'user' : 'ai'} ${isStreaming ? 'streaming' : ''}`}>
      <div className={`msg-avatar ${isUser ? 'user' : 'ai'} ${isStreaming ? 'gemini-pulse' : ''}`}>
        {isUser ? <User size={16} color="var(--text-secondary)" /> : <Bot size={16} color="#fff" />}
      </div>
      <div className="msg-content">
        <div className={`msg-bubble ${isStreaming ? 'gemini-streaming' : ''}`}>
          {message.image && (
            <img src={message.image} alt="Uploaded" className="msg-image" />
          )}

          {thoughtContent && (
            <ThoughtBlock content={thoughtContent} isStreaming={isStreaming && !displayContent} />
          )}

          {isUser ? (
            <span style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</span>
          ) : processedDisplay ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {processedDisplay}
            </ReactMarkdown>
          ) : showThinkingSpinner ? (
            <div className="gemini-loader">
              <div className="gemini-line" style={{ width: '85%' }}></div>
              <div className="gemini-line" style={{ width: '65%' }}></div>
              <div className="gemini-line" style={{ width: '45%' }}></div>
            </div>
          ) : null}
        </div>
        {message.timestamp && (
          <div className="msg-footer">
            <div className="msg-time">{formatTime(message.timestamp)}</div>
            {!isUser && displayContent && (
              <button 
                className="msg-action-btn" 
                onClick={() => navigator.clipboard.writeText(displayContent)}
                title="Copy response"
              >
                <Copy size={12} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
