import { useRef, useState, useEffect } from 'react';
import { Send, Square, ImagePlus, X } from 'lucide-react';

export default function InputBar({ onSend, isLoading }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null); // base64
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }, [text]);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && !image) || isLoading) return;
    onSend(trimmed, image);
    setText('');
    setImage(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target.result);
    };
    reader.readAsDataURL(file);
    e.target.value = null; // reset
  };

  return (
    <div className="input-area">
      <div className="input-inner">
        <div className="input-box" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {image && (
            <div className="image-preview-container">
              <div className="image-preview">
                <img src={image} alt="Preview" />
                <button 
                  className="image-preview-remove"
                  onClick={() => setImage(null)}
                  title="Remove image"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <button
              className="btn-icon"
              style={{ flexShrink: 0, padding: '10px 8px' }}
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title="Attach image"
            >
              <ImagePlus size={18} />
            </button>
            <input 
              type="file" 
              accept="image/*" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              onChange={handleFileChange}
            />
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
              disabled={(!text.trim() && !image) || isLoading}
              title="Send"
            >
              {isLoading ? <Square size={15} fill="currentColor" /> : <Send size={15} />}
            </button>
          </div>
        </div>
        <p className="input-hint">AI สามารถเกิดข้อผิดพลาดได้ ควรตรวจสอบข้อมูลสำคัญ</p>
      </div>
    </div>
  );
}

