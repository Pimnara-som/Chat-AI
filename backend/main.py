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

import torch
import threading
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AI_MODEL = os.environ.get("AI_MODEL", "Phonsiri/Gemma-4-E4B-it-PARL")

print(f"⏳ กำลังโหลดโมเดล {AI_MODEL} เข้า VRAM...")
tokenizer = AutoTokenizer.from_pretrained(AI_MODEL)
model = AutoModelForCausalLM.from_pretrained(
    AI_MODEL,
    torch_dtype=torch.bfloat16,
    device_map="auto"
)
print("✅ โหลดโมเดลสำเร็จ!")

# Simple in-memory storage (matching Node.js behavior)
conversations = {}

class ChatRequest(BaseModel):
    conversationId: Optional[str] = None
    message: Optional[str] = None
    image: Optional[str] = None

# Custom model function using local transformers
def model_fn(messages: List[Dict], stream_queue=None) -> str:
    try:
        device = next(model.parameters()).device
        inputs = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            return_dict=True,
            enable_thinking=True,
        ).to(device)
        
        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
        
        generation_kwargs = dict(
            **inputs,
            max_new_tokens=2048,
            temperature=0.7,
            do_sample=True,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id,
            streamer=streamer,
        )
        
        thread = threading.Thread(target=model.generate, kwargs=generation_kwargs)
        thread.start()
        
        full_text = ""
        for new_text in streamer:
            full_text += new_text
            # Stream live token if queue is attached
            if stream_queue:
                stream_queue.put_nowait({"type": "chunk", "text": new_text})
                
        thread.join()
        
        # Add a newline after each hop's generation to separate from Tool Results
        if stream_queue:
            stream_queue.put_nowait({"type": "chunk", "text": "\n\n"})
            
        return full_text
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
        if "MODEL OUTPUT" in tag:
            # Skip because we are streaming tokens live!
            return
            
        if "ACTION" in tag or "TOOL RESULT" in tag or "WARN" in tag or "ABORT" in tag:
            # Format nicely
            clean_msg = str(msg).strip()
            if len(clean_msg) > 300:
                clean_msg = clean_msg[:300] + "... [truncated]"
            formatted = f"\n> 🛠️ **{tag}**:\n> ```\n> {clean_msg}\n> ```\n\n"
            queue.put_nowait({"type": "chunk", "text": formatted})

    async def generate_sse():
        # Yield init
        yield f'data: {json.dumps({"type": "init", "conversationId": conv_id})}\n\n'
        
        # Run agent in background thread
        loop = asyncio.get_event_loop()
        
        # Initialize Agent
        def local_model_fn(messages):
            return model_fn(messages, stream_queue=queue)
        
        # Initialize Agent
        agent = AgentLoop(
            model_fn=local_model_fn, 
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
                yield f'data: {json.dumps(chunk)}\n\n'
            except asyncio.TimeoutError:
                continue
                
        # Flush remaining queue
        while not queue.empty():
            chunk = queue.get_nowait()
            yield f'data: {json.dumps(chunk)}\n\n'
            
        # Get final result
        result = task.result()
        final_answer = result.get("answer", "No answer provided.")
            
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
        yield f'data: {json.dumps({"type": "done"})}\n\n'

    return StreamingResponse(generate_sse(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=3001, reload=True)
