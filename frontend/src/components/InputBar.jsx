import { useRef, useState, useEffect, useCallback } from 'react';
import { Send, Square, ImagePlus, X, FileText } from 'lucide-react';

/** Compress image to JPEG at max 1024px & quality 0.75 before sending */
function compressImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1024;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
        else { width = Math.round((width * MAX) / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = dataUrl;
  });
}

export default function InputBar({ onSend, isLoading }) {
  const [text, setText] = useState('');
  const [image, setImage] = useState(null); // compressed base64
  const [imageLoading, setImageLoading] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }, [text]);

  const handleSend = useCallback((mode = 'search') => {
    const trimmed = text.trim();
    if ((!trimmed && !image) || isLoading || imageLoading) return;
    onSend(trimmed, image, mode);
    setText('');
    setImage(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [text, image, isLoading, imageLoading, onSend]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend('search');
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = null;
    setImageLoading(true);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((res, rej) => {
        reader.onload = (ev) => res(ev.target.result);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const compressed = await compressImage(dataUrl);
      setImage(compressed);
    } catch (err) {
      console.error('Image load error:', err);
    } finally {
      setImageLoading(false);
    }
  };

  const canSend = (text.trim() || image) && !isLoading && !imageLoading;

  return (
    <div className="input-area">
      <div className="input-inner">
        <div className="input-box" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {/* Image preview */}
          {(image || imageLoading) && (
            <div className="image-preview-container">
              <div className="image-preview">
                {image
                  ? <img src={image} alt="Preview" />
                  : <div className="image-preview-loading">⏳</div>
                }
                {!imageLoading && (
                  <button
                    className="image-preview-remove"
                    onClick={() => setImage(null)}
                    title="Remove image"
                    type="button"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            {/* Image attach button */}
            <button
              className="btn-icon"
              style={{ flexShrink: 0, padding: '10px 8px' }}
              onClick={() => !imageLoading && fileInputRef.current?.click()}
              title="Attach image"
              type="button"
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

            {/* Report button */}
            <button
              className="btn-report"
              onClick={() => handleSend('research_report')}
              disabled={!canSend}
              title="สร้างรายงาน HTML"
              type="button"
            >
              <FileText size={15} />
            </button>

            {/* Send button */}
            <button
              className="btn-send"
              onClick={() => handleSend('search')}
              disabled={!canSend}
              title={isLoading ? 'Generating...' : 'Send'}
              type="button"
            >
              {isLoading
                ? <Square size={15} fill="currentColor" />
                : <Send size={15} />
              }
            </button>
          </div>
        </div>
        <p className="input-hint">AI สามารถเกิดข้อผิดพลาดได้ ควรตรวจสอบข้อมูลสำคัญ</p>
      </div>
    </div>
  );
}
