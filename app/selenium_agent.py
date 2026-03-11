import time
import json
import anthropic
import random
import re
import threading
import requests as http_requests
from urllib.parse import quote, quote_plus, urljoin, urlparse

from interest_utils import normalize_interest_list, rotate_interest_queue
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.action_chains import ActionChains

try:
    from selenium_stealth import stealth
except ImportError:
    stealth = None

try:
    from webdriver_manager.chrome import ChromeDriverManager
except ImportError:
    ChromeDriverManager = None

# Global dictionary to track active drivers by account_id
active_drivers = {}
session_modhash = {}
active_comment_claims = set()
active_comment_claims_lock = threading.Lock()


def _clear_account_session_state(account_id):
    active_drivers.pop(account_id, None)
    session_modhash.pop(account_id, None)


def _mask_secret(secret):
    value = (secret or "").strip()
    if not value:
        return "missing"
    if len(value) <= 4:
        return "***"
    return "***" + value[-4:]


def _safe_int(value, default, min_value=None, max_value=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    if min_value is not None:
        parsed = max(min_value, parsed)
    if max_value is not None:
        parsed = min(max_value, parsed)
    return parsed


def _normalize_subreddit_name(subreddit):
    value = (subreddit or "").strip()
    if value.startswith("/"):
        value = value[1:]
    lowered = value.lower()
    if lowered.startswith("r/"):
        value = value[2:]
    return value.strip().strip("/")


def _validate_reddit_post_url(raw_url):
    url = _normalize_reddit_post_url(raw_url)
    if not url:
        candidate = (raw_url or "").strip()
        parsed_candidate = urlparse(candidate if "://" in candidate else f"https://{candidate}")
        host = (parsed_candidate.netloc or "").lower()
        path_parts = [part for part in (parsed_candidate.path or "").split("/") if part]
        if host == "redd.it" and path_parts:
            return f"https://www.reddit.com/comments/{path_parts[0]}"
        if (host == "reddit.com" or host.endswith(".reddit.com")) and "/comments/" in (parsed_candidate.path or ""):
            return parsed_candidate._replace(query="", fragment="").geturl()
        raise ValueError("Invalid Reddit URL provided.")
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if host == "redd.it":
        path_parts = [part for part in (parsed.path or "").split("/") if part]
        if not path_parts:
            raise ValueError("Target URL must be a Reddit post URL.")
        return f"https://www.reddit.com/comments/{path_parts[0]}"
    if host != "reddit.com" and not host.endswith(".reddit.com"):
        raise ValueError("Target URL must be a Reddit URL.")
    if "/comments/" not in (parsed.path or ""):
        raise ValueError("Target URL must be a Reddit post URL.")
    return url

# Pool of realistic user agents
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
]

def _build_driver(proxy=None):
    """Build a stealth Chrome driver that evades bot detection."""
    chrome_options = Options()

    # Core stability flags
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-software-rasterizer")
    chrome_options.add_argument("--disable-extensions")
    chrome_options.add_argument("--no-first-run")
    chrome_options.add_argument("--no-default-browser-check")

    # Random window size for fingerprint variance
    widths = [1280, 1366, 1440, 1536, 1600, 1920]
    heights = [720, 768, 900, 864, 1024, 1080]
    w, h = random.choice(widths), random.choice(heights)
    chrome_options.add_argument(f"--window-size={w},{h}")

    # Random user agent
    chosen_ua = random.choice(USER_AGENTS)
    chrome_options.add_argument(f"user-agent={chosen_ua}")

    # Hide automation markers
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
    chrome_options.add_experimental_option('useAutomationExtension', False)

    # Disable infobars & password saving popups
    chrome_options.add_argument("--disable-infobars")
    chrome_options.add_argument("--disable-save-password-bubble")
    chrome_options.add_experimental_option("prefs", {
        "credentials_enable_service": False,
        "profile.password_manager_enabled": False,
        "profile.default_content_setting_values.notifications": 2,
    })

    if proxy:
        # Chrome's --proxy-server expects host:port (no http:// scheme prefix).
        # Passing http:// causes Chrome to crash when connecting to HTTPS sites.
        proxy_clean = proxy.strip().rstrip('/')
        for scheme in ('https://', 'http://', 'socks5://', 'socks4://'):
            if proxy_clean.lower().startswith(scheme):
                proxy_clean = proxy_clean[len(scheme):]
                break
        chrome_options.add_argument(f'--proxy-server={proxy_clean}')

    # Create the driver
    if ChromeDriverManager:
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)
    else:
        driver = webdriver.Chrome(options=chrome_options)

    driver.set_page_load_timeout(60)
    driver.set_script_timeout(30)

    # Apply selenium-stealth patches
    if stealth:
        stealth(driver,
            languages=["en-US", "en"],
            vendor="Google Inc.",
            platform="Win32",
            webgl_vendor="Intel Inc.",
            renderer="Intel Iris OpenGL Engine",
            fix_hairline=True,
        )

    # Extra JS-level hiding
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {
        "source": """
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
            Object.defineProperty(navigator, 'languages', {get: () => ['en-US', 'en']});
            Object.defineProperty(navigator, 'plugins', {get: () => [1, 2, 3, 4, 5]});
            window.chrome = { runtime: {} };
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
            );
        """
    })

    return driver


def login_to_reddit(account_id, username, password, proxy=None, cookies_json=None):
    driver = _build_driver(proxy)
    active_drivers[account_id] = driver
    new_cookies = None
    try:
        # 1. Try Cookie Login
        if cookies_json:
            print(f"[{username}] Attempting cookie login")
            driver.get("https://www.reddit.com")
            try:
                cookies = json.loads(cookies_json)
                for cookie in cookies:
                    if 'name' in cookie and 'value' in cookie and 'domain' in cookie:
                        driver.add_cookie(cookie)
                driver.get("https://www.reddit.com")
                time.sleep(3)
                try:
                    driver.find_element(By.LINK_TEXT, "Log In")
                    print(f"[{username}] Cookie login expired, falling back")
                except Exception:
                    print(f"[{username}] Cookie login successful")
                    new_cookies = json.dumps(driver.get_cookies())
                    return True, "Login Successful (Session Cookies)", new_cookies
            except Exception as e:
                print(f"[{username}] Cookie error: {e}")

        # 2. Manual Login
        print(f"[{username}] Manual login")
        driver.get("https://www.reddit.com/login")
        time.sleep(random.uniform(2, 4)) # Natural delay
        
        wait = WebDriverWait(driver, 20)
        user_field = wait.until(EC.presence_of_element_located((By.NAME, "username")))
        for char in username:
            user_field.send_keys(char)
            time.sleep(random.uniform(0.05, 0.2)) # Realistic typing
            
        pass_field = driver.find_element(By.NAME, "password")
        for char in password:
            pass_field.send_keys(char)
            time.sleep(random.uniform(0.05, 0.2)) # Realistic typing
            
        time.sleep(random.uniform(0.5, 1.5))
        driver.find_element(By.TAG_NAME, "button").click()
        time.sleep(random.uniform(5, 7))

        if "login" not in driver.current_url:
            new_cookies = json.dumps(driver.get_cookies())
            return True, "Login Successful", new_cookies
        else:
            _clear_account_session_state(account_id)
            try:
                error = driver.find_element(By.CLASS_NAME, "AnimatedForm__errorMessage").text
            except Exception as error_lookup_err:
                print(f"[{username}] Login error lookup failed: {str(error_lookup_err)[:200]}")
                error = "Unknown error"
            driver.quit()
            return False, f"Login Failed: {error}", None
    except Exception as e:
        crash_msg = str(e)
        print(f"[{username}] Browser exception: {crash_msg[:300]}")
        try:
            driver.quit()
        except Exception as quit_err:
            print(f"[{username}] Driver quit failed: {str(quit_err)[:200]}")
        _clear_account_session_state(account_id)
        return False, crash_msg, None

def open_browser_for_proxy_test(account_id, proxy=None):
    driver = _build_driver(proxy)
    active_drivers[account_id] = driver
    try:
        driver.get("https://ip.me")
        return True, "Opened IP verification site"
    except Exception as e:
        try:
            driver.quit()
        except Exception as quit_err:
            print(f"[proxy-test:{account_id}] Driver quit failed: {str(quit_err)[:200]}")
        _clear_account_session_state(account_id)
        return False, str(e)


def stop_driver(account_id):
    if account_id in active_drivers:
        try:
            active_drivers[account_id].quit()
        except Exception as e:
            print(f"[driver:{account_id}] Stop failed: {str(e)[:200]}")
        _clear_account_session_state(account_id)
        return True
    return False


# ─── Job system ───────────────────────────────────────────────────────────────

def _ensure_logged_in(account_id, username, password, proxy=None, cookies_json=None):
    """Reuse active driver or start a new session for job execution."""
    if account_id in active_drivers:
        try:
            # Verify driver is still alive
            _ = active_drivers[account_id].current_url
            return active_drivers[account_id], None
        except:
            _clear_account_session_state(account_id)

    # Start fresh session
    success, message, new_cookies = login_to_reddit(account_id, username, password, proxy, cookies_json)
    if not success:
        return None, message
    return active_drivers.get(account_id), new_cookies


def do_search(driver, keyword):
    """Search Reddit for a keyword and return top post titles/links."""
    driver.get(f"https://www.reddit.com/search/?q={keyword.replace(' ', '+')}&sort=relevance")
    time.sleep(4)
    posts = []
    try:
        items = driver.find_elements(By.CSS_SELECTOR, "a[data-testid='post-title'], shreddit-post")
        for item in items[:10]:
            try:
                title = item.get_attribute("aria-label") or item.text.strip()
                href = item.get_attribute("href") or ""
                if title:
                    posts.append({"title": title, "url": href})
            except:
                pass
    except Exception as e:
        pass
    return posts


def do_join_subreddit(driver, subreddit_name, log_fn=None):
    """Navigate to a subreddit and click the Join/Subscribe button."""
    subreddit_name = _normalize_subreddit_name(subreddit_name)
    if not subreddit_name:
        if log_fn:
            log_fn("[Join] Invalid subreddit name; skipping", "warning")
        return "failed"

    driver.get(f"https://www.reddit.com/r/{quote(subreddit_name, safe='')}/")
    time.sleep(2)

    if _api_verify_subscription(driver, subreddit_name, log_fn):
        if log_fn:
            log_fn(f"[Join] Already joined r/{subreddit_name}", "info")
        return "already"

    selectors = [
        "shreddit-subreddit-header button[aria-label*='join' i]",
        "shreddit-join-button button",
        "button[data-testid='subreddit-sidebar-join-button']",
        "[slot='subscribe-button'] button",
        "button.joinButton",
        "button[aria-label*='join' i]",
    ]

    joined = False
    attempts = 5

    for _ in range(attempts):
        try:
            driver.execute_script("window.scrollTo(0, 0);")
        except:
            pass

        btn, used = _first_visible_including_shadow(driver, selectors)
        if btn:
            try:
                if log_fn and used:
                    log_fn(f"[Join] Found join button via: {used}", "info")
                try:
                    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", btn)
                    time.sleep(0.2)
                    driver.execute_script("arguments[0].click();", btn)
                except:
                    btn.click()
                for _ in range(3):
                    time.sleep(0.8)
                    if _api_verify_subscription(driver, subreddit_name, log_fn):
                        joined = True
                        break
                if joined:
                    break
            except:
                pass

        # Close overlays and retry
        _close_media_overlays(driver, log_fn)
        time.sleep(0.8)

    if not joined:
        # Last resort: any visible button with "join"
        try:
            btns = driver.find_elements(By.TAG_NAME, "button")
            for btn in btns:
                if not btn or not btn.is_displayed():
                    continue
                text = (btn.text or "").strip().lower()
                if "join" in text:
                    btn.click()
                    for _ in range(3):
                        time.sleep(0.8)
                        if _api_verify_subscription(driver, subreddit_name, log_fn):
                            joined = True
                            break
                    break
        except:
            pass

    if joined:
        return "joined"
    return "failed"


def search_subreddits_by_interest(keyword, limit=5):
    try:
        url = "https://www.reddit.com/subreddits/search.json"
        params = {"q": keyword, "limit": max(limit, 5)}
        headers = {"User-Agent": random.choice(USER_AGENTS)}
        res = http_requests.get(url, params=params, headers=headers, timeout=10)
        if res.status_code != 200:
            return []
        data = res.json()
        items = data.get("data", {}).get("children", [])
        results = []
        for item in items:
            name = item.get("data", {}).get("display_name")
            if name:
                results.append(name)
            if len(results) >= limit:
                break
        return results
    except Exception:
        return []


def _load_prompt_template():
    """Load the comment instructions markdown file."""
    import os
    prompt_path = os.path.join(os.path.dirname(__file__), 'prompts', 'comment_instructions.md')
    try:
        with open(prompt_path, 'r', encoding='utf-8') as f:
            return f.read()
    except FileNotFoundError:
        return ""

def ai_generate_interests_tags(personality, api_key, model="claude-sonnet-4-20250514"):
    import anthropic
    
    prompt = f"""You are an AI assistant helping to build a persona profile.
Given the following agent personality:
{personality}

Generate exactly 5 to 10 short, specific keywords or short phrases (1-3 words max) that this persona would be highly interested in searching for on Reddit (e.g., specific hobbies, locations, gear, topics).
Return ONLY a comma-separated list of these tags, with no other text, no quotes, and no formatting. Do not include bullet points."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=60,
            temperature=0.7,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()
        tags = [t.strip() for t in text.split(',') if t.strip()]
        return tags
    except Exception as e:
        print(f"[Tags Gen] AI tag generation failed: {e}")
        return []


def _ai_generate_search_keyword(interests, search_history_list, api_key, model, log_fn=None):
    """Generate a unique search keyword based on interests and past history."""
    prompt = f"""You are a Reddit user deciding what to search for.
