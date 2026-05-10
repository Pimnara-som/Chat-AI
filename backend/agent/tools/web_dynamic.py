# =============================================================================
# tools/web_dynamic.py
# Playwright-based dynamic browser tools
# รองรับ JavaScript, click, form fill — headless Chromium
#
# ติดตั้งก่อนใช้งาน (ทำครั้งแรกใน Lightning AI terminal):
#   playwright install chromium
#   playwright install-deps chromium
# =============================================================================

import re
from typing import Optional


def _clean(text: str, max_chars: int) -> str:
    """Strip whitespace-heavy text and truncate."""
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    return text[:max_chars]


def browse_url(url: str, max_chars: int = 20000) -> str:
    """
    เปิด URL ด้วย Chromium headless — รองรับ JS / dynamic content.
    ใช้เมื่อ read_url (requests) ไม่ได้ผลเพราะเว็บ JS-heavy.

    Returns cleaned text body ของหน้าเว็บ.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return "[browse_url error] playwright not installed — run: playwright install chromium"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto(url, timeout=20_000, wait_until="domcontentloaded")
            page.wait_for_timeout(1_500)   # รอ JS render
            text = page.inner_text("body")
            return _clean(text, max_chars)
        except Exception as e:
            return f"[browse_url error] {e}"
        finally:
            browser.close()


def click_and_read(url: str, selector: str, max_chars: int = 20000) -> str:
    """
    ไปที่ URL → คลิก element ตาม CSS selector → คืน text หลังคลิก.

    ตัวอย่าง selector:
      "button:has-text('Load more')"
      "#next-page"
      "a[href*='results']"
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return "[click_and_read error] playwright not installed"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto(url, timeout=20_000, wait_until="domcontentloaded")
            page.wait_for_timeout(1_000)
            page.click(selector, timeout=5_000)
            page.wait_for_timeout(1_500)
            text = page.inner_text("body")
            return _clean(text, max_chars)
        except Exception as e:
            return f"[click_and_read error] {e}"
        finally:
            browser.close()


def search_and_click_first(query: str, max_chars: int = 20000) -> str:
    """
    DuckDuckGo search → คลิก / อ่าน result แรกแบบ full Playwright browser.
    ใช้เมื่อต้องการข้อมูลเชิงลึกจากแหล่งเดียวและเว็บนั้น JS-heavy.
    """
    try:
        from ddgs import DDGS
    except ImportError:
        return "[search_and_click_first error] duckduckgo-search not installed"

    with DDGS(timeout=10) as ddgs:
        results = list(ddgs.text(query, max_results=5))

    if not results:
        return "ไม่พบผลลัพธ์"

    for r in results:
        url = r.get("href", "")
        if not url:
            continue
        content = browse_url(url, max_chars)
        if "[browse_url error]" not in content and len(content) > 200:
            return f"[Source: {url}]\n{content}"

    # Fallback: คืน snippet ถ้าเปิดเว็บไม่ได้
    return "\n\n".join(
        f"[{r['title']}] {r['href']}\n{r['body'][:300]}"
        for r in results[:3]
    )


def fill_and_submit(url: str, fields: dict[str, str],
                    submit_selector: str, max_chars: int = 20000) -> str:
    """
    กรอก form fields แล้วกด submit.

    Parameters
    ----------
    url              : target page URL
    fields           : {"CSS selector": "value to fill"}
                       e.g. {"#search-box": "kimi k2.5"}
    submit_selector  : CSS selector for submit button
                       e.g. "button[type='submit']"
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return "[fill_and_submit error] playwright not installed"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            page.goto(url, timeout=20_000, wait_until="domcontentloaded")
            page.wait_for_timeout(1_000)
            for selector, value in fields.items():
                page.fill(selector, str(value))
            page.click(submit_selector, timeout=5_000)
            page.wait_for_timeout(2_000)
            text = page.inner_text("body")
            return _clean(text, max_chars)
        except Exception as e:
            return f"[fill_and_submit error] {e}"
        finally:
            browser.close()
