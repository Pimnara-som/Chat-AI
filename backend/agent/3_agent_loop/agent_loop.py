# =============================================================================
# 3_agent_loop/agent_loop.py
# Multi-hop ReAct Agent Loop  (Kimi K2.5 style)
# think → act → observe → repeat (up to MAX_HOPS)
# =============================================================================

import json, re, sys, time
from pathlib import Path

# ── Fix import paths (folder names start with digits → can't use dot-import) ──
_ROOT = Path(__file__).resolve().parents[1]   # gemma-agent/
_HERE = Path(__file__).resolve().parent        # gemma-agent/3_agent_loop/
for _p in [str(_ROOT), str(_HERE)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from tools.tool_definitions import execute_tool, TOOL_NAMES   # tools/ via _ROOT
from system_prompts import get_system_prompt             # 3_agent_loop/ via _HERE
from configs.config import MAX_HOPS, TOOL_TIMEOUT_SEC            # configs/ via _ROOT/configs

# ─── Token management helpers ──────────────────────────────────────────────────

def _count_tokens(text: str) -> int:
    """Rough estimate: 1 token ≈ 4 chars (ใช้ได้กับ TH+EN ผสม)"""
    return len(text) // 4


def _compress_tool_result(result: str, budget: int = 20000) -> str:
    """
    ย่อ tool result ให้สั้นลง:
    1. เก็บ N บรรทัดแรก (most relevant)
    2. ถ้ายังยาว ตัดที่ budget chars
    """
    lines = [l for l in result.split("\n") if l.strip()]
    compressed = "\n".join(lines[:500])   # เก็บ 500 บรรทัดแรก
    return compressed[:budget]


def _emergency_trim(msgs: list[dict], max_tokens: int) -> list[dict]:
    """ถ้า context ใหญ่เกิน เก็บแค่ system + latest chat history + 2 tool turns ล่าสุด"""
    from itertools import zip_longest
    system_msg  = msgs[0]

    # แยกข้อความปกติ (user/assistant ที่ไม่ใช่ tool) และข้อความที่เกี่ยวกับ tool
    normal_msgs = [m for m in msgs[1:] if m["role"] == "assistant" or (m["role"] == "user" and "[Tool:" not in m.get("content", ""))]
    tool_msgs   = [m for m in msgs[1:] if m["role"] == "user" and "[Tool:" in m.get("content", "")]
    
    # เก็บแชทปกติแค่ 4 turn ล่าสุด
    recent_normal = normal_msgs[-4:] if len(normal_msgs) >= 4 else normal_msgs

    trimmed = [system_msg] + recent_normal
    
    if len(tool_msgs) > 2:
        trimmed.append({
            "role": "user",
            "content": f"[Context: ค้นหาไปแล้ว {len(tool_msgs)} ครั้ง บันทึก 2 ครั้งล่าสุด]"
        })

    # ใส่ 2 tool turn ล่าสุด
    last_tools = tool_msgs[-2:] if len(tool_msgs) >= 2 else tool_msgs
    trimmed.extend(last_tools)
            
    return trimmed


# ─── JSON parser — robust to markdown fences ─────────────────────────────────

def _parse_action(text: str) -> dict | None:
    """Extract JSON action from model output (handles markdown, extra text, etc.)."""
    text = text.strip()
    
    # 1. Search for markdown blocks first (e.g., ```json ... ```)
    # We take the LAST one as it's usually the final decision
    blocks = re.findall(r"```(?:json)?\n?(.*?)\n?```", text, re.DOTALL)
    if blocks:
        for block in reversed(blocks):
            try:
                candidate = json.loads(block.strip())
                if isinstance(candidate, dict) and "action" in candidate:
                    return candidate
            except json.JSONDecodeError:
                continue

    # 2. Fallback: find all outermost {...} patterns
    # The regex r"(\{.*?\})" is non-greedy for inner blocks, but we want 
    # potentially nested ones. A better approach is finding all { then searching for balanced }
    # but for simplicity, we look for the biggest block that is valid JSON.
    matches = re.finditer(r"\{.*\}", text, re.DOTALL)
    candidates = []
    for m in matches:
        cand_str = m.group()
        # If there are multiple nested ones, we need caution. 
        # But usually models output { ... } as a single block.
        try:
            obj = json.loads(cand_str)
            if isinstance(obj, dict) and "action" in obj:
                candidates.append(obj)
        except json.JSONDecodeError:
            # Maybe there's extra text inside the {} that we need to skip?
            # Or multiple {} blocks on separate lines?
            # Try to split by newline and parse each
            for line in cand_str.split("\n"):
                if "{" in line and "}" in line:
                    match_inner = re.search(r"\{.*\}", line)
                    if match_inner:
                        try:
                            obj_inner = json.loads(match_inner.group())
                            if isinstance(obj_inner, dict) and "action" in obj_inner:
                                candidates.append(obj_inner)
                        except json.JSONDecodeError:
                            continue
            continue
            
    if candidates:
        return candidates[-1] # Take the last one found
        
    # 3. Fallback for PARL fine-tuned models that output <|channel|> instead of JSON
    if "<|channel|>" in text:
        # Check if it contains <|channel|>thought
        # Extract the non-thought channel
        matches = re.findall(r"<\|channel\|>(?!thought\b)(.*?)(?:<\|channel\|>|<\|turn\|>|$)", text, re.DOTALL)
        if matches:
            # We treat the last channel output as the final answer
            answer = matches[-1].strip()
            return {"action": "finish", "params": {"answer": answer}}
        
        # If no other channel, maybe just return everything as answer
        return {"action": "finish", "params": {"answer": text}}

    return None


# ─── Model inference wrapper (swap with local HuggingFace model on Lightning) ─

def _call_model(messages: list[dict], model_fn) -> str:
    """
    Call the model with chat messages and return the assistant's text.

    `model_fn` signature:  model_fn(messages: list[dict]) -> str
    On Lightning AI, pass a wrapper around your loaded gemma-4-E4B-it pipeline.
    For quick local testing, pass a simple lambda that calls the Kimi/OpenAI API.
    """
    return model_fn(messages)


# ─── Single-agent agentic loop ────────────────────────────────────────────────

class AgentLoop:
    """
    Multi-hop agent that loops: think → call tool → observe → repeat.

    Parameters
    ----------
    model_fn  : callable(messages) -> str   — wraps your local or API model
    mode      : "search" | "orchestrator" | "coding"
    max_hops  : override for MAX_HOPS config
    verbose   : print each hop to stdout
    agent_id  : identifier for parallel logging
    """

    def __init__(self, model_fn, mode: str = "search",
                 max_hops: int = MAX_HOPS, verbose: bool = True,
                 max_context_tokens: int = 60000, agent_id: int = 0,
                 stream_callback=None):
        self.model_fn           = model_fn
        self.mode               = mode
        self.max_hops           = max_hops
        self.verbose            = verbose
        self.max_context_tokens = max_context_tokens
        self.agent_id           = agent_id
        self.stream_callback    = stream_callback

    # ── internal helpers ──────────────────────────────────────────────────────

    def _log(self, tag: str, msg: str):
        if self.verbose:
            prefix = f"| Agent {self.agent_id} |"
            msg_short = str(msg)[:100].replace("\n", " ") + "..." if len(str(msg)) > 100 else str(msg)
            print(f"{prefix} [{tag}] {msg_short}")
        if getattr(self, "stream_callback", None):
            self.stream_callback(tag, msg)

    def _append_observation(self, history: list, tool_name: str,
                             params: dict, result: str):
        """Add tool result as a 'tool' turn in conversation history."""
        content_clipped = result[:4000]
        history.append({
            "role": "tool",
            "name": tool_name,
            "params": params,
            "content": content_clipped,
            "tokens": _count_tokens(content_clipped),
        })

    def _build_messages(self, history: list, current_hop: int = 1) -> list[dict]:
        """สร้าง messages โดยควบคุม token budget ด้วย sliding window ป้องกัน OOM"""
        system  = get_system_prompt(self.mode)
        
        # Inject dynamic hop warning into the system prompt
        system += f"\n\n[SYSTEM WARNING: You are currently on HOP {current_hop} out of {self.max_hops}. "
        if current_hop >= self.max_hops - 2:
            system += "URGENT: You are running out of hops! You MUST use action='finish' to provide your final answer immediately!]"
        else:
            system += "Plan your actions accordingly.]"

        user_q  = history[0]["content"]
        
        assistant_turns = []
        tool_turns      = []
        for h in history[1:]:
            if h["role"] == "assistant":
                assistant_turns.append(h)
            elif h["role"] == "tool":
                tool_turns.append(h)
                
        FULL_WINDOW   = 5     # จำนวน hop ล่าสุดที่เก็บเต็ม
        SUMMARY_CHARS = 5000
        
        compressed_tools = {}
        for i, t in enumerate(tool_turns):
            key = id(t)
            if i < len(tool_turns) - FULL_WINDOW:
                compressed_tools[key] = t["content"][:SUMMARY_CHARS] + "...[truncated]"
            else:
                compressed_tools[key] = _compress_tool_result(t["content"], budget=20000)
                
        msgs = [
            {"role": "system",  "content": system},
            {"role": "user",    "content": user_q},
        ]
        
        for h in history[1:]:
            if h["role"] == "assistant":
                msgs.append({"role": "assistant", "content": h["content"]})
            elif h["role"] == "tool":
                content = compressed_tools.get(id(h), h["content"][:200])
                tool_msg = (
                    f"[Tool: {h['name']}]\n"
                    f"Params: {json.dumps(h.get('params', {}), ensure_ascii=False)}\n"
                    f"Result:\n{content}"
                )
                msgs.append({"role": "user", "content": tool_msg})
            elif h["role"] == "user" and h is not history[0]:
                msgs.append({"role": "user", "content": h["content"]})
                
        total = sum(_count_tokens(m["content"]) for m in msgs)
        if total > self.max_context_tokens:
            msgs = _emergency_trim(msgs, self.max_context_tokens)
            
        return msgs

    # ── main run method ────────────────────────────────────────────────────────

    def run(self, user_query: str, chat_history: list = None, tool_overrides: dict = None) -> dict:
        """
        Execute multi-hop agent loop for a single user query.

        Returns
        -------
        dict with keys:
          answer       : str   — final answer (or error message)
          hops         : int   — number of tool calls made
          history      : list  — full turn-by-turn trace
          success      : bool
        """
        # Start history with previous chat messages, then append current query
        history = []
        if chat_history:
            history.extend(chat_history)
        
        history.append({"role": "user", "content": user_query})
        self._log("USER", user_query)

        parse_failures = 0   # [Fix #3] Track consecutive JSON parse failures
        MAX_PARSE_FAILURES = 3

        for hop in range(1, self.max_hops + 1):
            # ── Call model ────────────────────────────────────────────────
            messages = self._build_messages(history, current_hop=hop)
            
            if self.verbose:
                total_tok = sum(_count_tokens(m["content"]) for m in messages)
                self._log(f"HOP {hop} | TOKENS", f"context={total_tok} | msgs={len(messages)}")
                
            raw_output = _call_model(messages, self.model_fn)
            history.append({"role": "assistant", "content": raw_output})
            self._log(f"HOP {hop} | MODEL OUTPUT", raw_output)

            # ── Parse action ──────────────────────────────────────────────────────────
            action = _parse_action(raw_output)
            if action is None:
                parse_failures += 1   # [Fix #3]
                self._log("WARN", f"Could not parse JSON (failure {parse_failures}/{MAX_PARSE_FAILURES})")
                if parse_failures >= MAX_PARSE_FAILURES:
                    self._log("ABORT", "Too many consecutive JSON parse failures")
                    break
                history.append({
                    "role": "user",
                    "content": "❌ ตอบกลับไม่เป็น JSON ที่ถูกต้อง กรุณาตอบใหม่ในรูปแบบ JSON ตามที่กำหนด"
                })
                continue
            parse_failures = 0   # reset on success

            tool_name = action.get("action", "")
            params    = action.get("params", {})
            thought   = action.get("thought", "")
            self._log(f"HOP {hop} | ACTION", f"tool={tool_name}\nparams={params}\nthought={thought}")

            # ── Finish sentinel ────────────────────────────────────────────
            if tool_name == "finish":
                final_answer = params.get("answer", raw_output)
                self._log("DONE", final_answer)
                return {
                    "answer":  final_answer,
                    "hops":    hop,
                    "history": history,
                    "success": True,
                }

            # ── Validate tool ──────────────────────────────────────────────
            if tool_name not in TOOL_NAMES:
                obs = f"[Error] เครื่องมือ '{tool_name}' ไม่มีในระบบ เครื่องมือที่ใช้ได้: {sorted(TOOL_NAMES)}"
                self._append_observation(history, tool_name, params, obs)
                continue

            # ── Execute tool ───────────────────────────────────────────────
            t0 = time.time()
            try:
                if tool_overrides and tool_name in tool_overrides:
                    result = tool_overrides[tool_name](params)
                else:
                    result = execute_tool(tool_name, params)
            except Exception as exc:
                result = f"[Tool error] {exc}"
            elapsed = time.time() - t0
            self._log(f"HOP {hop} | TOOL RESULT ({elapsed:.1f}s)", str(result)[:800])
            self._append_observation(history, tool_name, params, result)

        # ── Max hops exceeded ─────────────────────────────────────────────────
        self._log("ABORT", f"Reached max_hops={self.max_hops} without finishing.")
        return {
            "answer":  "⚠️ Agent ไม่สามารถหาคำตอบได้ภายในจำนวน hop ที่กำหนด",
            "hops":    self.max_hops,
            "history": history,
            "success": False,
        }


# ─── PARL Orchestrator wrapper (main-agent + sub-agents) ─────────────────────

class PARLOrchestrator:
    """
    Hierarchical agent that acts as an Orchestrator (Kimi K2.5 Agent Swarm style).
    - Orchestrator is TRAINABLE (main LoRA adapter active)
    - Sub-agents are FROZEN (base model only, no gradient)

    In this demo, sub-agents are separate AgentLoop instances
    with a lightweight model_fn (e.g., lighter checkpoint or frozen weights).

    Parameters
    ----------
    main_model_fn   : model for the orchestrator (LoRA-active)
    sub_model_fn    : model for sub-agents (frozen / base only)
    max_main_hops   : orchestrator step limit
    max_sub_hops    : sub-agent step limit per task
    """

    def __init__(self, main_model_fn, sub_model_fn,
                 max_main_hops: int = 15, max_sub_hops: int = 100,
                 mode: str = "orchestrator", stream_callback=None, verbose: bool = False):
        self.main_loop = AgentLoop(
            main_model_fn, mode=mode,
            max_hops=max_main_hops, verbose=verbose, stream_callback=stream_callback
        )
        self.sub_model_fn  = sub_model_fn
        self.max_sub_hops  = max_sub_hops
        self._pending_subs: dict[str, str] = {}   # task_id → task_description

    def run(self, user_query: str, chat_history: list = None) -> dict:
        """Run orchestrator loop — sub-agents are spawned lazily when needed."""
        sub_loops: dict[str, AgentLoop] = {}
        sub_results: dict[str, dict]    = {}

        def _create(params: dict) -> str:
            import uuid
            tid = f"sub_{uuid.uuid4().hex[:8]}"
            sub_loops[tid] = AgentLoop(
                self.sub_model_fn, mode="search",
                max_hops=self.max_sub_hops, verbose=False
            )
            self._pending_subs[tid] = params.get("task", "")
            return json.dumps({"task_id": tid, "status": "pending"})

        def _get(params: dict) -> str:
            task_id = params.get("task_id", "")
            if task_id not in sub_loops:
                return json.dumps({"error": "task_id not found"})
            if task_id not in sub_results:
                task = self._pending_subs.get(task_id, "Unknown task")
                # Sub-agents do not get the main chat history, they only get the sub-task
                sub_results[task_id] = sub_loops[task_id].run(task)
            r = sub_results[task_id]
            return json.dumps({
                "task_id": task_id,
                "status":  "done",
                "result":  r["answer"],
                "hops":    r["hops"],
            })

        overrides = {
            "create_subagent": _create,
            "get_subagent_result": _get,
        }

        result = self.main_loop.run(user_query, chat_history, tool_overrides=overrides)

        # Attach sub-agent traces to result
        result["sub_results"] = sub_results
        result["n_subagents"] = len(sub_loops)
        return result


# ─── Quick demo (run directly for smoke-test) ─────────────────────────────────

if __name__ == "__main__":
    # Demo: use a mock model that always searches then finishes
    call_count = [0]
    def mock_model(messages):
        call_count[0] += 1
        if call_count[0] == 1:
            return json.dumps({
                "thought": "ต้องค้นหาข้อมูลก่อน",
                "action": "web_search",
                "params": {"query": "Kimi K2.5 PARL Agent Swarm"}
            })
        return json.dumps({
            "thought": "ได้ข้อมูลแล้ว พร้อมตอบ",
            "action": "finish",
            "params": {"answer": "Kimi K2.5 ใช้ PARL (Parallel-Agent RL) เพื่อเทรน Agent Swarm ครับ"}
        })

    agent = AgentLoop(mock_model, mode="search", verbose=True)
    result = agent.run("Kimi K2.5 ใช้เทคนิคอะไรในการเทรน Agent Swarm?")
    print("\n===== FINAL RESULT =====")
    print(f"Answer : {result['answer']}")
    print(f"Hops   : {result['hops']}")
    print(f"Success: {result['success']}")