Your interests:
{interests}

Previously searched keywords (DO NOT USE THESE OR ANYTHING SIMILAR):
{', '.join(search_history_list) if search_history_list else 'None'}

Think of a natural, slightly casual search query (2-5 words) that someone with these interests would search on Reddit right now. Be specific, like a real human wondering about something. Output ONLY the raw keyword text, no quotes, nothing else."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=20,
            system="You are a helpful assistant that outputs only single search queries.",
            messages=[{"role": "user", "content": prompt}]
        )
        keyword = response.content[0].text.strip().strip('"').strip("'")
        if log_fn:
            log_fn(f"[Keyword Gen] AI generated new keyword: '{keyword}'", "info")
        return keyword
    except Exception as e:
        if log_fn:
            log_fn(f"[Keyword Gen] AI keyword generation failed: {e}", "error")
        raise Exception("Failed to generate search keyword")


def _ai_pick_post(posts, keyword, personality, api_key, model, log_fn=None):
    """Ask Claude to pick the best post from search results."""
    if not posts:
        return 0
    
    post_list = "\n".join([f"{i+1}. {p['title']} (r/{p.get('subreddit', 'unknown')})" for i, p in enumerate(posts)])
    
    prompt_template = _load_prompt_template()
    
    system_prompt = f"""You are helping a Reddit user pick a post to comment on.

{prompt_template.split('---')[0] if '---' in prompt_template else ''}

The user's personality: {personality}

Pick the post where this personality would most naturally have something genuine to say."""

    user_prompt = f"""Search keyword: "{keyword}"

Posts:
{post_list}

Return ONLY the post number (integer). Nothing else."""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=10,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}]
        )
        result = response.content[0].text.strip()
        choice = int(''.join(filter(str.isdigit, result))) - 1
        if 0 <= choice < len(posts):
            if log_fn:
                log_fn(f"[Comment] AI selected post #{choice+1}: {posts[choice]['title'][:80]}", "info")
            return choice
        else:
            if log_fn:
                log_fn(f"[Comment] AI returned out-of-range #{choice+1}, defaulting to #1", "warning")
            return 0
    except Exception as e:
        if log_fn:
            log_fn(
                f"[Comment] AI post selection failed (API Key: '{_mask_secret(api_key)}', Model: '{model}'): {e}, defaulting to first result",
                "warning"
            )
        return 0


def _ai_generate_comment(post_title, post_body, keyword, personality, api_key, model, extra_context="", log_fn=None, max_words=15, max_sentences=1):
    """Ask Claude to generate a natural comment for a post."""
    prompt_template = _load_prompt_template()
    
    step2_rules = ""
    if '---' in prompt_template:
        parts = prompt_template.split('---')
        if len(parts) > 1:
            step2_rules = parts[1]
    
    system_prompt = f"""You are a Reddit user with the following personality:

{personality}

{step2_rules}

Write a comment for the post below. Output ONLY the raw comment text."""

    body_preview = post_body[:1500] if post_body else "(no body text)"
    
    user_prompt = f"""Post title: {post_title}
Post content: {body_preview}

Search context: The user found this post by searching "{keyword}".
{f"Extra guidance: {extra_context}" if extra_context else ""}

Write your comment now:"""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=model,
            max_tokens=300,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}]
        )
        comment = response.content[0].text.strip()
        if comment.startswith('"') and comment.endswith('"'):
            comment = comment[1:-1]

        def _sanitize_comment(text):
            text = re.sub(r"<[^>]+>", " ", text or "")
            text = re.sub(r"\bsystem-reminder\b[\s\S]*", " ", text, flags=re.IGNORECASE)
            text = re.sub(r"\bplan mode\b[\s\S]*", " ", text, flags=re.IGNORECASE)
            text = re.sub(r"\bread-only mode\b[\s\S]*", " ", text, flags=re.IGNORECASE)
            text = re.sub(r"\bbuild mode\b[\s\S]*", " ", text, flags=re.IGNORECASE)
            text = re.sub(r"\boperational mode\b[\s\S]*", " ", text, flags=re.IGNORECASE)
            text = text.replace("—", " ").replace("–", " ")
            return " ".join(text.split())

        def _word_count(text):
            return len([w for w in text.split() if w.strip()])

        def _tokenize(text):
            return re.findall(r"[a-zA-Z']+", (text or "").lower())

        stopwords = {
            "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "from", "by", "about",
            "as", "is", "are", "was", "were", "be", "been", "being", "it", "this", "that", "these", "those",
            "i", "me", "my", "mine", "we", "our", "us", "you", "your", "he", "she", "they", "them", "their",
            "his", "her", "him", "at", "into", "over", "after", "before", "but", "so", "because", "if", "then",
            "than", "just", "really", "very", "love", "like", "enjoy", "enjoys", "loved", "liked", "enjoying"
        }

        post_words = set(_tokenize(f"{post_title} {post_body}"))
        personality_terms = {
            t for t in _tokenize(personality)
            if len(t) >= 4 and t not in stopwords
        }
        blocked_terms = sorted([t for t in personality_terms if t not in post_words])

        comment = _sanitize_comment(comment)
        comment_terms = set(_tokenize(comment))
        off_topic_terms = [t for t in blocked_terms if t in comment_terms]
        suspicious_terms = [
            "system-reminder", "plan mode", "read-only mode", "build mode", "operational mode",
            "tool call", "developer message", "assistant", "user message", "type your own answer"
        ]
        leaked_meta = [term for term in suspicious_terms if term in comment.lower()]

        needs_rewrite = _word_count(comment) > max_words or bool(off_topic_terms) or bool(leaked_meta)
        if needs_rewrite:
            if log_fn:
                reason = "length" if _word_count(comment) > max_words else "meta leakage" if leaked_meta else "off-topic"
                if off_topic_terms:
                    log_fn(f"[Comment] Off-topic terms detected: {', '.join(off_topic_terms[:6])}", "warning")
                if leaked_meta:
                    log_fn(f"[Comment] Meta leakage detected: {', '.join(leaked_meta[:6])}", "warning")
                log_fn(f"[Comment] Comment needs rewrite due to {reason}", "warning")

            constraints = [
                f"No more than {max_sentences} sentence{'s' if max_sentences != 1 else ''} and {max_words} words maximum.",
                "No em-dashes, no filler, no generic AI phrasing.",
                "Keep it strictly about the post title/content.",
                "Mention at least one concrete detail from the post, not a generic observation.",
                "Do NOT include meta text, XML tags, system instructions, or anything about prompts, tools, planning, or modes.",
            ]
            if off_topic_terms:
                constraints.append(
                    "Do NOT mention these terms unless they are in the post: " + ", ".join(off_topic_terms[:10]) + "."
                )

            rewrite_prompt = "Rewrite this Reddit comment. " + " ".join(constraints) + "\n" \
                + "Return ONLY the rewritten comment text.\n\n" \
                + f"Original comment: {comment}"
            try:
                rewrite = client.messages.create(
                    model=model,
                    max_tokens=120,
                    system="You output only the rewritten comment text.",
                    messages=[{"role": "user", "content": rewrite_prompt}]
                )
                comment = _sanitize_comment(rewrite.content[0].text.strip())
            except Exception as rewrite_err:
                if log_fn:
                    log_fn(f"[Comment] Rewrite failed: {rewrite_err}", "warning")

        if any(term in comment.lower() for term in suspicious_terms):
            if log_fn:
                log_fn("[Comment] Meta leakage remained after rewrite; discarding comment", "warning")
            return None

        if _word_count(comment) > max_words:
            words = [w for w in comment.split() if w.strip()]
            comment = " ".join(words[:max_words])
            if log_fn:
                log_fn(f"[Comment] Truncated comment to {max_words} words", "warning")

        if log_fn:
            preview = comment[:100] + ('...' if len(comment) > 100 else '')
            log_fn(f"[Comment] AI generated ({len(comment)} chars): {preview}", "info")
        return comment
    except Exception as e:
        error_msg = (
            f"[Comment] AI comment generation failed (API Key: '{_mask_secret(api_key)}', Model: '{model}'): {str(e)}"
        )
        if log_fn:
            log_fn(error_msg, "error")
        else:
            print(error_msg)
        return None


def _normalize_reddit_post_url(raw_url):
    """Normalize Reddit links to absolute URLs suitable for driver.get()."""
    if not raw_url:
        return ""
    url = raw_url.strip()
    if not url:
        return ""
    if url.startswith("//"):
        url = "https:" + url
    if url.startswith("/"):
        url = urljoin("https://www.reddit.com", url)
    if not url.startswith("http"):
        return ""
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    if host != "reddit.com" and not host.endswith(".reddit.com"):
        return ""
    # Strip query/fragment for stable dedupe and reliable navigation
    return parsed._replace(query="", fragment="").geturl()


def normalize_commented_post_url(raw_url):
    """Normalize Reddit post URLs for CommentedPost dedupe checks."""
    candidate = (raw_url or "").strip()
    if not candidate:
        return ""

    if candidate.startswith("//"):
        candidate = "https:" + candidate
    if candidate.startswith("/"):
        candidate = urljoin("https://www.reddit.com", candidate)

    parsed = urlparse(candidate if "://" in candidate else f"https://{candidate}")
    host = (parsed.netloc or "").lower()
    path_parts = [part for part in (parsed.path or "").split("/") if part]

    post_id = ""
    if host == "redd.it" and path_parts:
        post_id = path_parts[0]
    elif host == "reddit.com" or host.endswith(".reddit.com"):
        if "comments" in path_parts:
            comments_index = path_parts.index("comments")
            if comments_index + 1 < len(path_parts):
                post_id = path_parts[comments_index + 1]

    if post_id:
        return f"https://www.reddit.com/comments/{post_id}"

    try:
        normalized_url = _validate_reddit_post_url(raw_url)
    except ValueError:
        normalized_url = _normalize_reddit_post_url(raw_url)
    return normalized_url.split('#')[0].rstrip('/') if normalized_url else ""


def has_account_commented_post(account_id, raw_url):
    normalized_target_url = normalize_commented_post_url(raw_url)
    if not normalized_target_url:
        return False

    from models import CommentedPost

    commented_posts = CommentedPost.query.filter_by(account_id=account_id).all()
    for commented_post in commented_posts:
        if normalize_commented_post_url(commented_post.post_url) == normalized_target_url:
            return True
    return False


def get_account_commented_post_urls(account_id):
    from models import CommentedPost

    return {
        normalized_url
        for normalized_url in (
            normalize_commented_post_url(commented_post.post_url)
            for commented_post in CommentedPost.query.filter_by(account_id=account_id).all()
        )
        if normalized_url
    }


def try_acquire_comment_claim(account_id, raw_url):
    normalized_target_url = normalize_commented_post_url(raw_url)
    if not normalized_target_url:
        return False, ""

    claim_key = (int(account_id), normalized_target_url)
    with active_comment_claims_lock:
        if claim_key in active_comment_claims:
            return False, normalized_target_url
        active_comment_claims.add(claim_key)
    return True, normalized_target_url


def release_comment_claim(account_id, raw_url):
    normalized_target_url = normalize_commented_post_url(raw_url)
    if not normalized_target_url:
        return

    claim_key = (int(account_id), normalized_target_url)
    with active_comment_claims_lock:
        active_comment_claims.discard(claim_key)


def _parse_interests(raw_interests):
    return normalize_interest_list(raw_interests)


def _get_interest_keyword(account, log_fn=None):
    interests_list = _parse_interests(account.interests)
    if log_fn:
        preview = ", ".join(interests_list[:5])
        log_fn(f"[Keyword] Current interests: {preview}", "info")
    if not interests_list:
        raise Exception("Keyword is empty and no interests are configured for this agent.")
    keyword = interests_list[0]
    if log_fn:
        log_fn(f"[Keyword] Using interest keyword: \"{keyword}\"", "info")
    return keyword, interests_list


def _rotate_interests(account, interests_list, log_fn=None):
    rotated_csv, rotated_interests, used_interest = rotate_interest_queue(interests_list)
    if not rotated_interests:
        return
    account.interests = rotated_csv
    from models import db
    db.session.commit()
    if log_fn:
        if used_interest and len(rotated_interests) == 1:
            log_fn(f"[Keyword] Kept single interest in place: {used_interest}", "info")
        else:
            log_fn("[Keyword] Rotated interests after success", "info")


