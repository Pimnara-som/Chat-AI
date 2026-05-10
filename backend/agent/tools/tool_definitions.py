# =============================================================================
# tools/tool_definitions.py
# Central tool registry — all agent tools defined and dispatched here
# =============================================================================

import json, re
from typing import Optional
import requests
from bs4 import BeautifulSoup
from ddgs import DDGS

# ─── Tool schema registry (shown to model in system prompt) ───────────────────

TOOL_SCHEMAS = [
    # ── Search: single & parallel ──────────────────────────────────────────────
    {
        "name": "web_search",
        "description": "Search the web for a single query. Use for simple, focused lookups.",
        "parameters": {
            "query": {"type": "string", "description": "Search query string"}
        },
        "required": ["query"]
    },
    {
        "name": "multi_search",
        "description": (
            "Search 2-4 queries IN PARALLEL (same hop). "
            "Use when comparing things, needing multi-angle evidence, "
            "or doing 2-hop where each hop targets a different entity. "
            "FASTER than calling web_search multiple times."
        ),
        "parameters": {
            "queries": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of 2-4 search queries to run in parallel"
            }
        },
        "required": ["queries"]
    },
    # ── URL reading: static & dynamic ──────────────────────────────────────────
    {
        "name": "read_url",
        "description": "Fetch text from a URL using requests (fast, static pages only).",
        "parameters": {
            "url": {"type": "string", "description": "Full URL to read"}
        },
        "required": ["url"]
    },
    {
        "name": "browse_url",
        "description": (
            "Open URL with a full Playwright browser (supports JavaScript). "
            "Use when read_url fails or the page needs JS to load content."
        ),
        "parameters": {
            "url": {"type": "string", "description": "Full URL to open"}
        },
        "required": ["url"]
    },
    {
        "name": "click_and_read",
        "description": "Open a URL then click a CSS selector element, return the resulting page text.",
        "parameters": {
            "url":      {"type": "string", "description": "Page URL"},
            "selector": {"type": "string",
                         "description": "CSS selector, e.g. \"button:has-text('Load more')\""}
        },
        "required": ["url", "selector"]
    },
    {
        "name": "search_and_click_first",
        "description": (
            "Search then open the first result with a full Playwright browser. "
            "Use for deep research on a single topic where JS rendering is needed."
        ),
        "parameters": {
            "query": {"type": "string", "description": "Search query"}
        },
        "required": ["query"]
    },
    # ── Code execution ──────────────────────────────────────────────────────────
    {
        "name": "run_python",
        "description": "Execute Python code in a sandboxed subprocess and return stdout/stderr.",
        "parameters": {
            "code": {"type": "string", "description": "Python code to execute"}
        },
        "required": ["code"]
    },
    {
        "name": "run_shell",
        "description": "Run a bash command safely (destructive commands are blocked).",
        "parameters": {
            "command": {"type": "string", "description": "Shell command to run"}
        },
        "required": ["command"]
    },
    # ── Agent orchestration ─────────────────────────────────────────────────────
    {
        "name": "create_subagent",
        "description": "Spawn a sub-agent to handle a parallel sub-task. Returns a task_id.",
        "parameters": {
            "task": {"type": "string", "description": "Sub-task description for the sub-agent"}
        },
        "required": ["task"]
    },
    {
        "name": "get_subagent_result",
        "description": "Retrieve the result of a sub-agent by task_id.",
        "parameters": {
            "task_id": {"type": "string", "description": "ID returned by create_subagent"}
        },
        "required": ["task_id"]
    },
    # ── Terminal ────────────────────────────────────────────────────────────────
    {
        "name": "finish",
        "description": "Return the final answer to the user and stop the agent loop.",
        "parameters": {
            "answer": {"type": "string", "description": "Final answer text"}
        },
        "required": ["answer"]
    }
]

TOOL_NAMES = {t["name"] for t in TOOL_SCHEMAS}


# ─── Tool implementations ─────────────────────────────────────────────────────

def web_search(query: str, max_results: int = 5) -> str:
    """DuckDuckGo search — returns snippets."""
    try:
        with DDGS(timeout=10) as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        if not results:
            return "ไม่พบผลลัพธ์"
        lines = []
        for i, r in enumerate(results, 1):
            lines.append(
                f"[{i}] {r['title']}\n    {r['href']}\n    {r['body'][:500]}"
            )
        return "\n\n".join(lines)
    except Exception as e:
        return f"[web_search error] {e}"


