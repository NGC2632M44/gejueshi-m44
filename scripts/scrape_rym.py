"""
RYM 评分爬虫 v2 — Playwright + 等待 Cloudflare 挑战完成
"""
import sys, json, re, time
from playwright.sync_api import sync_playwright

def scrape_rym(query, item_type="song"):
    result = {"source": "rym", "query": query, "type": item_type,
              "rating": None, "rating_count": None, "genres": [],
              "title": None, "artist": None, "year": None, "url": None, "error": None}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            proxy={"server": "http://127.0.0.1:1001"},
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale="en-US", viewport={"width": 1920, "height": 1080},
        )
        page = ctx.new_page()

        try:
            from playwright_stealth import stealth_sync
            stealth_sync(page)
        except ImportError:
            pass

        try:
            search_url = f"https://rateyourmusic.com/search?searchterm={query}&searchtype={item_type[0]}"
            page.goto(search_url, timeout=60000, wait_until="domcontentloaded")

            # 等待 Cloudflare 挑战完成（最多30秒）
            for _ in range(15):
                time.sleep(2)
                html = page.content()
                if "Just a moment" not in html and "cf-browser-verify" not in html:
                    break

            html = page.content()
            if "Just a moment" in html:
                result["error"] = "Cloudflare timeout"
                browser.close()
                return result

            # 搜索页面: 找第一个结果链接
            links = page.locator("a[href*='/song/'], a[href*='/album/']")
            count = links.count()
            if count == 0:
                result["error"] = "No results found"
                browser.close()
                return result

            item_url = links.first.get_attribute("href")
            if not item_url.startswith("http"):
                item_url = "https://rateyourmusic.com" + item_url
            result["url"] = item_url

            # 详情页
            page.goto(item_url, timeout=60000, wait_until="domcontentloaded")
            for _ in range(10):
                time.sleep(2)
                html = page.content()
                if "Just a moment" not in html:
                    break

            html = page.content()

            # 提取评分: 多种模式
            for pattern in [
                r'average rating[^<]*<[^>]*>([\d.]+)',
                r'([\d.]+)\s*/\s*5\.0',
                r'<span[^>]*class="[^"]*rating[^"]*"[^>]*>\s*([\d.]+)',
                r'"averageRating":\s*([\d.]+)',
            ]:
                m = re.search(pattern, html, re.IGNORECASE)
                if m:
                    result["rating"] = float(m.group(1))
                    break

            # 评分人数
            cm = re.search(r'([\d,]+)\s*ratings?', html, re.IGNORECASE)
            if cm:
                result["rating_count"] = int(cm.group(1).replace(",", ""))

            # 流派
            genre_matches = re.findall(r'<a[^>]*class="[^"]*genre[^"]*"[^>]*>([^<]+)</a>', html)
            result["genres"] = list(set(genre_matches))[:10]

            # 标题信息
            tm = re.search(r'<title>([^<]+)</title>', html)
            if tm:
                title = tm.group(1).split(" - Rate Your Music")[0].strip()
                by_idx = title.rfind(" by ")
                if by_idx > 0:
                    result["title"] = title[:by_idx].strip()
                    artist_year = title[by_idx + 4:].strip()
                    ym = re.search(r'\((\d{4})\)', artist_year)
                    if ym:
                        result["year"] = int(ym.group(1))
                        result["artist"] = artist_year[:artist_year.rfind("(")].strip()
                    else:
                        result["artist"] = artist_year

        except Exception as e:
            result["error"] = str(e)[:200]

        browser.close()
    return result

if __name__ == "__main__":
    query = sys.argv[1] if len(sys.argv) > 1 else "The Kills Future Starts Slow"
    item_type = sys.argv[2] if len(sys.argv) > 2 else "song"
    start = time.time()
    result = scrape_rym(query, item_type)
    result["elapsed_ms"] = round((time.time() - start) * 1000)
    print(json.dumps(result, ensure_ascii=False, indent=2))