def _extract_posts_from_current_results_page(driver):
    """Extract candidate posts from current page using multiple strategies."""
    posts = []

    # Strategy 1: New Reddit post cards
    try:
        cards = driver.find_elements(By.CSS_SELECTOR, "shreddit-post")
        for el in cards[:40]:
            try:
                title = (el.get_attribute("post-title") or el.get_attribute("aria-label") or "").strip()
                href = el.get_attribute("content-href") or el.get_attribute("permalink") or ""
                if not href:
                    try:
                        link = el.find_element(By.CSS_SELECTOR, "a[slot='full-post-link'], a[href*='/comments/']")
                        href = link.get_attribute("href") or ""
                    except:
                        pass
                url = _normalize_reddit_post_url(href)
                if not url or "/comments/" not in url:
                    continue
                subreddit = (el.get_attribute("subreddit-prefixed-name") or "").replace("r/", "")
                post_type = (el.get_attribute("post-type") or "text").lower()
                if not title:
                    title = "Reddit post"
                posts.append({"title": title, "url": url, "subreddit": subreddit or "unknown", "post_type": post_type})
            except:
                pass
    except:
        pass

    # Strategy 2: Direct title links
    try:
        anchors = driver.find_elements(
            By.CSS_SELECTOR,
            "a[data-testid='post-title'], a[slot='full-post-link'], a[href*='/comments/']"
        )
        for a in anchors[:120]:
            try:
                href = a.get_attribute("href") or ""
                url = _normalize_reddit_post_url(href)
                if not url or "/comments/" not in url:
                    continue
                title = (a.text or a.get_attribute("aria-label") or a.get_attribute("title") or "").strip()
                if not title:
                    continue
                posts.append({"title": title, "url": url, "subreddit": "unknown"})
            except:
                pass
    except:
        pass

    # Strategy 3: DOM + open shadow roots anchor sweep
    try:
        js_posts = driver.execute_script("""
            function allElements(root) {
                const out = [];
                if (!root || !root.querySelectorAll) return out;
                const stack = [root];
                while (stack.length) {
                    const cur = stack.pop();
                    const nodes = cur.querySelectorAll('*');
                    for (const n of nodes) {
                        out.push(n);
                        if (n.shadowRoot) stack.push(n.shadowRoot);
                    }
                }
                return out;
            }
            const out = [];
            const seen = new Set();
            for (const el of allElements(document)) {
                if (el.tagName !== 'A') continue;
                const href = el.getAttribute('href') || '';
                if (!href.includes('/comments/')) continue;
                const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim();
                if (!txt) continue;
                if (seen.has(href)) continue;
                seen.add(href);
                out.push({ title: txt, url: href });
                if (out.length >= 120) break;
            }
            return out;
        """) or []
        for item in js_posts:
            try:
                url = _normalize_reddit_post_url(item.get("url", ""))
                title = (item.get("title", "") or "").strip()
                if title and url and "/comments/" in url:
                    posts.append({"title": title, "url": url, "subreddit": "unknown"})
            except:
                pass
    except:
        pass

    # Dedupe by URL, keep first non-empty title
    unique = {}
    for p in posts:
        u = p.get("url", "")
        if not u:
            continue
        if u not in unique:
            unique[u] = p
        elif (not unique[u].get("title")) and p.get("title"):
            unique[u] = p
    return list(unique.values())


def _scrape_search_results(driver, log_fn=None):
    """Scrape post titles/subreddits/URLs with retries for lazy-loaded pages."""
    for attempt in range(1, 5):
        posts = _extract_posts_from_current_results_page(driver)
        if posts:
            return posts[:20]
        try:
            driver.execute_script("window.scrollBy(0, 900);")
        except:
            pass
        time.sleep(1.2 + (attempt * 0.4))
        if log_fn:
            log_fn(f"[Search] No results yet (attempt {attempt}/4), retrying...", "warning")
    return []


def _search_posts_with_fallback(driver, keyword, sort_filter, log_fn=None):
    """Try multiple Reddit search URL formats and return parsed posts."""
    q = quote_plus((keyword or "").strip())
    sort = (sort_filter or "hot").strip()
    urls = [
        f"https://www.reddit.com/search/?q={q}&sort={sort}&type=link",
        f"https://www.reddit.com/search/?q={q}&sort={sort}",
        f"https://old.reddit.com/search?q={q}&sort={sort}&type=link",
    ]

    for idx, url in enumerate(urls, start=1):
        try:
            if log_fn:
                log_fn(f"[Search] Attempt {idx}: {url}", "info")
            driver.get(url)
            time.sleep(random.uniform(2.5, 4.0))
            posts = _scrape_search_results(driver, log_fn=log_fn)
            if posts:
                if log_fn:
                    log_fn(f"[Search] Parsed {len(posts)} posts on attempt {idx}", "success")
                return posts
        except Exception as e:
            if log_fn:
                log_fn(f"[Search] Attempt {idx} failed: {str(e)[:140]}", "warning")
    return []


def _scrape_post_body(driver):
    """Scrape the text body of the current post page."""
    body = ""
    selectors = [
        "div[data-testid='post-content'] div[data-click-id='text']",
        "div[slot='text-body']",
        "[data-testid='post-content']",
        "shreddit-post div.md",
        ".Post .RichTextJSON-root",
    ]
    for sel in selectors:
        try:
            el = driver.find_element(By.CSS_SELECTOR, sel)
            body = el.text.strip()
            if body:
                break
        except:
            pass
    
    if not body:
        try:
            title_el = driver.find_element(By.CSS_SELECTOR, "h1, [data-testid='post-title']")
            body = title_el.text.strip()
        except:
            pass
    
    return body


def _type_like_human(driver, element, text):
    """Type comment in 3-word chunks over ~3 seconds total so it looks human but is fast."""
    element = _resolve_comment_editor(driver, element)
    if not element:
        return
    try:
        driver.execute_script("arguments[0].focus();", element)
    except:
        pass
    time.sleep(0.15)

    words = text.split(' ')
    chunk_size = 3
    chunks = []
    for i in range(0, len(words), chunk_size):
        chunks.append(' '.join(words[i:i + chunk_size]))

    # Target ~3 seconds total across all chunks
    delay_between = 3.0 / max(len(chunks), 1)

    for idx, chunk in enumerate(chunks):
        # Add a space before each chunk after the first
        to_type = (' ' if idx > 0 else '') + chunk
        try:
            ActionChains(driver).send_keys(to_type).perform()
        except:
            element.send_keys(to_type)
        time.sleep(delay_between)


def _get_editor_text(driver, element):
    element = _resolve_comment_editor(driver, element)
    try:
        return driver.execute_script("""
            const el = arguments[0];
            if (!el) return '';
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
            return (el.innerText || el.textContent || '').trim();
        """, element)
    except:
        return ''


def _first_visible(driver, selectors):
    """Return first visible element found in normal DOM for any selector."""
    for sel in selectors:
        try:
            elements = driver.find_elements(By.CSS_SELECTOR, sel)
            for el in elements:
                if el and el.is_displayed():
                    return el, sel
        except:
            pass
    return None, None


def _find_including_shadow(driver, selector):
    """Find first element matching selector, traversing open shadow roots."""
    script = """
    function queryShadow(root, selector) {
        if (!root) return null;
        let found = root.querySelector(selector);
        if (found) return found;
        const all = root.querySelectorAll('*');
        for (const el of all) {
            if (el.shadowRoot) {
                found = queryShadow(el.shadowRoot, selector);
                if (found) return found;
            }
        }
        return null;
    }
    return queryShadow(document, arguments[0]);
    """
    try:
        return driver.execute_script(script, selector)
    except:
        return None


def _first_visible_including_shadow(driver, selectors):
    """Return first visible element found in DOM or open shadow DOM."""
    el, sel = _first_visible(driver, selectors)
    if el:
        return el, sel

    for sel in selectors:
        el = _find_including_shadow(driver, sel)
        if not el:
            continue
        try:
            if el.is_displayed():
                return el, sel
        except:
            return el, sel
    return None, None


def _open_comment_composer(driver, log_fn=None):
    """Open Reddit comment composer using multiple trigger strategies."""
    trigger_selectors = [
        "button[data-testid='comment-button']",
        "button[aria-label*='comment' i]",
        "faceplate-textarea-input[data-testid='trigger-button']",
        "comment-composer-host faceplate-textarea-input",
        "shreddit-comment-action-row button",
        "shreddit-composer",
    ]

    trigger, used = _first_visible_including_shadow(driver, trigger_selectors)
    if trigger:
        try:
            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", trigger)
            time.sleep(random.uniform(0.3, 0.8))
            driver.execute_script("arguments[0].click();", trigger)
            if log_fn:
                log_fn(f"[Comment] Composer trigger clicked via: {used}", "info")
            time.sleep(random.uniform(1.0, 2.0))
            return True
        except Exception as e:
            if log_fn:
                log_fn(f"[Comment] Trigger click failed ({used}): {str(e)[:120]}", "warning")

    # Fallback: click any visible button with comment text (DOM + open shadow)
    fallback_clicked = driver.execute_script("""
        function allElements(root) {
            const out = [];
            if (!root || !root.querySelectorAll) return out;
            const stack = [root];
            while (stack.length) {
                const cur = stack.pop();
                const nodes = cur.querySelectorAll('*');
                for (const n of nodes) {
                    out.push(n);
                    if (n.shadowRoot) stack.push(n.shadowRoot);
                }
            }
            return out;
        }
        const nodes = allElements(document);
        for (const el of nodes) {
            if (el.tagName !== 'BUTTON') continue;
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            if (txt.includes('comment') || txt.includes('add a comment') || aria.includes('comment')) {
                try { el.click(); return true; } catch {}
            }
        }
        return false;
    """)
    if fallback_clicked:
        if log_fn:
            log_fn("[Comment] Composer trigger clicked via text fallback", "info")
        time.sleep(random.uniform(1.0, 2.0))
        return True

    if log_fn:
        log_fn("[Comment] Composer trigger not found; continuing in case composer is already open", "warning")
    return False


def _find_comment_input(driver, log_fn=None):
    """Locate a writable top-level comment input element (avoid reply boxes)."""
    # Prefer explicit composer inputs first
    input_selectors = [
        "comment-composer-host faceplate-textarea-input",
        "comment-composer-host [contenteditable='true']",
        "faceplate-textarea-input[data-testid='comment-composer']",
        "div[slot='rte'][contenteditable='true']",
        "div[contenteditable='true'][data-lexical-editor='true']",
        "div[contenteditable='true'][role='textbox']",
        "textarea[name='comment']",
        "textarea[placeholder*='comment' i]",
    ]

    el, used = _first_visible_including_shadow(driver, input_selectors)
    if el:
        if log_fn:
            log_fn(f"[Comment] Found input via selector: {used}", "info")
        return el

    # DOM-first scan: visible editable inputs near comment tree, not inside replies/ads
    candidate = driver.execute_script("""
        function isVisible(el) {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if (el.offsetParent === null && style.position !== 'fixed') return false;
            if (!el.getClientRects().length) return false;
            return true;
        }
        function hasAncestor(el, selector) {
            try {
                return !!el.closest(selector);
            } catch (e) { return false; }
        }
        function nearComments(el) {
            const tree = document.querySelector('shreddit-comment-tree, #comments, .commentarea');
            if (!tree) return true;
            return tree.contains(el) || tree.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
        }
        const candidates = [];
        const all = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
        for (const el of all) {
            if (!isVisible(el)) continue;
            if (hasAncestor(el, 'shreddit-comment, .Comment, .comment, [data-testid="comment"], [data-test-id="comment"]')) continue;
            if (hasAncestor(el, 'shreddit-ad-post, [data-promoted], [promoted], [data-adtype], [data-testid="ad-post"], iframe')) continue;
            if (hasAncestor(el, 'dialog[open], [role="dialog"], [aria-modal="true"], [id*="lightbox"], [class*="lightbox"], .gallery-viewer')) continue;
            if (!nearComments(el)) continue;
            candidates.push(el);
        }
        return candidates.length ? candidates[0] : null;
    """)
    if candidate and log_fn:
        log_fn("[Comment] Found input via DOM scan", "info")
    return candidate


def _resolve_comment_editor(driver, element, log_fn=None):
    if not element:
        return None
    try:
        resolved = driver.execute_script("""
            const host = arguments[0];
            if (!host) return null;

            function findEditable(root) {
                if (!root) return null;
                const selectors = [
                    '[contenteditable="true"]',
                    '[role="textbox"]',
                    'textarea',
                    'input[type="text"]'
                ];
                for (const sel of selectors) {
                    const el = root.querySelector(sel);
                    if (el) return el;
                }
                return null;
            }

            // If host itself is editable, use it
            const ce = (host.getAttribute && host.getAttribute('contenteditable')) || '';
            if (ce.toLowerCase() === 'true' || host.isContentEditable) return host;

            // Try shadow root first
            if (host.shadowRoot) {
                const inner = findEditable(host.shadowRoot);
                if (inner) return inner;
            }

            // Fallback: search descendants in light DOM
            const inner = findEditable(host);
            if (inner) return inner;

            return host;
        """, element)
        if log_fn and resolved and resolved != element:
            log_fn("[Comment] Resolved inner editor inside composer host", "info")
        return resolved or element
    except Exception as e:
        if log_fn:
            log_fn(f"[Comment] Editor resolve failed: {str(e)[:120]}", "warning")
        return element


