import { useState, useCallback } from 'react';
import { Bot, Plus, Trash2, MessageSquare, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function Sidebar({ conversations, currentId, onNew, onSelect, onDelete, collapsed, onToggle }) {
  const [hoverId, setHoverId] = useState(null);

  const handleDelete = useCallback((e, id) => {
    e.stopPropagation();
    onDelete(id);
  }, [onDelete]);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="logo-icon">
            <Bot size={18} color="#fff" />
          </div>
          AI Agent
        </div>
        <button className="btn-icon" onClick={onToggle} title="Collapse sidebar">
          <PanelLeftClose size={17} />
        </button>
      </div>

      <button className="btn-new-chat" onClick={onNew}>
        <Plus size={15} />
        New chat
      </button>

      <div className="conv-list">
        {conversations.length === 0 && (
          <div style={{ padding: '20px 8px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No conversations yet
          </div>
        )}

        {conversations.length > 0 && (
          <>
            <div className="conv-section-label">Recent</div>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`conv-item${conv.id === currentId ? ' active' : ''}`}
                onClick={() => onSelect(conv.id)}
                onMouseEnter={() => setHoverId(conv.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                <MessageSquare size={14} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <div className="conv-item-text">
                  <div className="conv-item-title">{conv.title}</div>
                  <div className="conv-item-meta">{timeAgo(conv.updatedAt)}</div>
                </div>
                <button
                  className="conv-item-delete"
                  onClick={(e) => handleDelete(e, conv.id)}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </aside>
  );
}
