import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Copy, Check, ChevronDown, ChevronRight,
  BrainCircuit, Loader2, Sparkles, ThumbsUp,
  ThumbsDown, RotateCcw, Volume2, Terminal,
} from 'lucide-react';

/* ─── Code Block ────────────────────────────────────────────────── */
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
        <div className="code-block-lang">
          <Terminal size={12} />
          <span>{language || 'code'}</span>
        </div>
        <button className={`code-copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy}>
          {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: 13, background: '#0d0d14', lineHeight: 1.7 }}
        showLineNumbers={value.split('\n').length > 5}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

/* ─── Thought Block ─────────────────────────────────────────────── */
function ThoughtBlock({ content, isStreaming }) {
  const [isOpen, setIsOpen] = useState(isStreaming);

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
            ? <Loader2 size={14} className="thought-icon spinning" />
            : <BrainCircuit size={14} className="thought-icon" />
          }
          <span>{isStreaming ? 'กำลังวิเคราะห์...' : 'กระบวนการคิด'}</span>
          {!isStreaming && content && (
            <span className="thought-word-count">{content.split(' ').length} words</span>
          )}
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

/* ─── AI Avatar with animated gradient ─────────────────────────── */
function AIAvatar({ isStreaming }) {
  return (
    <div className={`msg-avatar ai ${isStreaming ? 'gemini-pulse' : ''}`}>
      <Sparkles size={15} color="#fff" />
    </div>
  );
}

/* ─── User Avatar ───────────────────────────────────────────────── */
function UserAvatar() {
  return (
    <div className="msg-avatar user">
      <span className="user-avatar-letter">U</span>
    </div>
  );
}

/* ─── Time Formatter ────────────────────────────────────────────── */
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

/* ─── Strip agent noise from raw content ────────────────────────── */
function cleanDisplay(text) {
  if (!text) return '';
  return text
    // Only strip tool/agent blockquotes (contain 🛠️ or agent JSON fences)
    .replace(/^> 🛠️.*$\n?/gm, '')
    .replace(/^> ```[\s\S]*?^> ```\n?/gm, '')
    // Strip JSON action blocks (intermediate agent steps)
    .replace(/```json\n?\{[\s\S]*?"action"[\s\S]*?\}\n?```/g, '')
    // Strip bare JSON objects that look like agent actions (only whole-line JSON)
    .replace(/^\{[\s\S]*?"action"\s*:[\s\S]*?\}\s*$/gm, '')
    // Strip leftover channel/turn tags
    .replace(/<\|channel\|>/gi, '')
    .replace(/<\|turn\|>/gi, '')
    .trim();
}

/* ─── Parse agent / model output ────────────────────────────────── */
function parseContent(raw) {
  if (!raw) return { display: '', thought: '' };
  let display = raw;
  let thought = '';

  // 1. Native <think>...</think> (Gemma native thinking)
  const thinkMatch = display.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  if (thinkMatch) {
    thought = thinkMatch[1].trim();
    display = display.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    return { display: cleanDisplay(display), thought };
  }

  // 2. <|channel|>thought ... (PARL fine-tuned model format)
  const lowerDisplay = display.toLowerCase();
  const thoughtTagIdx = lowerDisplay.indexOf('<|channel|>thought');
  if (thoughtTagIdx !== -1) {
    const afterTagStart = thoughtTagIdx + '<|channel|>thought'.length;
    let contentStart = afterTagStart;
    while (contentStart < display.length && display[contentStart] === ' ') contentStart++;

    const rest = display.slice(contentStart);
    const closingIdx = rest.toLowerCase().indexOf('<|channel|>');
    if (closingIdx !== -1) {
      thought = rest.slice(0, closingIdx).trim();
      const afterThought = rest.slice(closingIdx);
      display = afterThought.replace(/<\|channel\|>[^<]*/gi, '').replace(/<\|turn\|>/gi, '').trim();
    } else {
      // Still streaming thought — display is empty until thought ends
      thought = rest.trim();
      display = '';
    }
    return { display: cleanDisplay(display), thought };
  }

  // 3. Strip leftover channel tags (non-thought channels)
  if (display.includes('<|channel|>')) {
    const match = display.match(/<\|channel\|>(\w+)\s*([\s\S]*)/i);
    if (match) thought = `[${match[1]}] ${match[2].trim()}`;
    display = display.replace(/<\|channel\|>[\s\S]*/gi, '').trim();
    return { display: cleanDisplay(display), thought };
  }

  // 4. Agent JSON format — extract answer from finish action
  const jsonBlockMatch = display.match(/```json\n?([\s\S]*?)\n?```/);
  const jsonInlineMatch = display.match(/(\{[\s\S]*\})/);
  const jsonMatch = jsonBlockMatch || jsonInlineMatch;
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[1].trim());
      if (obj.thought) thought = obj.thought;
      if (obj.action === 'finish' && obj.params?.answer) return { display: cleanDisplay(obj.params.answer), thought };
      if (obj.answer) return { display: cleanDisplay(obj.answer), thought };
      if (obj.action && obj.action !== 'finish') return { display: '', thought: thought || JSON.stringify(obj) };
    } catch (_) {}
  }

  return { display: cleanDisplay(display), thought };
}

/* ─── Main Component ────────────────────────────────────────────── */
export default function MessageBubble({ message, isStreaming }) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
          <a href={href} className="citation-link" title="View Reference" {...props}>
            {children}
          </a>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    },
  };

  const { display: displayContent, thought: thoughtContent } = parseContent(message.content);

  // Process citations [1] → clickable links
  let processedDisplay = displayContent;
  if (processedDisplay) {
    processedDisplay = processedDisplay.replace(/\[([\d,\s]+)\]/g, (match, nums) => {
      if (/^\d+(?:,\s*\d+)*$/.test(nums)) {
        return `[${match}](citation:${nums.replace(/\s+/g, '')})`;
      }
      return match;
    });
    processedDisplay = processedDisplay.replace(/<\|channel\|>/g, '').replace(/<\|turn\|>/g, '').trim();
  }

  // Shimmer: only show when truly nothing yet (no thought, no answer)
  const showThinkingSpinner = isStreaming && !thoughtContent && !processedDisplay;

  return (
    <div className={`msg-row ${isUser ? 'user' : 'ai'}${isStreaming ? ' streaming' : ''}`}>
      {/* Avatar */}
      {isUser ? <UserAvatar /> : <AIAvatar isStreaming={isStreaming} />}

      <div className="msg-content">
        {/* Bubble */}
        <div className={`msg-bubble${isStreaming ? ' gemini-streaming' : ''}`}>
          {/* Attached image */}
          {message.image && (
            <img src={message.image} alt="Uploaded" className="msg-image" />
          )}

          {/* Thought block */}
          {thoughtContent && (
            <ThoughtBlock content={thoughtContent} isStreaming={isStreaming && !displayContent} />
          )}

          {/* Main content or shimmer */}
          {isUser ? (
            <span style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</span>
          ) : processedDisplay ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {processedDisplay}
            </ReactMarkdown>
          ) : showThinkingSpinner ? (
            <div className="gemini-loader">
              <div className="gemini-line" style={{ width: '88%' }}></div>
              <div className="gemini-line" style={{ width: '68%', animationDelay: '0.15s' }}></div>
              <div className="gemini-line" style={{ width: '50%', animationDelay: '0.3s' }}></div>
            </div>
          ) : null}
        </div>

        {/* Footer: time + actions */}
        <div className={`msg-footer ${isUser ? 'user' : 'ai'}`}>
          {message.timestamp && (
            <span className="msg-time">{formatTime(message.timestamp)}</span>
          )}
          {!isUser && displayContent && !isStreaming && (
            <div className="msg-actions">
              <button className="msg-action-btn" onClick={handleCopy} title="คัดลอก">
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button className="msg-action-btn" title="ฟัง">
                <Volume2 size={13} />
              </button>
              <button className="msg-action-btn" title="ถูกใจ">
                <ThumbsUp size={13} />
              </button>
              <button className="msg-action-btn" title="ไม่ถูกใจ">
                <ThumbsDown size={13} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