def _validate_comment_input(driver, element, log_fn=None):
    if not element:
        return False
    try:
        is_reply = driver.execute_script(
            "return !!arguments[0].closest('shreddit-comment, .Comment, .comment, [data-testid=\"comment\"], [data-test-id=\"comment\"], [data-testid=\"comment-body\"]')",
            element
        )
        if is_reply:
            if log_fn:
                log_fn("[Comment] Rejected reply input (not top-level composer)", "warning")
            return False
        is_inside_ad = driver.execute_script("""
            var el = arguments[0];
            var adSelectors = ['shreddit-ad-post', '[data-promoted]', '[promoted]', '[data-adtype]', '[data-testid="ad-post"]', 'iframe'];
            var node = el;
            while (node && node !== document.body) {
                for (var s of adSelectors) {
                    try { if (node.matches && node.matches(s)) return true; } catch(e) {}
                }
                var tagName = (node.tagName || '').toLowerCase();
                if (tagName === 'iframe') return true;
                node = node.parentElement;
            }
            return false;
        """, element)
        if is_inside_ad:
            if log_fn:
                log_fn("[Comment] Rejected input inside ad/promoted container", "warning")
            return False
        is_inside_lightbox = driver.execute_script("""
            var el = arguments[0];
            var lbSelectors = [
                '[id*="lightbox"]', '[class*="lightbox"]', 'dialog[open]', '[role="dialog"]',
                '[data-testid="media-lightbox"]', 'shreddit-overlay-display', '.media-lightbox', '.gallery-viewer', '[aria-modal="true"]'
            ];
            var node = el;
            while (node && node !== document.body) {
                for (var s of lbSelectors) {
                    try { if (node.matches && node.matches(s)) return true; } catch(e) {}
                }
                node = node.parentElement;
            }
            return false;
        """, element)
        if is_inside_lightbox:
            if log_fn:
                log_fn("[Comment] Rejected input inside lightbox/overlay", "warning")
            return False
    except:
        pass
    return True


def _get_top_level_comment_input(driver, log_fn=None, allow_visual=True):
    _open_comment_composer(driver, log_fn)

    content_box = _find_comment_input(driver, log_fn)
    if content_box and _validate_comment_input(driver, content_box, log_fn):
        return content_box

    if allow_visual:
        content_box = _click_comment_via_visual(driver, log_fn)
        if content_box and _validate_comment_input(driver, content_box, log_fn):
            return content_box

    content_box = _find_comment_input(driver, log_fn)
    if content_box and _validate_comment_input(driver, content_box, log_fn):
        return content_box

    _, _, extra_tabs = _detect_page_features(driver, log_fn)
    content_box = _find_comment_input_via_tabbing(driver, log_fn, extra_tabs=extra_tabs)
    if content_box and _validate_comment_input(driver, content_box, log_fn):
        return content_box

    return None


def _focus_comment_input(driver, element, log_fn=None):
    if not element:
        return False
    try:
        target = _resolve_comment_editor(driver, element, log_fn)
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'}); arguments[0].focus();", target)
        return True
    except Exception as e:
        if log_fn:
            log_fn(f"[Comment] Focus failed: {str(e)[:120]}", "warning")
        return False


def _probe_comment_input(driver, element, log_fn=None):
    if not element:
        return False
    try:
        element = _resolve_comment_editor(driver, element, log_fn)
        return driver.execute_script("""
            const el = arguments[0];
            if (!el) return false;
            const isText = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
            if (isText) {
                const prev = el.value || '';
                el.focus();
                el.value = prev + 'a';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.value = prev;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                let target = el;
                const p = el.querySelector('p');
                if (p) target = p;
                const prev = target.textContent || '';
                target.textContent = prev + 'a';
                target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
                target.textContent = prev;
                target.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
                return true;
            }
            return false;
        """, element)
    except Exception as e:
        if log_fn:
            log_fn(f"[Comment] Probe failed: {str(e)[:120]}", "warning")
        return False


def _click_upvote_button(driver, log_fn=None):
    """Click the post upvote button using DOM selectors and verify state."""
    selectors = [
        "button[aria-label*='upvote' i]",
        "button[data-click-id='upvote']",
        "button[voteaction='upvote']",
        "button[icon-name*='upvote' i]",
    ]

    candidates = []
    seen = set()

    # Prefer buttons within the main post container
    try:
        post_root = driver.find_element(By.CSS_SELECTOR, "shreddit-post, [data-testid='post-container'], [data-testid='post-content']")
        for sel in selectors:
            try:
                for btn in post_root.find_elements(By.CSS_SELECTOR, sel):
                    if not btn or not btn.is_displayed():
                        continue
                    if btn.id in seen:
                        continue
                    seen.add(btn.id)
                    candidates.append(btn)
            except:
                pass
    except:
        pass

    if not candidates:
        for sel in selectors:
            try:
                for btn in driver.find_elements(By.CSS_SELECTOR, sel):
                    if not btn or not btn.is_displayed():
                        continue
                    if btn.id in seen:
                        continue
                    seen.add(btn.id)
                    candidates.append(btn)
            except:
                pass

    try:
        candidates.sort(key=lambda b: b.location.get("y", 0))
    except:
        pass

    for btn in candidates:
        try:
            driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", btn)
            time.sleep(0.2)

            aria_pressed = (btn.get_attribute("aria-pressed") or "").lower()
            if aria_pressed == "true":
                if log_fn:
                    log_fn("[Upvote] Post already upvoted — skipping", "info")
                return "already"

            try:
                ActionChains(driver).move_to_element(btn).click().perform()
            except:
                try:
                    driver.execute_script("arguments[0].click();", btn)
                except:
                    pass

            time.sleep(0.3)
            aria_after = (btn.get_attribute("aria-pressed") or "").lower()
            if aria_after == "true":
                return "clicked"

            if aria_after == "":
                if log_fn:
                    log_fn("[Upvote] Clicked upvote button (unable to verify state)", "info")
                return "clicked"
        except:
            continue

    return "not_found"


def _close_media_overlays(driver, log_fn=None):
    try:
        overlay_closed = driver.execute_script("""
            let closed = false;
            const selectors = [
                'button[aria-label="Close"]',
                'button[aria-label="close"]',
                'button[aria-label*="close" i]',
                'button[aria-label*="Close" i]',
                '[data-click-id="close"]',
                '.media-lightbox button',
                'shreddit-overlay-display button'
            ];
            for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetParent !== null) {
                    btn.click();
                    closed = true;
                    break;
                }
            }
            return closed;
        """)
        if overlay_closed and log_fn:
            log_fn("[Upvote] Closed media overlay", "info")
    except Exception as e:
        if log_fn:
            log_fn(f"[Upvote] Overlay close failed: {str(e)[:120]}", "warning")


def _to_old_reddit_url(url):
    try:
        parsed = urlparse(url)
        if parsed.netloc.startswith("old.reddit.com"):
            return url
        return parsed._replace(netloc="old.reddit.com").geturl()
    except Exception:
        return url


def _extract_post_id(url):
    try:
        parsed = urlparse(url)
        parts = [p for p in parsed.path.split('/') if p]
        if 'comments' in parts:
            idx = parts.index('comments')
            if idx + 1 < len(parts):
                return parts[idx + 1]
    except Exception:
        pass
    return None


def _get_csrf_token(driver):
    try:
        token = driver.execute_script("""
            const meta = document.querySelector('meta[name="csrf-token"]');
            if (meta && meta.content) return meta.content;
            try {
                if (window.__r && window.__r.config && window.__r.config.csrfToken) return window.__r.config.csrfToken;
            } catch (e) {}
            try {
                if (window.___r && window.___r.config && window.___r.config.csrfToken) return window.___r.config.csrfToken;
            } catch (e) {}
            return null;
        """)
        return token
    except Exception:
        return None


def _api_vote(driver, post_id, log_fn=None):
    if not post_id:
        return False
    token = _get_csrf_token(driver)
    if not token:
        if log_fn:
            log_fn("[Upvote] CSRF token not found, skipping", "warning")
        return False

    fullname = f"t3_{post_id}"
    try:
        result = driver.execute_script("""
            const token = arguments[0];
            const fullname = arguments[1];
            const body = new URLSearchParams({
                id: fullname,
                dir: '1',
                rank: '1'
            });
            return fetch('https://www.reddit.com/api/vote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-CSRF-Token': token
                },
                body: body.toString(),
                credentials: 'include'
            }).then(r => r.ok).catch(() => false);
        """, token, fullname)
        if log_fn:
            log_fn(f"[Upvote] Vote API called for {fullname}", "info")
        return bool(result)
    except Exception as e:
        if log_fn:
            log_fn(f"[Upvote] Vote API error: {str(e)[:120]}", "warning")
        return False


def _debug_modhash_sources(driver, log_fn=None):
    if not log_fn:
        return
    try:
        info = driver.execute_script("""
            const meta = Array.from(document.querySelectorAll('meta')).map(m => m.getAttribute('name') || m.getAttribute('property') || '').filter(Boolean);
            const keys = [];
            try { if (window.__r) keys.push(...Object.keys(window.__r)); } catch(e) {}
            try { if (window.___r) keys.push(...Object.keys(window.___r)); } catch(e) {}
            const cookieNames = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean);
            return { meta, keys, cookieNames };
        """)
        log_fn(f"[Upvote] Modhash debug — meta: {', '.join(info['meta'][:8])}", "warning")
        log_fn(f"[Upvote] Modhash debug — __r keys: {', '.join(info['keys'][:8])}", "warning")
        log_fn(f"[Upvote] Modhash debug — cookies: {', '.join(info['cookieNames'][:8])}", "warning")
    except Exception as e:
        log_fn(f"[Upvote] Modhash debug failed: {str(e)[:120]}", "warning")


def _get_modhash(driver, account_id, log_fn=None):
    if account_id in session_modhash and session_modhash[account_id]:
        return session_modhash[account_id]
    previous_url = None
    try:
        try:
            previous_url = driver.current_url
        except Exception:
            previous_url = None
        driver.get("https://old.reddit.com")
        time.sleep(random.uniform(2, 4))
        modhash = driver.execute_script("""
            const el = document.querySelector('input[name="uh"]');
            if (el && el.value) return el.value;
            return null;
        """)
        if modhash:
            session_modhash[account_id] = modhash
            if log_fn:
                log_fn("[Upvote] Modhash captured from old Reddit", "info")
            return modhash
        if log_fn:
            log_fn("[Upvote] Modhash not found on old Reddit", "warning")
            _debug_modhash_sources(driver, log_fn)
    except Exception as e:
        if log_fn:
            log_fn(f"[Upvote] Modhash fetch failed: {str(e)[:120]}", "warning")
    finally:
        if previous_url and previous_url != "https://old.reddit.com/":
            try:
                driver.get(previous_url)
            except Exception as restore_err:
                if log_fn:
                    log_fn(f"[Upvote] Failed to restore page after modhash fetch: {str(restore_err)[:120]}", "warning")
    return None


def _api_vote_modhash(driver, modhash, post_id, log_fn=None):
    if not modhash or not post_id:
        return False
    fullname = f"t3_{post_id}"
    try:
        result = driver.execute_script("""
            const modhash = arguments[0];
            const fullname = arguments[1];
            const body = new URLSearchParams({
                id: fullname,
                dir: '1',
                rank: '1',
                uh: modhash
            });
            return fetch('https://old.reddit.com/api/vote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: body.toString(),
                credentials: 'include'
            }).then(r => r.ok).catch(() => false);
        """, modhash, fullname)
        if log_fn:
            log_fn(f"[Upvote] Vote API called for {fullname}", "info")
        return bool(result)
    except Exception as e:
        if log_fn:
            log_fn(f"[Upvote] Vote API error: {str(e)[:120]}", "warning")
        return False


def _api_subscribe_modhash(driver, modhash, subreddit, log_fn=None):
    if not modhash or not subreddit:
        return False
    sub = _normalize_subreddit_name(subreddit)
    try:
        result = driver.execute_script("""
            const modhash = arguments[0];
            const sr = arguments[1];
            const body = new URLSearchParams({
                action: 'sub',
                sr_name: sr,
                uh: modhash
            });
            return fetch('https://old.reddit.com/api/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: body.toString(),
                credentials: 'include'
            }).then(async (r) => ({
                ok: r.ok,
                status: r.status,
                body: await r.text()
            })).catch(() => null);
        """, modhash, sub)
        if not result or not result.get("ok"):
            if log_fn:
                status = result.get("status") if isinstance(result, dict) else "unknown"
                log_fn(f"[Join] Subscribe API returned non-success status for r/{sub}: {status}", "warning")
            return False
        body_text = (result.get("body") or "").strip().lower()
        if body_text and any(term in body_text for term in ["error", "forbidden", "ratelimit", "invalid"]):
            if log_fn:
                log_fn(f"[Join] Subscribe API returned error payload for r/{sub}", "warning")
            return False
        if log_fn:
            log_fn(f"[Join] Subscribe API called for r/{sub}", "info")
        return True
    except Exception as e:
        if log_fn:
            log_fn(f"[Join] Subscribe API error: {str(e)[:120]}", "warning")
        return False


def _api_verify_subscription(driver, subreddit, log_fn=None):
    sub = _normalize_subreddit_name(subreddit)
    if not sub:
        return False
    try:
        data = driver.execute_script("""
            const sr = arguments[0];
            return fetch(`/r/${encodeURIComponent(sr)}/about.json`, {
                method: 'GET',
                credentials: 'include'
            }).then(r => r.json()).catch(() => null);
        """, sub)
        return bool(data and data.get("data", {}).get("user_is_subscriber") is True)
    except Exception as e:
        if log_fn:
            log_fn(f"[Join] Subscription verify failed for r/{sub}: {str(e)[:120]}", "warning")
        return False


