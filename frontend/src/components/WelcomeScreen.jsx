import { Bot, Zap, Code, Globe, BookOpen } from 'lucide-react';

const SUGGESTIONS = [
  { icon: <Zap size={14} />, title: 'อธิบาย Machine Learning', text: 'อธิบาย Machine Learning ให้ฉันเข้าใจแบบง่าย ๆ' },
  { icon: <Code size={14} />, title: 'เขียน Python function', text: 'เขียน Python function สำหรับเรียงลำดับ list' },
  { icon: <Globe size={14} />, title: 'แปลภาษา', text: 'แปลประโยคนี้เป็นภาษาอังกฤษ: "สวัสดีครับ ยินดีที่ได้รู้จัก"' },
  { icon: <BookOpen size={14} />, title: 'สรุปบทความ', text: 'ช่วยวิธีการสรุปบทความยาว ๆ ให้กระชับครับ' },
];

export default function WelcomeScreen({ onSuggestion }) {
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <Bot size={36} color="#fff" />
      </div>

      <div>
        <h1 className="welcome-title">AI Agent</h1>
        <p className="welcome-subtitle">
          ผู้ช่วย AI พร้อมตอบคำถาม เขียนโค้ด และช่วยงานทุกอย่าง<br />
          พิมพ์ข้อความเพื่อเริ่มการสนทนา
        </p>
      </div>

      <div className="welcome-suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s.title} className="suggestion-card" onClick={() => onSuggestion(s.text)}>
            <strong>
              <span style={{ marginRight: 6, verticalAlign: 'middle', display: 'inline-flex' }}>{s.icon}</span>
              {s.title}
            </strong>
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}
