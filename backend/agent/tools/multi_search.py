# =============================================================================
# tools/multi_search.py
# Parallel web search — I/O bound, safe on 1x GPU
# ThreadPool ไม่ใช้ GPU เลย → run ขนานกับ model inference ได้
# =============================================================================

import concurrent.futures
from typing import Optional


# =============================================================================
# tools/multi_search.py
# Parallel web search — I/O bound, safe on 1x GPU
# ThreadPool ไม่ใช้ GPU เลย → run ขนานกับ model inference ได้
# [Fix #7] ใช้ ThreadPoolExecutor จริงๆ (DDGS >= 4.x thread-safe แล้ว)
# =============================================================================

import concurrent.futures
from typing import Optional


def parallel_search(queries: list[str], max_workers: int = 4) -> dict[str, str]:
    """
    รัน web_search หลาย queries พร้อมกันด้วย ThreadPoolExecutor.
    [Fix #7] DDGS >= 4.x ใช้ httpx ซึ่ง thread-safe → parallel จริงๆ ได้
    Fallback เป็น sequential อัตโนมัติถ้า thread error.

    Parameters
    ----------
    queries     : list of search strings (cap ที่ 4 เพื่อ latency)
    max_workers : จำนวน thread สูงสุด

    Returns
    -------
    {query: result_text}
    """
    from tool_definitions import web_search   # avoid circular at module level

    queries = queries[:4]   # hard cap
    results: dict[str, str] = {}

    try:
        # Attempt true parallel search
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(max_workers, len(queries))) as pool:
            future_to_q = {pool.submit(web_search, q): q for q in queries}
            for future in concurrent.futures.as_completed(future_to_q, timeout=30):
                q = future_to_q[future]
                try:
                    results[q] = future.result(timeout=15)
                except Exception as e:
                    results[q] = f"[search error] {e}"
    except Exception:
        # Fallback: sequential (safe for older DDGS versions)
        for q in queries:
            try:
                results[q] = web_search(q)
            except Exception as e:
                results[q] = f"[search error] {e}"

    return results


def parallel_read(urls: list[str], max_workers: int = 3) -> dict[str, str]:
    """
    อ่าน URL หลายอันพร้อมกันด้วย ThreadPool (static requests only).

    Returns
    -------
    {url: page_text}
    """
    from tool_definitions import read_url

    urls = urls[:5]   # cap
    results: dict[str, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_to_url = {pool.submit(read_url, u): u for u in urls}
        for future in concurrent.futures.as_completed(future_to_url):
            u = future_to_url[future]
            try:
                results[u] = future.result(timeout=30)
            except Exception as e:
                results[u] = f"[read error] {e}"
    return results


def merge_search_results(results: dict[str, str], max_chars: int = 20000) -> str:
    """
    รวมผล search หลาย queries → dedup + truncate → single string.
    Budget แบ่งเท่ากันต่อ query เพื่อไม่ให้ query แรก dominate.
    """
    seen: set[str] = set()
    merged: list[str] = []
    per_q = max_chars // max(len(results), 1)

    for query, text in results.items():
        merged.append(f"### Query: {query}")
        added = 0
        for line in text.split("\n"):
            line = line.strip()
            if not line or line in seen:
                continue
            seen.add(line)
            merged.append(line)
            added += len(line)
            if added >= per_q:
                break

    return "\n".join(merged)