def _api_verify_vote(driver, post_id, log_fn=None):
    if not post_id:
        return False
    fullname = f"t3_{post_id}"
    try:
        data = driver.execute_script("""
            const fullname = arguments[0];
            return fetch(`https://www.reddit.com/by_id/${fullname}.json`, {
                method: 'GET',
                credentials: 'include'
            }).then(r => r.json()).catch(() => null);
        """, fullname)
        try:
            likes = data['data']['children'][0]['data']['likes']
            return likes is True
        except Exception:
            return False
    except Exception as e:
        if log_fn:
            log_fn(f"[Upvote] Verify API error: {str(e)[:120]}", "warning")
        return False


def _click_upvote_old_reddit(driver, log_fn=None):
    try:
        if log_fn:
            log_fn("[Upvote] Using old.reddit.com vote controls", "info")
        selectors = ["div.midcol a.up", "div.vote a.up"]
        btn = None
        used = None
        for sel in selectors:
            try:
                el = driver.find_element(By.CSS_SELECTOR, sel)
                if el and el.is_displayed():
                    btn = el
                    used = sel
                    break
            except:
                continue
        if not btn:
            return "not_found"

        # Already upvoted
        try:
            parent = btn.find_element(By.XPATH, "..")
            if parent and "upmod" in (parent.get_attribute("class") or ""):
                if log_fn:
                    log_fn("[Upvote] Post already upvoted — skipping", "info")
                return "already"
        except:
            pass

        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", btn)
        time.sleep(0.2)
        try:
            btn.click()
        except:
            driver.execute_script("arguments[0].click();", btn)

        time.sleep(0.4)
        try:
            parent = btn.find_element(By.XPATH, "..")
            if parent and "upmod" in (parent.get_attribute("class") or ""):
                return "clicked"
        except:
            pass

        return "clicked"
    except Exception as e:
        if log_fn:
            log_fn(f"[Upvote] Old Reddit click failed: {str(e)[:120]}", "warning")
        return "not_found"


def _find_upvote_button_shadow(driver, log_fn=None):
    selectors = [
        "shreddit-post shreddit-vote button[aria-label*='upvote' i]",
        "shreddit-vote button[aria-label*='upvote' i]",
        "button[aria-label*='upvote' i]",
        "button[data-click-id='upvote']",
        "button[voteaction='upvote']",
        "button[icon-name*='upvote' i]",
    ]

    btn = None
    used = None

    for sel in selectors:
        btn = _find_including_shadow(driver, sel)
        if btn:
            used = sel
            break

    if btn and log_fn:
        log_fn(f"[Upvote] Found button via selector: {used}", "info")
    return btn


def _debug_upvote_candidates(driver, log_fn=None):
    if not log_fn:
        return
    try:
        info = driver.execute_script("""
            function allElements(root) {
                const out = [];
                if (!root || !root.querySelectorAll) return out;
                const stack = [root];
                while (stack.length) {
                    const cur = stack.pop();
                    const nodes = cur.querySelectorAll('*');
                    for (const n of nodes) {
                        out.push(n);
                        if (n.shadowRoot) stack.push(n.shadowRoot);
                    }
                }
                return out;
            }
            const light = Array.from(document.querySelectorAll('button[aria-label*="upvote" i]')).length;
            const shadowNodes = allElements(document);
            const shadowBtns = shadowNodes.filter(el => el.tagName === 'BUTTON' && (el.getAttribute('aria-label') || '').toLowerCase().includes('upvote'));
            const samples = shadowBtns.slice(0, 3).map(el => {
                let label = (el.getAttribute('aria-label') || '').slice(0, 80);
                let path = [];
                let node = el;
                for (let i = 0; i < 3 && node; i++) {
                    path.push((node.tagName || '').toLowerCase());
                    node = node.parentElement;
                }
                return { label, path: path.join('>') };
            });
            return { light, shadow: shadowBtns.length, samples };
        """)
        log_fn(f"[Upvote] Debug candidates — light:{info['light']} shadow:{info['shadow']}", "warning")
        if info.get("samples"):
            for s in info["samples"]:
                log_fn(f"[Upvote] Candidate aria-label='{s.get('label','')}' path={s.get('path','')}", "warning")
    except Exception as e:
        log_fn(f"[Upvote] Debug scan failed: {str(e)[:120]}", "warning")


def _click_upvote_button_dom(driver, log_fn=None):
    _close_media_overlays(driver, log_fn)

    btn = _find_upvote_button_shadow(driver, log_fn)
    if not btn:
        return "not_found"

    try:
        aria_pressed = (btn.get_attribute("aria-pressed") or "").lower()
        if aria_pressed == "true":
            if log_fn:
                log_fn("[Upvote] Post already upvoted — skipping", "info")
            return "already"
    except:
        pass

    try:
        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", btn)
        time.sleep(0.2)
        try:
            ActionChains(driver).move_to_element(btn).click().perform()
        except:
            driver.execute_script("arguments[0].click();", btn)
        time.sleep(0.3)
        aria_after = (btn.get_attribute("aria-pressed") or "").lower()
        if aria_after == "true":
            return "clicked"
        if aria_after == "":
            if log_fn:
                log_fn("[Upvote] Clicked upvote button (unable to verify state)", "info")
            return "clicked"
    except Exception as e:
        if log_fn:
            log_fn(f"[Upvote] Click failed: {str(e)[:120]}", "warning")

    return "not_found"

def _click_comment_via_visual(driver, log_fn=None):
    """
    Takes a browser screenshot and uses OpenCV edge/contour detection to
    visually locate the 'Join the conversation' comment input field, then
    clicks it via JavaScript elementFromPoint.

    Returns the focused writable element on success, or None if not found.
    Requires: opencv-python, numpy  (pip install opencv-python numpy)
    """
    try:
        import cv2
        import numpy as np
        from PIL import Image
        import io
    except ImportError:
        if log_fn:
            log_fn("[VisualClick] cv2/numpy/PIL not installed — skipping visual method", "warning")
        return None

    try:
        # Scroll down so the comment box is likely in the viewport
        driver.execute_script("window.scrollBy(0, window.innerHeight * 0.65)")
        time.sleep(0.5)

        # ─ Capture screenshot ───────────────────────────────────────────────
        png_bytes = driver.get_screenshot_as_png()
        img_pil = Image.open(io.BytesIO(png_bytes)).convert("RGB")
        img_np = np.array(img_pil)
        ss_h, ss_w = img_np.shape[:2]

        # HiDPI / Retina scale: screenshot px → viewport px
        vp_w = driver.execute_script("return window.innerWidth")
        vp_h = driver.execute_script("return window.innerHeight")
        sx = vp_w / ss_w
        sy = vp_h / ss_h

        # ─ OpenCV: find the comment box shape ──────────────────────────────
        gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)

        # Only search the lower 2/3 of the page (comment box is below post content)
        roi_top = ss_h // 3
        roi = gray[roi_top:, :]

        # Edge detection: the comment box has a subtle rounded border on a dark bg
        edges = cv2.Canny(roi, 15, 50)

        # Dilate horizontally to bridge gaps in the border line
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (20, 3))
        dilated = cv2.dilate(edges, kernel, iterations=2)

        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        best = None
        for cnt in contours:
            x, y, w, h = cv2.boundingRect(cnt)
            if w < ss_w * 0.30:   # must span at least 30% of page width
                continue
            if h < 15 or h > 250:  # sanity height bounds for an input
                continue
            aspect = w / h
            if aspect < 3:         # must be much wider than tall
                continue
            # Score: prefer widest box, bias toward being higher up (first hit = the input)
            score = w * 2 - y
            if best is None or score > best[0]:
                best = (score, x, y, w, h)

        if not best:
            if log_fn:
                log_fn("[VisualClick] No comment box shape found in screenshot — will use TAB", "warning")
            return None

        _, bx, by, bw, bh = best
        # Centre of the detected box, converted to viewport coords
        px = bx + bw // 2
        py = roi_top + by + bh // 2
        vx = int(px * sx)
        vy = int(py * sy)

        if log_fn:
            log_fn(f"[VisualClick] Comment box detected at screenshot ({px},{py}) → viewport ({vx},{vy})", "info")

        # ─ Click via JS elementFromPoint ─────────────────────────────────
        driver.execute_script(
            "var el = document.elementFromPoint(arguments[0], arguments[1]);"
            "if (el) { el.click(); el.focus(); }",
            vx, vy
        )
        time.sleep(0.5)

        # ─ Verify a writable element is now active ────────────────────────
        try:
            active = driver.switch_to.active_element
            tag  = (active.tag_name or "").lower()
            ce   = (active.get_attribute("contenteditable") or "").lower()
            role = (active.get_attribute("role") or "").lower()
            if tag in ["textarea", "input"] or ce in ["true", "plaintext-only"] or role == "textbox":
                if log_fn:
                    log_fn("[VisualClick] Comment input focused via visual click", "success")
                return active
            else:
                if log_fn:
                    log_fn(f"[VisualClick] Clicked but focused element is <{tag}> (not a text input) — will retry with TAB", "warning")
        except Exception:
            pass

    except Exception as e:
        if log_fn:
            log_fn(f"[VisualClick] Error: {str(e)[:120]}", "error")

    return None


def _detect_page_features(driver, log_fn=None):
    """
    Inspect the currently loaded post page and return how many extra TABs are
    needed to skip past non-comment interactive elements.

    Returns: (has_image, has_ad, extra_tabs)
    """
    has_image = False
    has_ad = False

    try:
        result = driver.execute_script("""
            var hasImage = false;
            var hasAd = false;

            // ── Image / gallery / video post detection ──
            var postEl = document.querySelector('shreddit-post');
            if (postEl) {
                var pt = (postEl.getAttribute('post-type') || '').toLowerCase();
                if (pt === 'image' || pt === 'gallery' || pt === 'video' || pt === 'rich:video') {
                    hasImage = true;
                }
            }
            // Fallback: look for a visible media element inside the post
            if (!hasImage) {
                var mediaSelectors = [
                    'shreddit-post img[src*="preview.redd.it"]',
                    'shreddit-post img[src*="i.redd.it"]',
                    'shreddit-post video',
                    '[data-testid="post-media-container"]',
                    '.media-element'
                ];
                for (var ms of mediaSelectors) {
                    try {
                        var mel = document.querySelector(ms);
                        if (mel && mel.offsetParent !== null) { hasImage = true; break; }
                    } catch(e) {}
                }
            }

            // ── Promoted / ad detection ──
            var adSelectors = [
                'shreddit-ad-post',
                '[data-promoted="true"]',
                '[promoted]',
                '[data-adtype]',
                '[data-testid="ad-post"]'
            ];
            for (var as of adSelectors) {
                try {
                    var ael = document.querySelector(as);
                    if (ael && ael.offsetParent !== null) { hasAd = true; break; }
                } catch(e) {}
            }

            return { hasImage: hasImage, hasAd: hasAd };
        """)
        if result:
            has_image = bool(result.get('hasImage', False))
            has_ad = bool(result.get('hasAd', False))
    except Exception as e:
        if log_fn:
            log_fn(f"[Comment] Page feature detection error: {e}", "warning")

    # Base tab extras: image posts have more focusable media controls before comments;
    # ads inject many focusable widgets into the page.
    extra = 0
    parts = []
    if has_image:
        extra += 12   # skip image viewer controls
        parts.append("image/media post")
    if has_ad:
        extra += 10   # skip ad interactive elements
        parts.append("promoted ad")

    if log_fn:
        if parts:
            log_fn(f"[Comment] Detected on page: {', '.join(parts)} — adding {extra} extra TABs (total budget: {40 + extra})", "info")
        else:
            log_fn("[Comment] Page features: plain text post, no ads detected", "info")

    return has_image, has_ad, extra


