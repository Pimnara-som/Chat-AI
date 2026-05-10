import { useRef, useState, useEffect } from 'react';
import { Send, Square } from 'lucide-react';

export default function InputBar({ onSend, isLoading }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="input-area">
      <div className="input-inner">
        <div className="input-box">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            rows={1}
            placeholder="พิมพ์ข้อความ... (Shift+Enter เพื่อขึ้นบรรทัดใหม่)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            className="btn-send"
            onClick={handleSend}
            disabled={!text.trim() || isLoading}
            title="Send"
          >
            {isLoading ? <Square size={15} fill="currentColor" /> : <Send size={15} />}
          </button>
        </div>
        <p className="input-hint">AI สามารถเกิดข้อผิดพลาดได้ ควรตรวจสอบข้อมูลสำคัญ</p>
      </div>
    </div>
  );
}
