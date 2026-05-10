# Chat-AI

AI Chat Agent powered by [Phonsiri/Gemma-4-E4B-it-PARL](https://huggingface.co/Phonsiri/Gemma-4-E4B-it-PARL) via HuggingFace Inference API.

Built with **Node.js + Express** (backend) and **React + Vite** (frontend).

---

## Features

- Real-time streaming responses (Server-Sent Events)
- Multi-turn conversation with persistent history (in-memory)
- Markdown rendering with syntax highlighting and copy button
- Dark mode glassmorphism UI
- Supports Thai and English

---

## Project Structure

```
Chat-AI/
├── backend/          Node.js + Express API server
│   ├── src/
│   │   ├── index.js
│   │   ├── routes/
│   │   ├── services/
│   │   └── store/
│   └── .env.example
└── frontend/         React + Vite client
    ├── src/
    │   ├── App.jsx
    │   ├── components/
    │   └── api/
    └── index.html
```

---

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env and set your HF_API_KEY
npm install
npm run dev
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

---

## Environment Variables (backend/.env)

| Variable | Description |
|----------|-------------|
| `HF_API_KEY` | HuggingFace API token (from https://huggingface.co/settings/tokens) |
| `AI_MODEL` | Model ID (default: `Phonsiri/Gemma-4-E4B-it-PARL`) |
| `PORT` | Backend port (default: `3001`) |
| `FRONTEND_URL` | Frontend URL for CORS (default: `http://localhost:5173`) |
| `MAX_TOKENS` | Max tokens per response (default: `2048`) |
| `SYSTEM_PROMPT` | Custom system prompt |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat/stream` | Stream a chat response (SSE) |
| `GET` | `/api/conversations` | List all conversations |
| `POST` | `/api/conversations` | Create a conversation |
| `GET` | `/api/conversations/:id` | Get conversation with messages |
| `DELETE` | `/api/conversations/:id` | Delete a conversation |
| `GET` | `/api/health` | Health check |
