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

  const hasContent = Boolean(content);
  
  let title = 'กระบวนการคิด';
  if (isStreaming) {
    title = hasContent ? 'กำลังวิเคราะห์...' : 'กำลังประมวลผลข้อมูล...';
  }

  return (
    <div className="thought-container">
      <button
        className={`thought-header ${isOpen ? 'active' : ''} ${!hasContent ? 'pulsing' : ''}`}
        onClick={() => hasContent && setIsOpen(v => !v)}
        type="button"
        style={{ cursor: hasContent ? 'pointer' : 'default' }}
      >
        <div className="thought-title">
          {isStreaming
            ? <Loader2 size={14} className="thought-icon spinning" />
            : <BrainCircuit size={14} className="thought-icon" />
          }
          <span>{title}</span>
          {!isStreaming && hasContent && (
            <span className="thought-word-count">{content.split(' ').length} words</span>
          )}
        </div>
        {hasContent && (
          <span className="thought-chevron">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
      </button>
      {isOpen && hasContent && (
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

/* ─── HTML Report View ─────────────────────────────────────────── */
function ReportView({ html }) {
  const iframeRef = useRef(null);

  return (
    <div className="report-wrapper">
      <div className="report-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} className="report-icon" />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Research Report</span>
        </div>
      </div>
      <iframe
        srcDoc={html}
        title="AI Report"
        className="report-iframe"
        sandbox="allow-popups allow-scripts"
      />
    </div>
  );
}

/* ─── Time Formatter ────────────────────────────────────────────── */
function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

/* ─── Strip ALL model channel formatting from a string ──────────── */
function stripChannelTags(text) {
  if (!text) return '';
  return text
    // Strip <|turn|> and variations
    .replace(/<\|?turn\|?>/gi, '')
    // Strip <|channel|> and all its broken variations (e.g. <channel|>, <|channel, &lt;|channel|&gt;) + the following word
    .replace(/(&lt;|<)\|?channel\|?(&gt;|>)\s*\w*/gi, '')
    .replace(/<channel\|>\s*\w*/gi, '')
    .trim();
}

/* ─── Parse agent / model output ─────────────────────────────────── */
function parseContent(raw) {
  if (!raw) return { display: '', thought: '' };

  // ── Path 1: new App.jsx structured format (__THOUGHT__ / __ANSWER__)
  if (raw.startsWith('__THOUGHT__')) {
    const answerIdx = raw.indexOf('__ANSWER__');
    let thought = '';
    let display = '';
    
    if (answerIdx !== -1) {
      thought = raw.slice('__THOUGHT__'.length, answerIdx).trim();
      display = raw.slice(answerIdx + '__ANSWER__'.length).trim();
    } else {
      thought = raw.slice('__THOUGHT__'.length).trim();
    }

    // New: If thought itself contains a JSON block, try to extract just the human text
    const innerJson = thought.match(/```json\n?([\s\S]*?)\n?```/) || thought.match(/(\{[\s\S]*\})/);
    if (innerJson) {
      const jsonStart = thought.indexOf(innerJson[0]);
      const afterJson = thought.slice(jsonStart + innerJson[0].length).trim();
      try {
        const obj = JSON.parse(innerJson[1].trim());
        if (obj.thought) thought = obj.thought;
        // If we found an answer inside this JSON or AFTER it, use it
        const finalDisplay = (obj.params?.answer || obj.answer || afterJson).trim();
        if (!display && finalDisplay) display = finalDisplay;
      } catch (_) {
        const partial = innerJson[1].match(/"thought"\s*:\s*"([\s\S]*?)(?:"|$)/);
        if (partial) thought = partial[1];
      }
    }
    
    return { thought, display };
  }

  // ── Path 2: Native <think>...</think>
  const thinkMatch = raw.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  if (thinkMatch) {
    const thought = thinkMatch[1].trim();
    const display = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
    return { thought, display };
  }

  // ── Path 3: PARL <|channel|>thought format (old backend streaming directly)
  const thoughtMatch = raw.match(/(&lt;|<)\|?channel\|?(&gt;|>)\s*thought/i) || raw.match(/<channel\|>\s*thought/i);
  if (thoughtMatch) {
    const thoughtStart = thoughtMatch.index;
    let afterTag = thoughtStart + thoughtMatch[0].length;
    while (afterTag < raw.length && raw[afterTag] === ' ') afterTag++;
    const rest = raw.slice(afterTag);
    const nextTagMatch = rest.match(/(&lt;|<)\|?channel\|?(&gt;|>)/i) || rest.match(/<channel\|>/i);
    if (nextTagMatch) {
      const thought = rest.slice(0, nextTagMatch.index).trim();
      const afterAnswer = rest.slice(nextTagMatch.index);
      const display = stripChannelTags(afterAnswer);
      return { thought, display };
    }
    return { thought: rest.trim(), display: '' };
  }

  // ── Path 4: Any other leftover <|channel|> (strip entirely, show nothing)
  if (raw.includes('<|channel|>')) {
    return { thought: '', display: '' };
  }

  // ── Path 5: Agent JSON format
  const jsonMatch = raw.match(/```json\n?([\s\S]*?)\n?```/) || raw.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    const jsonStart = raw.indexOf(jsonMatch[0]);
    const afterJson = raw.slice(jsonStart + jsonMatch[0].length).trim();
    try {
      const contentStr = jsonMatch[1].trim();
      const obj = JSON.parse(contentStr);
      const thought = obj.thought || '';
      // Support HTML report generated OUTSIDE the JSON block as per instructions
      const display = (obj.params?.answer || obj.answer || afterJson).trim();
      return { display, thought };
    } catch (_) {
      // Incomplete JSON (streaming): manually extract "thought" field if possible
      const contentStr = jsonMatch[1].trim();
      const partialThought = contentStr.match(/"thought"\s*:\s*"([\s\S]*?)(?:"|$)/);
      if (partialThought) {
        return { thought: partialThought[1], display: '' };
      }
      return { thought: '', display: '' };
    }
  }

  // ── Path 6: Plain text, just clean up tags
  return { thought: '', display: stripChannelTags(raw) };
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

  // Clean up Thought content (hide JSON tool calls and internal "backend" stuff)
  let processedThought = thoughtContent;
  if (processedThought) {
    processedThought = processedThought
      // 1. Strip all markdown code blocks entirely (including partial ones)
      .replace(/```[\s\S]*?(```|$)/gi, '')
      // 2. Strip raw JSON-like structures (any object containing typical agent keys)
      .replace(/\{[\s\S]*?("action"|"thought"|"params"|"answer")[\s\S]*?(\}|$)/gi, '')
      // 3. Strip any residual "json" text labels that might be left by typos
      .replace(/^\s*json\s*$/gim, '')
      .trim();
  }

  // Shimmer: only show when truly nothing yet (no thought, no answer)
  const showThinkingSpinner = isStreaming && !processedThought && !processedDisplay;

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
          {(processedThought || showThinkingSpinner) && (
            <ThoughtBlock content={processedThought} isStreaming={isStreaming && !displayContent} />
          )}

          {/* Main content */}
          {isUser ? (
            <span style={{ whiteSpace: 'pre-wrap' }}>{displayContent}</span>
          ) : !isUser && processedDisplay && (processedDisplay.includes('<html>') || processedDisplay.includes('<!DOCTYPE html>')) ? (
            <ReportView html={processedDisplay} />
          ) : processedDisplay ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {processedDisplay}
            </ReactMarkdown>
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