def read_url(url: str, max_chars: int = 20000) -> str:
    """Fetch URL and return cleaned text (static pages)."""
    try:
        headers = {"User-Agent": "Mozilla/5.0 (compatible; GemmaAgent/1.0)"}
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        text = soup.get_text(separator="\n", strip=True)
        return text[:max_chars]
    except Exception as e:
        return f"[read_url error] {e}"


def _multi_search_tool(queries: list[str]) -> str:
    """Parallel search — delegates to multi_search.py."""
    from multi_search import parallel_search, merge_search_results
    if len(queries) > 4:
        queries = queries[:4]
    results = parallel_search(queries)
    return merge_search_results(results, max_chars=20000)


def _search_and_read_tool(query: str, top_n: int = 2) -> str:
    """Search → extract URLs → parallel read (static)."""
    from multi_search import parallel_read
    snippet = web_search(query, max_results=5)
    urls = re.findall(r'https?://[^\s\n<>"]+', snippet)[:top_n]
    if not urls:
        return snippet
    pages = parallel_read(urls)
    combined = f"[Search Snippets]\n{snippet[:1000]}\n\n[Full Pages]\n"
    for url, content in pages.items():
        combined += f"\n--- {url} ---\n{content[:8000]}\n"
    return combined


# ─── Sub-agent store ────────────────────────────────────────────────────

import threading
_subagent_store: dict = {}
_subagent_counter = 0
_counter_lock = threading.Lock()   # [Fix #8] Thread-safe counter


def create_subagent(task: str) -> str:
    global _subagent_counter
    with _counter_lock:   # [Fix #8] Prevent race condition across parallel rollout threads
        _subagent_counter += 1
        task_id = f"subtask_{_subagent_counter}"
    _subagent_store[task_id] = {"status": "pending", "task": task, "result": None}
    return json.dumps({"task_id": task_id, "status": "pending"})


def get_subagent_result(task_id: str) -> str:
    if task_id not in _subagent_store:
        return json.dumps({"error": "task_id not found"})
    entry = _subagent_store[task_id]
    if entry["status"] == "pending":
        # Lazy execution via lightweight search
        result = web_search(entry["task"], max_results=3)
        entry["result"] = result
        entry["status"] = "done"
    return json.dumps({
        "task_id": task_id,
        "status":  entry["status"],
        "result":  entry["result"],
    })


def finish(answer: str) -> str:
    return answer


# ─── Dynamic dispatch ─────────────────────────────────────────────────────────

def execute_tool(tool_name: str, params: dict) -> str:
    """Route a parsed tool call to the correct implementation."""
    # Import dynamic tools lazily (Playwright optional)
    def _browse(p):
        from web_dynamic import browse_url as _b
        return _b(p["url"])

    def _click(p):
        from web_dynamic import click_and_read as _c
        return _c(p["url"], p["selector"])

    def _sac(p):
        from web_dynamic import search_and_click_first as _s
        return _s(p["query"])

    def _run_py(p):
        from terminal import run_python as _rp
        return _rp(p["code"])

    def _run_sh(p):
        from terminal import run_shell as _rs
        return _rs(p["command"])

    dispatch = {
        "web_search":             lambda p: web_search(p["query"]),
        "multi_search":           lambda p: _multi_search_tool(p["queries"]),
        "read_url":               lambda p: read_url(p["url"]),
        "browse_url":             _browse,
        "click_and_read":         _click,
        "search_and_click_first": _sac,
        "run_python":             _run_py,
        "run_shell":              _run_sh,
        "create_subagent":        lambda p: create_subagent(p["task"]),
        "get_subagent_result":    lambda p: get_subagent_result(p["task_id"]),
        "finish":                 lambda p: finish(p["answer"]),
    }

    if tool_name not in dispatch:
        return f"[error] Unknown tool: '{tool_name}'. Available: {sorted(TOOL_NAMES)}"
    try:
        return dispatch[tool_name](params)
    except KeyError as e:
        return f"[error] Missing required param {e} for tool '{tool_name}'"
    except Exception as e:
        return f"[{tool_name} error] {e}"