def _find_comment_input_via_tabbing(driver, log_fn=None, extra_tabs=0):
    """Fallback method: Locate a writable comment input element via keyboard tabbing."""
    if log_fn:
        log_fn("[Comment] DOM selectors failed. Attempting keyboard TAB traversal...", "warning")

    actions = ActionChains(driver)

    # ── Step 0: Close any open lightbox / image modal before tabbing ──────────
    def _dismiss_lightbox():
        """Press Escape and navigate back if a lightbox is open."""
        try:
            url = driver.current_url
            if '#lightbox' in url or '#media' in url:
                if log_fn:
                    log_fn("[Comment] Lightbox detected in URL — pressing Escape to close it", "warning")
                actions.send_keys(Keys.ESCAPE).perform()
                time.sleep(0.5)
                # Navigate back to the clean post URL (strip the fragment)
                clean_url = url.split('#')[0]
                driver.get(clean_url)
                time.sleep(2)
                return True
        except:
            pass
        # Also check for visible overlay/dialog elements
        try:
            lightbox_open = driver.execute_script("""
                var overlaySelectors = [
                    '[id*="lightbox"]', '[class*="lightbox"]',
                    'dialog[open]', '[role="dialog"]',
                    '[data-testid="media-lightbox"]',
                    'shreddit-overlay-display',
                    '.media-lightbox', '.gallery-viewer'
                ];
                for (var s of overlaySelectors) {
                    try {
                        var el = document.querySelector(s);
                        if (el && el.offsetParent !== null) return true;
                    } catch(e) {}
                }
                return false;
            """)
            if lightbox_open:
                if log_fn:
                    log_fn("[Comment] Overlay/lightbox detected in DOM — pressing Escape", "warning")
                actions.send_keys(Keys.ESCAPE).perform()
                time.sleep(0.8)
                return True
        except:
            pass
        return False

    _dismiss_lightbox()

    # Give focus to the page body first
    try:
        driver.find_element(By.TAG_NAME, 'body').click()
    except:
        pass

    # Anchor focus near the post title so we start from a known position
    try:
        title = driver.find_element(By.CSS_SELECTOR, "h1, [data-testid='post-title']")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", title)
        title.click()
    except:
        pass

    for i in range(40 + extra_tabs):
        actions.send_keys(Keys.TAB).perform()
        time.sleep(0.12)

        try:
            active = driver.switch_to.active_element
            if not active: continue
            
            tag = (active.tag_name or "").lower()
            if not tag: continue

            content_editable = (active.get_attribute("contenteditable") or "").lower()
            role = (active.get_attribute("role") or "").lower()
            aria_label = (active.get_attribute("aria-label") or "").lower()
            placeholder = (active.get_attribute("placeholder") or "").lower()

            if (tag in ['textarea', 'input'] and active.get_attribute("type") != "hidden") or \
               content_editable in ['true', 'plaintext-only'] or \
               role == 'textbox':
                
                # Skip search/nav inputs
                if "search" in aria_label or active.get_attribute("name") == "q":
                    continue

                # Skip inputs with non-comment placeholders (ads, emails, etc.)
                non_comment_hints = ["search", "email", "download", "subscribe", "your name", "zip", "phone"]
                if any(hint in placeholder for hint in non_comment_hints):
                    if log_fn:
                        log_fn(f"[Comment] Skipping input — placeholder looks like an ad/form: '{placeholder[:60]}'", "warning")
                    continue

                # Skip if this element lives inside a promoted/ad container
                is_inside_ad = driver.execute_script("""
                    var el = arguments[0];
                    var adSelectors = [
                        'shreddit-ad-post',
                        '[data-promoted]',
                        '[promoted]',
                        '[data-adtype]',
                        '[data-testid="ad-post"]',
                        '.promotedlink',
                        '[aria-label*="promoted" i]',
                        '[aria-label*="advertisement" i]',
                        'iframe'
                    ];
                    var node = el;
                    while (node && node !== document.body) {
                        for (var s of adSelectors) {
                            try {
                                if (node.matches && node.matches(s)) return true;
                            } catch(e) {}
                        }
                        var tagName = (node.tagName || '').toLowerCase();
                        var aria = (node.getAttribute && node.getAttribute('aria-label') || '').toLowerCase();
                        if (tagName === 'iframe') return true;
                        if (aria.includes('promoted') || aria.includes('advertisement') || aria.includes('sponsor')) return true;
                        node = node.parentElement;
                    }
                    return false;
                """, active)

                if is_inside_ad:
                    if log_fn:
                        log_fn(f"[Comment] Skipping input inside promoted/ad container (tab {i+1})", "warning")
                    continue

                # Skip if this element lives inside a lightbox / image viewer
                is_inside_lightbox = driver.execute_script("""
                    var el = arguments[0];
                    var lbSelectors = [
                        '[id*="lightbox"]', '[class*="lightbox"]',
                        'dialog[open]', '[role="dialog"]',
                        '[data-testid="media-lightbox"]',
                        'shreddit-overlay-display',
                        '.media-lightbox', '.gallery-viewer',
                        '[aria-modal="true"]'
                    ];
                    var node = el;
                    while (node && node !== document.body) {
                        for (var s of lbSelectors) {
                            try {
                                if (node.matches && node.matches(s)) return true;
                            } catch(e) {}
                        }
                        var id = (node.id || '').toLowerCase();
                        var cls = (node.className || '').toLowerCase();
                        if (id.includes('lightbox') || cls.includes('lightbox') ||
                            id.includes('overlay') || cls.includes('overlay') ||
                            id.includes('gallery') || cls.includes('gallery')) return true;
                        node = node.parentElement;
                    }
                    return false;
                """, active)

                if is_inside_lightbox:
                    if log_fn:
                        log_fn(f"[Comment] Focus trapped in lightbox (tab {i+1}) — pressing Escape to close", "warning")
                    actions.send_keys(Keys.ESCAPE).perform()
                    time.sleep(0.6)
                    # Re-anchor to title and keep searching
                    try:
                        title = driver.find_element(By.CSS_SELECTOR, "h1, [data-testid='post-title']")
                        title.click()
                    except:
                        pass
                    continue

                if log_fn:
                    log_fn(f"[Comment] Found writable input via TAB ({i+1} tabs)", "success")
                return active
                
            text = (active.text or "").lower()
            if tag == "button" and ("add a comment" in text or "reply" in text or "comment" in aria_label):
                if log_fn:
                    log_fn(f"[Comment] Found composer trigger via TAB. Pressing ENTER...", "info")
                active.send_keys(Keys.ENTER)
                time.sleep(1.0)
                new_active = driver.switch_to.active_element
                if new_active:
                    new_tag = (new_active.tag_name or "").lower()
                    new_ce = (new_active.get_attribute("contenteditable") or "").lower()
                    if new_tag in ['textarea', 'input'] or new_ce in ['true', 'plaintext-only']:
                        if log_fn: log_fn("[Comment] Opened via TAB and auto-focused composer", "success")
                        return new_active
        except:
            pass


    return None


def _find_upvote_via_tabbing(driver, log_fn=None):
    """Locate and click the upvote button on a post page via keyboard TAB traversal."""
    if log_fn:
        log_fn("[Upvote] Attempting TAB traversal to find upvote button...", "info")

    # Give focus to the page first
    try:
        driver.find_element(By.TAG_NAME, 'body').click()
    except:
        pass

    # Anchor focus near the top of the post (title area)
    try:
        title = driver.find_element(By.CSS_SELECTOR, "h1, [data-testid='post-title'], shreddit-post")
        driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'center'});", title)
        title.click()
    except:
        pass

    actions = ActionChains(driver)

    for i in range(6):  # allow extra tabs for UI variations
        actions.send_keys(Keys.TAB).perform()
        time.sleep(0.1)

        try:
            active = driver.switch_to.active_element
            if not active:
                continue

            tag = (active.tag_name or "").lower()
            aria_label = (active.get_attribute("aria-label") or "").lower()
            vote_action = (active.get_attribute("voteaction") or "").lower()
            data_click  = (active.get_attribute("data-click-id") or "").lower()
            icon_name   = (active.get_attribute("icon-name") or "").lower()
            text        = (active.text or active.get_attribute("innerText") or "").strip().lower()

            is_upvote = (
                "upvote" in aria_label
                or vote_action == "upvote"
                or data_click == "upvote"
                or "upvote" in icon_name
                or text == "upvote"
            )

            if tag == "button" and is_upvote:
                aria_pressed = (active.get_attribute("aria-pressed") or "").lower()
                if aria_pressed == "true":
                    if log_fn:
                        log_fn("[Upvote] Post already upvoted — skipping", "info")
                    return "already"
                if log_fn:
                    log_fn(f"[Upvote] Found upvote button via TAB ({i+1} tabs), aria-label='{aria_label}' — pressing SPACE", "success")
                try:
                    # Strategy 1: send SPACE to whatever is currently focused (most reliable)
                    ActionChains(driver).send_keys(Keys.SPACE).perform()
                except:
                    pass
                time.sleep(0.3)
                try:
                    # Strategy 2: JS click directly on the element reference
                    driver.execute_script("arguments[0].click();", active)
                except:
                    pass
                time.sleep(0.3)
                try:
                    # Strategy 3: dispatch a real click event
                    driver.execute_script("arguments[0].dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));", active)
                except:
                    pass
                return "clicked"

        except:
            pass

    if log_fn:
        log_fn("[Upvote] Could not find upvote button via TAB traversal", "warning")
    return "not_found"


def _inject_comment_text(driver, element, text):
    """Insert text with events so React/Lexical state updates reliably."""
    element = _resolve_comment_editor(driver, element)
    return driver.execute_script("""
        const el = arguments[0];
        const text = arguments[1];
        if (!el) return false;
        try {
            el.focus();
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }

            if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
                try {
                    document.execCommand('insertText', false, text);
                } catch (e) {}

                let target = el;
                const p = el.querySelector('p');
                if (p) target = p;

                target.textContent = '';
                target.dispatchEvent(new InputEvent('beforeinput', {
                    inputType: 'insertText',
                    data: text,
                    bubbles: true,
                    composed: true
                }));
                target.textContent = text;
                target.dispatchEvent(new InputEvent('input', {
                    inputType: 'insertText',
                    data: text,
                    bubbles: true,
                    composed: true
                }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
        } catch (e) {}
        return false;
    """, element, text)


def _find_comment_submit(driver, require_comment=True):
    """Locate a submit button for comment composer (avoid reply buttons)."""
    selectors = [
        "button[slot='submit-button'][type='submit']",
        "button[slot='submit-button']",
        "button[type='submit'][aria-label*='comment' i]",
        "shreddit-composer button[type='submit']",
        "faceplate-form button[type='submit']",
        "comment-composer-host button[type='submit']",
    ]
    def is_comment_button(btn):
        try:
            text = (btn.text or btn.get_attribute("innerText") or "").strip().lower()
            aria = (btn.get_attribute("aria-label") or "").strip().lower()
            if "reply" in text or "reply" in aria:
                return False
            if "comment" in text or "comment" in aria:
                return True
            if "post" in text or "post" in aria:
                return True
            return not require_comment
        except:
            return not require_comment

    el, _ = _first_visible_including_shadow(driver, selectors)
    if el and is_comment_button(el):
        return el

    return driver.execute_script("""
        function allElements(root) {
            const out = [];
            if (!root || !root.querySelectorAll) return out;
            const stack = [root];
            while (stack.length) {
                const cur = stack.pop();
                const nodes = cur.querySelectorAll('*');
                for (const n of nodes) {
                    out.push(n);
                    if (n.shadowRoot) stack.push(n.shadowRoot);
                }
            }
            return out;
        }
        const nodes = allElements(document);
        for (const el of nodes) {
            if (el.tagName !== 'BUTTON') continue;
            const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            if (txt.includes('reply') || aria.includes('reply')) continue;
            if (txt === 'comment' || txt.includes('post comment') || txt === 'post' || aria.includes('comment') || aria.includes('post')) return el;
        }
        return null;
    """)


def _cleanup_job_tabs(driver, log_fn=None):
    try:
        handles = driver.window_handles
        if not handles:
            return
        if len(handles) > 1:
            current = driver.current_window_handle
            try:
                driver.close()
            except Exception as e:
                if log_fn:
                    log_fn(f"[Browser] Failed to close tab: {str(e)[:120]}", "warning")
            # Switch to a remaining tab
            remaining = [h for h in driver.window_handles if h != current]
            if remaining:
                driver.switch_to.window(remaining[0])
        else:
            try:
                driver.get("about:blank")
            except Exception as e:
                if log_fn:
                    log_fn(f"[Browser] Failed to reset tab: {str(e)[:120]}", "warning")
    except Exception as e:
        if log_fn:
            log_fn(f"[Browser] Tab cleanup failed: {str(e)[:120]}", "warning")


