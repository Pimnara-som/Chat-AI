import os
import sys
import json
import uuid
from typing import Optional, List, Dict
import asyncio
from datetime import datetime

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from openai import OpenAI
from dotenv import load_dotenv

# Load env
load_dotenv()

# Add agent folders to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "agent"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "agent/3_agent_loop"))

from agent_loop import AgentLoop

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", "http://localhost:8000/v1")
VLLM_API_KEY = os.environ.get("VLLM_API_KEY", "EMPTY")
AI_MODEL = os.environ.get("AI_MODEL", "Phonsiri/Gemma-4-E4B-it-PARL")

client = OpenAI(base_url=VLLM_BASE_URL, api_key=VLLM_API_KEY)

# Simple in-memory storage (matching Node.js behavior)
conversations = {}

class ChatRequest(BaseModel):
    conversationId: Optional[str] = None
    message: Optional[str] = None
    image: Optional[str] = None

# We need to adapt model_fn to be SYNCHRONOUS for AgentLoop
def model_fn(messages: List[Dict]) -> str:
    try:
        response = client.chat.completions.create(
            model=AI_MODEL,
            messages=messages,
            temperature=0.7,
            max_tokens=2048,
        )
        return response.choices[0].message.content
    except Exception as e:
        print("Model error:", e)
        # Fallback to finish action on error
        return f'{{"action": "finish", "params": {{"answer": "Error calling model: {str(e)}"}} }}'

@app.get("/api/health")
def health():
    return {"status": "ok", "backend": "python-fastapi", "model": AI_MODEL}

def get_user_id(req: Request) -> str:
    return req.headers.get("X-User-Id", "default-user")

@app.get("/api/conversations")
def get_conversations(request: Request):
    user_id = get_user_id(request)
    # Filter by user_id and sort by updatedAt desc
    user_convs = [c for c in conversations.values() if c.get("userId") == user_id]
    sorted_convs = sorted(user_convs, key=lambda x: x["updatedAt"], reverse=True)
    return sorted_convs

@app.post("/api/conversations")
def create_conversation(request: Request):
    user_id = get_user_id(request)
    conv_id = str(uuid.uuid4())
    now_str = datetime.utcnow().isoformat() + "Z"
    new_conv = {
        "id": conv_id,
        "userId": user_id,
        "title": "New Chat",
        "messages": [],
        "createdAt": now_str,
        "updatedAt": now_str
    }
    conversations[conv_id] = new_conv
    return new_conv

@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str, request: Request):
    user_id = get_user_id(request)
    if conv_id not in conversations or conversations[conv_id].get("userId") != user_id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversations[conv_id]

@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str, request: Request):
    user_id = get_user_id(request)
    if conv_id in conversations and conversations[conv_id].get("userId") == user_id:
        del conversations[conv_id]
        return {"success": True}
    raise HTTPException(status_code=404, detail="Not found")

@app.post("/api/chat/stream")
async def chat_stream(req: Request):
    user_id = get_user_id(req)
    body = await req.json()
    message = body.get("message")
    image = body.get("image")
    conv_id = body.get("conversationId")

    if (not message or not message.strip()) and not image:
        raise HTTPException(status_code=400, detail="Message or image is required")
        
    if not conv_id or conv_id not in conversations or conversations[conv_id].get("userId") != user_id:
        conv_id = str(uuid.uuid4())
        now_str = datetime.utcnow().isoformat() + "Z"
        title = message.strip()[:60] if message else "Image Upload"
        conversations[conv_id] = {
            "id": conv_id,
            "userId": user_id,
            "title": title,
            "messages": [],
            "createdAt": now_str,
            "updatedAt": now_str
        }
    
    # Save user message
    user_msg = {
        "id": str(uuid.uuid4()),
        "role": "user",
        "content": message.strip() if message else "",
        "image": image,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
    conversations[conv_id]["messages"].append(user_msg)
    conversations[conv_id]["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    # Queue for streaming SSE
    queue = asyncio.Queue()

    def stream_callback(tag, msg):
        # We don't stream raw USER/MODEL OUTPUT to keep it clean, but we stream actions and thoughts
        if tag in ["USER", "DONE"]:
            return
            
        if "MODEL OUTPUT" in tag:
            # Parse thought if possible
            try:
                # Find JSON
                import re
                blocks = re.findall(r"```(?:json)?\n?(.*?)\n?```", str(msg), re.DOTALL)
                text_to_parse = blocks[-1] if blocks else str(msg)
                start = text_to_parse.find("{")
                end = text_to_parse.rfind("}")
                if start != -1 and end != -1:
                    obj = json.loads(text_to_parse[start:end+1])
                    if "thought" in obj:
                        queue.put_nowait({"type": "chunk", "text": f"\\n> 🧠 **Thought**: *{obj['thought']}*\\n\\n"})
            except Exception:
                pass
            return
            
        if "ACTION" in tag or "TOOL RESULT" in tag or "WARN" in tag or "ABORT" in tag:
            # Format nicely
            clean_msg = str(msg).strip()
            if len(clean_msg) > 300:
                clean_msg = clean_msg[:300] + "... [truncated]"
            formatted = f"\\n> 🛠️ **{tag}**:\\n> ```\\n> {clean_msg}\\n> ```\\n\\n"
            queue.put_nowait({"type": "chunk", "text": formatted})

    async def generate_sse():
        # Yield init
        yield f'data: {json.dumps({"type": "init", "conversationId": conv_id})}\\n\\n'
        
        # Run agent in background thread
        loop = asyncio.get_event_loop()
        
        # Initialize Agent
        agent = AgentLoop(
            model_fn=model_fn, 
            mode="search", 
            verbose=False,
            stream_callback=stream_callback
        )
        
        # We need to pass the query.
        query = message or "[User sent an image]"

        # Start the blocking agent run in a thread
        task = loop.run_in_executor(None, agent.run, query)
        
        # Yield chunks from queue while task is running
        while not task.done():
            try:
                chunk = await asyncio.wait_for(queue.get(), timeout=0.1)
                yield f'data: {json.dumps(chunk)}\\n\\n'
            except asyncio.TimeoutError:
                continue
                
        # Flush remaining queue
        while not queue.empty():
            chunk = queue.get_nowait()
            yield f'data: {json.dumps(chunk)}\\n\\n'
            
        # Get final result
        result = task.result()
        final_answer = result.get("answer", "No answer provided.")
        
        # Add a clear separator before final answer
        yield f'data: {json.dumps({"type": "chunk", "text": "\\n---\\n\\n"})}\\n\\n'
        
        # Stream the final answer
        chunk_size = 20
        for i in range(0, len(final_answer), chunk_size):
            text_chunk = final_answer[i:i+chunk_size]
            yield f'data: {json.dumps({"type": "chunk", "text": text_chunk})}\\n\\n'
            await asyncio.sleep(0.01)
            
        # Save AI message
        ai_msg = {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "content": final_answer,
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        conversations[conv_id]["messages"].append(ai_msg)
        conversations[conv_id]["updatedAt"] = datetime.utcnow().isoformat() + "Z"
        
        # Done
        yield f'data: {json.dumps({"type": "done"})}\\n\\n'

    return StreamingResponse(generate_sse(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