def run_job(account_id, job_type, params):
    """Run a job for an account, reusing or starting a browser session."""
    from models import db, Account, Setting
    from app import app as flask_app, add_log

    with flask_app.app_context():
        account = db.session.get(Account, account_id)
        if not account:
            raise Exception("Account not found")
        try:
            db.session.refresh(account)
        except Exception as refresh_err:
            print(f"[account:{account_id}] Refresh failed: {str(refresh_err)[:200]}")

        def log_fn(msg, level="info"):
            add_log(f"[{account.username}] {msg}", level, account_id)

        proxy_to_use = account.proxy
        if account.assigned_proxy:
            proxy_to_use = account.assigned_proxy.address

        driver, new_cookies = _ensure_logged_in(
            account_id, account.username, account.password,
            proxy_to_use, account.cookies_json
        )

        if driver is None:
            log_fn(f"Login failed: {new_cookies}", "error")
            raise Exception(new_cookies or "Could not start browser session")

        if new_cookies:
            account.cookies_json = new_cookies
            db.session.commit()
            log_fn("Session cookies saved", "info")

        # ── Dispatch ────────────────────────────────────────────────────────
        try:
            if job_type == "search":
                provided_keyword = params.get("keyword", "").strip()
                sort_filter = params.get("sort_filter", "hot")
                used_interest_keyword = False
                interests_list = []

                if provided_keyword:
                    keyword = provided_keyword
                    log_fn(f"[Search] Searching for: {keyword} (sort: {sort_filter})", "info")
                else:
                    keyword, interests_list = _get_interest_keyword(account, log_fn)
                    used_interest_keyword = True
                    log_fn(f"[Search] Searching for: {keyword} (sort: {sort_filter})", "info")

                posts = _search_posts_with_fallback(driver, keyword, sort_filter, log_fn)
                log_fn(f"[Search] Found {len(posts)} results", "success")
                if used_interest_keyword and len(posts) > 0:
                    _rotate_interests(account, interests_list, log_fn)
                return {"message": f"Found {len(posts)} results", "results": [{"title": p["title"], "url": p["url"]} for p in posts]}

            elif job_type == "search_and_interact":
                sort_filter = params.get("sort_filter", "hot")
                claude_api_key_setting = Setting.query.filter_by(key='claude_api_key').first()
                claude_model_setting = Setting.query.filter_by(key='claude_model_comment').first()

                api_key = claude_api_key_setting.value if claude_api_key_setting else ""
                model = claude_model_setting.value if claude_model_setting and claude_model_setting.value else "claude-sonnet-4-20250514"
                personality = account.personality or ""
                like_after_comment = bool(params.get("like_after_comment"))

                num_posts_to_interact = _safe_int(params.get("interact_count", 3), 3, min_value=1, max_value=20)

                used_interest_keyword = False
                interests_list = []
                like_success = 0
                like_already = 0
                like_failed = 0
                target_post_url = (params.get("target_post_url") or "").strip()
                target_post_title = (params.get("target_post_title") or "Approved draft post").strip()
                approved_comment = (params.get("approved_comment") or "").strip()
                max_words = _safe_int(params.get("max_words", 15) or 15, 15, min_value=8, max_value=80)
                max_sentences = _safe_int(params.get("max_sentences", 1) or 1, 1, min_value=1, max_value=3)

                if not api_key and not approved_comment:
                    raise Exception("Claude API key not configured.")
                if not personality:
                    log_fn("[Search & Interact] No personality set, falling back to general helpful human persona.", "warning")
                    personality = "You are a helpful and organic human user on Reddit. You provide friendly and insightful comments."

                modhash = None
                if like_after_comment:
                    modhash = _get_modhash(driver, account_id, log_fn)
                    if not modhash:
                        log_fn("[Search & Interact] Modhash missing — disabling auto-like", "warning")
                        like_after_comment = False

                from models import CommentedPost

                if target_post_url:
                    target_post_url = _validate_reddit_post_url(target_post_url)
                    if has_account_commented_post(account_id, target_post_url):
                        message = f"Account already commented on target post: {target_post_url}"
                        log_fn(f"[Search & Interact] {message}", "warning")
                        return {
                            "message": message,
                            "success": False,
                            "skipped": True,
                            "reason": "duplicate_target_post",
                            "post_url": normalize_commented_post_url(target_post_url),
                        }
                    keyword = (params.get("keyword") or "brand review").strip() or "brand review"
                    available_posts = [{"title": target_post_title or target_post_url, "url": target_post_url}]
                    log_fn(f"[Search & Interact] Using approved target post: {target_post_url}", "info")
                else:
                    provided_keyword = params.get("keyword", "").strip()
                    if provided_keyword:
                        keyword = provided_keyword
                        log_fn(f"[Search & Interact] Using provided keyword: '{keyword}'", "info")
                    else:
                        keyword, interests_list = _get_interest_keyword(account, log_fn)
                        used_interest_keyword = True

                    log_fn(f"[Search & Interact] Starting workflow with keyword: '{keyword}'", "info")
                    posts = _search_posts_with_fallback(driver, keyword, sort_filter, log_fn)
                    if not posts:
                        raise Exception(f"No posts found for keyword: {keyword}")

                    already_commented = get_account_commented_post_urls(account_id)
                    available_posts = [p for p in posts if normalize_commented_post_url(p.get('url', '')) not in already_commented]

                    if not available_posts:
                        log_fn("[Search & Interact] No new posts found, re-searching once...", "warning")
                        posts = _search_posts_with_fallback(driver, keyword, sort_filter, log_fn)
                        available_posts = [p for p in posts if normalize_commented_post_url(p.get('url', '')) not in already_commented]
                        if not available_posts:
                            raise Exception("All found posts were already commented on.")

                requested_count = num_posts_to_interact
                num_posts_to_interact = min(num_posts_to_interact, len(available_posts))
                if num_posts_to_interact < requested_count:
                    log_fn(f"[Search & Interact] Only {num_posts_to_interact}/{requested_count} posts available to comment.", "warning")
                log_fn(f"[Search & Interact] Will interact with {num_posts_to_interact}/{requested_count} posts.", "info")

                interacted_count = 0
                interacted_posts = []
                for i in range(num_posts_to_interact):
                    chosen_post = available_posts[i]
                    claimed_post_url = ""
                    log_fn(f"[Search & Interact] [{i+1}/{num_posts_to_interact}] Navigating to: {chosen_post['title'][:50]}...", "info")
                    try:
                        chosen_post_url = _validate_reddit_post_url(chosen_post.get('url', ''))
                        chosen_post['url'] = chosen_post_url
                        if has_account_commented_post(account_id, chosen_post_url):
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Post already exists in comment history, skipping.", "warning")
                            continue
                        claim_acquired, claimed_post_url = try_acquire_comment_claim(account_id, chosen_post_url)
                        if not claim_acquired:
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Another job is already commenting on this post, skipping.", "warning")
                            continue
                        driver.get(chosen_post_url)
                        time.sleep(random.uniform(3, 5))
                        driver.execute_script("window.scrollBy(0, 400);")
                        time.sleep(random.uniform(2, 4))

                        pre_url = driver.current_url.split('#')[0].rstrip('/')
                        has_image, has_ad, _ = _detect_page_features(driver, log_fn)
                        allow_visual = not (has_image or has_ad)
                        if not allow_visual and log_fn:
                            log_fn("[Comment] Media/ads detected — disabling visual click", "info")

                        content_box = _get_top_level_comment_input(driver, log_fn, allow_visual=allow_visual)
                        if not content_box:
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Could not find comment box, skipping.", "warning")
                            continue

                        if not _focus_comment_input(driver, content_box, log_fn):
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Could not focus comment box, skipping.", "warning")
                            continue

                        if driver.current_url.split('#')[0].rstrip('/') != pre_url:
                            log_fn("[Comment] Navigation detected after focus — recovering", "warning")
                            driver.get(pre_url)
                            time.sleep(random.uniform(2, 4))
                            content_box = _get_top_level_comment_input(driver, log_fn, allow_visual=allow_visual)
                            if not content_box or not _focus_comment_input(driver, content_box, log_fn):
                                log_fn("[Comment] Recovery failed, skipping post", "warning")
                                continue

                        if not _probe_comment_input(driver, content_box, log_fn):
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Comment input probe failed, skipping.", "warning")
                            continue

                        if driver.current_url.split('#')[0].rstrip('/') != pre_url:
                            log_fn("[Comment] Navigation detected after probe — recovering", "warning")
                            driver.get(pre_url)
                            time.sleep(random.uniform(2, 4))
                            content_box = _get_top_level_comment_input(driver, log_fn, allow_visual=allow_visual)
                            if not content_box or not _focus_comment_input(driver, content_box, log_fn):
                                log_fn("[Comment] Recovery failed after probe, skipping post", "warning")
                                continue

                        post_body = _scrape_post_body(driver)
                        extra_context = params.get("comment_text", "")

                        if approved_comment:
                            comment_text = approved_comment
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Using approved comment text.", "info")
                        else:
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Generating comment...", "info")
                            comment_text = _ai_generate_comment(
                                chosen_post['title'], post_body, keyword, personality, api_key, model,
                                extra_context, log_fn, max_words=max_words, max_sentences=max_sentences
                            )
                            if not comment_text:
                                continue

                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'}); arguments[0].focus();", content_box)
                        time.sleep(0.5)
                        typed = False
                        try:
                            _type_like_human(driver, content_box, comment_text)
                            typed = bool(_get_editor_text(driver, content_box))
                        except Exception as type_err:
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Human typing fallback failed: {str(type_err)[:120]}", "warning")
                            typed = False
                        if not typed:
                            typed = bool(_inject_comment_text(driver, content_box, comment_text))
                            if typed:
                                typed = bool(_get_editor_text(driver, content_box))

                        if not typed:
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Could not insert comment text, skipping.", "warning")
                            continue

                        time.sleep(1)
                        submit_btn = None
                        for _ in range(8):
                            submit_btn = _find_comment_submit(driver, require_comment=True)
                            if submit_btn:
                                break
                            time.sleep(0.5)

                        if submit_btn:
                            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", submit_btn)
                            time.sleep(0.5)
                            driver.execute_script("arguments[0].click();", submit_btn)
                            time.sleep(3)

                            record = CommentedPost(account_id=account_id, post_url=normalize_commented_post_url(chosen_post['url']), post_title=chosen_post.get('title', '')[:200])
                            db.session.add(record)
                            db.session.commit()
                            interacted_count += 1
                            interacted_posts.append({
                                "title": chosen_post.get('title', ''),
                                "url": normalize_commented_post_url(chosen_post['url'])
                            })
                            log_fn(f"[{i+1}/{num_posts_to_interact}] Comment submitted successfully.", "success")

                            if like_after_comment and modhash:
                                post_id = _extract_post_id(chosen_post.get('url', ''))
                                if post_id:
                                    if _api_verify_vote(driver, post_id, log_fn):
                                        like_already += 1
                                        log_fn(f"[{i+1}/{num_posts_to_interact}] Already liked this post", "info")
                                    else:
                                        ok = _api_vote_modhash(driver, modhash, post_id, log_fn)
                                        if ok and _api_verify_vote(driver, post_id, log_fn):
                                            like_success += 1
                                            log_fn(f"[{i+1}/{num_posts_to_interact}] Liked post after comment", "success")
                                        else:
                                            like_failed += 1
                                            log_fn(f"[{i+1}/{num_posts_to_interact}] Failed to like post", "warning")

                            cooldown = random.randint(5, 10)
                            log_fn(f"[Search & Interact] Cooling down for {cooldown}s...", "info")
                            time.sleep(cooldown)
                    except Exception as e:
                        log_fn(f"[{i+1}/{num_posts_to_interact}] Error during interaction: {str(e)[:100]}", "warning")
                    finally:
                        if claimed_post_url:
                            release_comment_claim(account_id, claimed_post_url)

                if interacted_count == 0:
                    raise Exception("Could not successfully interact with any posts in this job.")

                if used_interest_keyword and interacted_count > 0:
                    _rotate_interests(account, interests_list, log_fn)

                result = {"message": f"Successfully interacted with {interacted_count}/{requested_count} target posts.", "success": True}
                result["interacted_posts"] = interacted_posts
                result["post_urls"] = [item["url"] for item in interacted_posts]
                if like_after_comment:
                    result["liked"] = like_success
                    result["already_liked"] = like_already
                    result["like_failed"] = like_failed
                    result["message"] += f" (liked {like_success}, already {like_already}, failed {like_failed})"
                if interacted_count < requested_count:
                    result["warning"] = f"Only interacted with {interacted_count}/{requested_count} posts. Some posts were unavailable or not commentable."
                    log_fn(result["warning"], "warning")
                return result

            elif job_type == "join_subreddit":
                subreddits = params.get("subreddits", [])
                keyword = (params.get("keyword") or "").strip()
                join_count = _safe_int(params.get("join_count", 1), 1, min_value=1, max_value=20)
                targets = []

                if subreddits:
                    targets = subreddits
                else:
                    keywords = [keyword] if keyword else _parse_interests(account.interests)
                    if not keywords:
                        raise Exception("No interests or keyword provided for subreddit discovery")

                    seen = set()
                    for kw in keywords:
                        results = search_subreddits_by_interest(kw, limit=join_count)
                        for name in results:
                            key = name.lower()
                            if key in seen:
                                continue
                            seen.add(key)
                            targets.append(name)
                            if len(targets) >= join_count:
                                break
                        if len(targets) >= join_count:
                            break

                if not targets:
                    raise Exception("No subreddits found to join")

                joined = []
                joined_count = 0
                already_count = 0
                failed_count = 0

                seen = set()
                for sub in targets:
                    normalized_sub = _normalize_subreddit_name(sub)
                    if not normalized_sub:
                        failed_count += 1
                        joined.append({"subreddit": (sub or ""), "status": "failed"})
                        log_fn("[Join] Invalid subreddit name in request; skipping", "warning")
                        continue
                    key = normalized_sub.lower()
                    if key in seen:
                        joined.append({"subreddit": normalized_sub, "status": "duplicate"})
                        log_fn(f"[Join] Duplicate target skipped: r/{normalized_sub}", "info")
                        continue
                    seen.add(key)

                    log_fn(f"[Join] Processing r/{normalized_sub}", "info")
                    status = do_join_subreddit(driver, normalized_sub, log_fn)
                    joined.append({"subreddit": normalized_sub, "status": status})
                    if status == "joined":
                        joined_count += 1
                        log_fn(f"[Join] Joined r/{normalized_sub}", "success")
                    elif status == "already":
                        already_count += 1
                        log_fn(f"[Join] Already subscribed to r/{normalized_sub}", "info")
                    else:
                        failed_count += 1
                        log_fn(f"[Join] Failed to join r/{normalized_sub}", "warning")
                    time.sleep(random.uniform(1, 2))

                return {
                    "message": f"Processed {len(joined)} subreddits (joined {joined_count}, already {already_count}, failed {failed_count})",
                    "results": joined,
                    "joined": joined_count,
                    "already_joined": already_count,
                    "failed": failed_count
                }

            elif job_type == "upvote":
                provided_keyword = params.get("keyword", "").strip()
                sort_filter = params.get("sort_filter", "hot")
                upvote_count = _safe_int(params.get("upvote_count", 3), 3, min_value=1, max_value=20)
                used_interest_keyword = False
                interests_list = []

                if provided_keyword:
                    keyword = provided_keyword
                    log_fn(f"[Upvote] Searching for: {keyword} (sort: {sort_filter})", "info")
                else:
                    keyword, interests_list = _get_interest_keyword(account, log_fn)
                    used_interest_keyword = True
                    log_fn(f"[Upvote] Searching for: {keyword} (sort: {sort_filter})", "info")

                posts = _search_posts_with_fallback(driver, keyword, sort_filter, log_fn)

                if not posts:
                    log_fn("[Upvote] No posts found", "error")
                    raise Exception("No posts found for keyword: " + keyword)

                modhash = _get_modhash(driver, account_id, log_fn)
                if not modhash:
                    log_fn("[Upvote] Modhash missing, skipping upvotes", "warning")
                    return {"message": "Upvoted 0 posts", "success": True, "upvoted": 0}

                upvoted = 0
                already_upvoted = 0
                failed_upvotes = 0
                for i, post in enumerate(posts[:upvote_count]):
                    try:
                        log_fn(f"[Upvote] Opening post {i+1}/{upvote_count}: {post['title'][:60]}", "info")
                        driver.get(post['url'])
                        time.sleep(random.uniform(2, 4))

                        driver.execute_script("window.scrollBy(0, 300);")
                        time.sleep(random.uniform(1, 2))

                        post_id = _extract_post_id(post['url'])
                        if not post_id:
                            log_fn(f"[Upvote] Could not extract post id for {post['url']}", "warning")
                            continue

                        if _api_verify_vote(driver, post_id, log_fn):
                            status = "already"
                        else:
                            ok = _api_vote_modhash(driver, modhash, post_id, log_fn)
                            if not ok:
                                log_fn("[Upvote] Vote API failed, refreshing once and retrying...", "warning")
                                driver.refresh()
                                time.sleep(random.uniform(2, 4))
                                ok = _api_vote_modhash(driver, modhash, post_id, log_fn)

                            if ok:
                                verified = _api_verify_vote(driver, post_id, log_fn)
                                status = "clicked" if verified else "not_found"
                            else:
                                status = "not_found"

                        if status == "clicked":
                            upvoted += 1
                            log_fn(f"[Upvote] Upvoted: {post['title'][:60]}", "success")
                        elif status == "already":
                            already_upvoted += 1
                            log_fn(f"[Upvote] Already upvoted, skipping: {post['title'][:60]}", "info")
                        else:
                            failed_upvotes += 1
                            log_fn(f"[Upvote] Could not upvote post #{i+1} — button not found", "warning")

                        time.sleep(random.uniform(2, 5))
                    except Exception as e:
                        failed_upvotes += 1
                        log_fn(f"[Upvote] Error on post #{i+1}: {str(e)[:100]}", "warning")

                log_fn(f"[Upvote] Summary — upvoted {upvoted}, already {already_upvoted}, failed {failed_upvotes}", "info")
                log_fn(f"[Upvote] Done! Upvoted {upvoted}/{upvote_count} posts", "success")
                if used_interest_keyword and (upvoted > 0 or already_upvoted > 0):
                    _rotate_interests(account, interests_list, log_fn)
                    if already_upvoted > 0 and upvoted == 0:
                        log_fn("[Keyword] Rotated interests after already-upvoted post", "info")
                elif used_interest_keyword:
                    log_fn("[Keyword] No new upvotes; interests not rotated", "info")
                return {
                    "message": f"Upvoted {upvoted} posts (already {already_upvoted}, failed {failed_upvotes})",
                    "success": True,
                    "upvoted": upvoted,
                    "already_upvoted": already_upvoted,
                    "failed": failed_upvotes
                }

            elif job_type == "comment":
                extra_context = params.get("comment_text", "")
                sort_filter = params.get("sort_filter", "hot")

                claude_api_key_setting = Setting.query.filter_by(key='claude_api_key').first()
                claude_model_setting = Setting.query.filter_by(key='claude_model_comment').first()

                api_key = claude_api_key_setting.value if claude_api_key_setting else ""
                model = claude_model_setting.value if claude_model_setting and claude_model_setting.value else "claude-sonnet-4-20250514"
                personality = account.personality or ""

                num_posts_to_interact = _safe_int(params.get("interact_count", 3), 3, min_value=1, max_value=20)

                used_interest_keyword = False
                interests_list = []

                if not api_key:
                    raise Exception("Claude API key not configured. Go to AI Settings.")
                if not personality:
                    log_fn("[Comment] No personality set, falling back to general helpful human persona.", "warning")
                    personality = "You are a helpful and organic human user on Reddit. You provide friendly and insightful comments."

                from models import CommentedPost

                provided_keyword = params.get("keyword", "").strip()
                if provided_keyword:
                    keyword = provided_keyword
                    log_fn(f"[Comment] Using provided keyword: '{keyword}'", "info")
                else:
                    keyword, interests_list = _get_interest_keyword(account, log_fn)
                    used_interest_keyword = True

                log_fn(f"[Comment] Starting comment job — generated keyword: '{keyword}' (sort: {sort_filter})", "info")

                posts = _search_posts_with_fallback(driver, keyword, sort_filter, log_fn)

                if not posts:
                    log_fn("[Comment] No posts found in search results", "error")
                    raise Exception("No posts found for keyword: " + keyword)

                log_fn(f"[Comment] Found {len(posts)} posts, asking AI to pick one...", "info")

                already_commented = get_account_commented_post_urls(account_id)
                before = len(posts)
                posts = [
                    p for p in posts
                    if normalize_commented_post_url(p.get('url', '')) not in already_commented
                ]
                skipped = before - len(posts)
                if skipped:
                    log_fn(f"[Comment] Skipped {skipped} already-commented post(s)", "info")
                if not posts:
                    log_fn("[Comment] All found posts were already commented on — nothing to do", "warning")
                    raise Exception("All matching posts have already been commented on by this agent.")

                tried_urls = set()
                retried_search = False
                requested_count = num_posts_to_interact
                max_attempts = max(requested_count + 3, 6)
                interacted_count = 0

                log_fn(f"[Comment] Will try to comment on {requested_count} posts.", "info")

                for attempt in range(max_attempts):
                    if interacted_count >= requested_count:
                        break

                    available_posts = [p for p in posts if p.get("url") and p["url"] not in tried_urls]

                    if not available_posts:
                        if not retried_search:
                            retried_search = True
                            log_fn("[Comment] No suitable posts found, re-searching once...", "warning")
                            posts = _search_posts_with_fallback(driver, keyword, sort_filter, log_fn)
                            posts = [p for p in posts if normalize_commented_post_url(p.get('url', '')) not in already_commented]
                            tried_urls = set()
                            continue
                        if interacted_count > 0:
                            log_fn("[Comment] No more commentable posts available; finishing early", "warning")
                            break
                        log_fn("[Comment] Exhausted all scraped posts without finding an open comment section", "error")
                        raise Exception("No suitable posts found with open comment sections")

                    chosen_idx = _ai_pick_post(available_posts, keyword, personality, api_key, model, log_fn)
                    if not isinstance(chosen_idx, int) or chosen_idx < 0 or chosen_idx >= len(available_posts):
                        chosen_idx = 0

                    chosen_post = available_posts[chosen_idx]
                    chosen_post["url"] = _validate_reddit_post_url(chosen_post.get("url", ""))
                    tried_urls.add(chosen_post["url"])
                    claimed_post_url = ""

                    log_fn(f"[Comment] Selected post URL (attempt {attempt+1}/{max_attempts}): {chosen_post['url']}", "info")

                    if has_account_commented_post(account_id, chosen_post['url']):
                        log_fn("[Comment] Post already exists in comment history, retrying another post...", "warning")
                        continue

                    claim_acquired, claimed_post_url = try_acquire_comment_claim(account_id, chosen_post['url'])
                    if not claim_acquired:
                        log_fn("[Comment] Another job is already commenting on this post, retrying another post...", "warning")
                        continue

                    log_fn(f"[Comment] Navigating to: {chosen_post['title'][:70]}", "info")
                    driver.get(chosen_post['url'])
                    time.sleep(random.uniform(3, 5))

                    driver.execute_script("window.scrollBy(0, 400);")
                    time.sleep(random.uniform(2, 4))

                    pre_url = driver.current_url.split('#')[0].rstrip('/')
                    has_image, has_ad, _ = _detect_page_features(driver, log_fn)
                    allow_visual = not (has_image or has_ad)
                    if not allow_visual and log_fn:
                        log_fn("[Comment] Media/ads detected — disabling visual click", "info")

                    content_box = _get_top_level_comment_input(driver, log_fn, allow_visual=allow_visual)

                    if not content_box:
                        log_fn("[Comment] Could not find top-level comment box (maybe locked/archived). Retrying another post...", "warning")
                        continue

                    if not _focus_comment_input(driver, content_box, log_fn):
                        log_fn("[Comment] Could not focus comment box, retrying another post...", "warning")
                        continue

                    if driver.current_url.split('#')[0].rstrip('/') != pre_url:
                        log_fn("[Comment] Navigation detected after focus — recovering", "warning")
                        driver.get(pre_url)
                        time.sleep(random.uniform(2, 4))
                        content_box = _get_top_level_comment_input(driver, log_fn, allow_visual=allow_visual)
                        if not content_box or not _focus_comment_input(driver, content_box, log_fn):
                            log_fn("[Comment] Recovery failed, skipping post", "warning")
                            continue

                    if not _probe_comment_input(driver, content_box, log_fn):
                        log_fn("[Comment] Comment input probe failed, skipping post", "warning")
                        continue

                    if driver.current_url.split('#')[0].rstrip('/') != pre_url:
                        log_fn("[Comment] Navigation detected after probe — recovering", "warning")
                        driver.get(pre_url)
                        time.sleep(random.uniform(2, 4))
                        content_box = _get_top_level_comment_input(driver, log_fn, allow_visual=allow_visual)
                        if not content_box or not _focus_comment_input(driver, content_box, log_fn):
                            log_fn("[Comment] Recovery failed after probe, skipping post", "warning")
                            continue

                    post_body = _scrape_post_body(driver)
                    log_fn(f"[Comment] Read post body ({len(post_body)} chars)", "info")

                    log_fn("[Comment] Generating AI comment...", "info")
                    max_words = _safe_int(params.get("max_words", 15) or 15, 15, min_value=8, max_value=80)
                    max_sentences = _safe_int(params.get("max_sentences", 1) or 1, 1, min_value=1, max_value=3)
                    comment_text = _ai_generate_comment(
                        chosen_post['title'], post_body, keyword,
                        personality, api_key, model, extra_context, log_fn,
                        max_words=max_words, max_sentences=max_sentences
                    )

                    if not comment_text:
                        raise Exception("AI failed to generate a comment")

                    try:
                        try:
                            driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", content_box)
                            driver.execute_script("arguments[0].focus();", content_box)
                        except:
                            pass
                        time.sleep(random.uniform(0.4, 0.9))

                        log_fn(f"[Comment] Typing comment ({len(comment_text)} chars)...", "info")

                        typed = False
                        try:
                            _type_like_human(driver, content_box, comment_text)
                            typed = bool(_get_editor_text(driver, content_box))
                        except Exception as type_err:
                            log_fn(f"[Comment] Human typing failed, trying JS fallback: {str(type_err)[:120]}", "warning")
                            typed = False

                        if not typed:
                            typed = bool(_inject_comment_text(driver, content_box, comment_text))
                            if typed:
                                typed = bool(_get_editor_text(driver, content_box))
                                log_fn("[Comment] Used JS injection fallback for editor sync", "warning")

                        if not typed:
                            log_fn("[Comment] Could not insert comment text, skipping post", "warning")
                            continue

                        time.sleep(random.uniform(1.0, 2.0))

                        log_fn("[Comment] Looking for submit button...", "info")
                        submit_btn = None
                        for _ in range(8):
                            submit_btn = _find_comment_submit(driver, require_comment=True)
                            if submit_btn:
                                break
                            time.sleep(0.5)

                        if not submit_btn:
                            raise Exception("Could not find Comment submit button")

                        driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", submit_btn)
                        time.sleep(random.uniform(0.4, 0.9))
                        driver.execute_script("arguments[0].click();", submit_btn)

                        time.sleep(random.uniform(2, 4))

                        try:
                            record = CommentedPost(
                                account_id=account_id,
                                post_url=normalize_commented_post_url(chosen_post['url']),
                                post_title=chosen_post.get('title', '')[:500]
                            )
                            db.session.add(record)
                            db.session.commit()
                            log_fn(f"[Comment] Post saved to commented history", "info")
                        except Exception as record_err:
                            log_fn(f"[Comment] Warning: could not save to commented history: {record_err}", "warning")

                        log_fn(f"[Comment] Comment submitted successfully on: {chosen_post['title'][:80]}", "success")
                        interacted_count += 1

                        if interacted_count < requested_count:
                            cooldown = random.randint(5, 10)
                            log_fn(f"[Comment] Cooling down for {cooldown}s before next comment...", "info")
                            time.sleep(cooldown)

                    except Exception as e:
                        log_fn(f"[Comment] Failed to submit comment: {str(e)[:150]}", "error")
                    finally:
                        if claimed_post_url:
                            release_comment_claim(account_id, claimed_post_url)

                if interacted_count == 0:
                    raise Exception("Exhausted all attempts, could not submit any comments.")

                if used_interest_keyword and interacted_count > 0:
                    _rotate_interests(account, interests_list, log_fn)

                result = {
                    "message": f"Successfully commented on {interacted_count}/{requested_count} posts.",
                    "success": True
                }
                if interacted_count < requested_count:
                    result["warning"] = f"Only commented on {interacted_count}/{requested_count} posts. Some posts were unavailable or not commentable."
                    log_fn(result["warning"], "warning")
                return result

            else:
                raise Exception(f"Unknown job type: {job_type}")
        finally:
            _cleanup_job_tabs(driver, log_fn)
