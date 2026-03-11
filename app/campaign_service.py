import json
import re
import threading
from datetime import UTC, datetime, timedelta, timezone

import requests

from interest_utils import move_interest_to_back, normalize_interest_csv, normalize_interest_list, rotate_interest_queue
from models import db, Account, Job, ManagedAction, ApprovalDraft, ApprovalReview, BusinessMemory, Setting


DEFAULT_CAMPAIGN_STRATEGY = {
    "brand_name": "Suzi Eszterhas Wildlife Photo Tours",
    "brand_mention_requires_approval": True,
    "max_managed_accounts_per_thread": 1,
    "rolling_window_actions": 20,
    "max_brand_mentions_per_window": 2,
    "planner_interval_hours": 4,
    "planner_customer_jobs_per_round": 3,
    "planner_employee_jobs_per_round": 1,
    "customer_brand_soft_ratio": 0.10,
    "max_pending_customer_brand_drafts": 1,
    "max_pending_employee_brand_drafts": 1,
    "customer_job_type": "search_and_interact",
    "employee_job_type": "search_and_interact",
}

OPEN_ACTION_STATUSES = ["planned", "queued", "running"]
WINDOW_ACTION_STATUSES = ["queued", "running", "done", "error"]
ACCOUNT_ROLES = {"customer", "employee", "inactive"}
LEGACY_STRATEGY_KEY_MAP = {
    "planner_pro_jobs_per_round": "planner_employee_jobs_per_round",
    "max_pending_pro_brand_drafts": "max_pending_employee_brand_drafts",
    "pro_job_type": "employee_job_type",
}
APPROVAL_KINDS = {"customer_brand", "employee_brand", "employee_helpful"}
LOCAL_TZ = datetime.now().astimezone().tzinfo or timezone.utc
UTC_TZ = timezone.utc
SIMPLIFIED_CAMPAIGN_DISPATCH_LOCK = threading.Lock()
SIMPLIFIED_CAMPAIGN_DEFAULTS = {
    "start_time": "12:00",
    "end_time": "14:00",
    "customer_normal_per_agent": 1,
    "customer_brand_total": 2,
    "employee_helpful_total": 2,
    "employee_brand_total": 1,
    "approval_digest_time": "08:00",
}
SIMPLIFIED_CAMPAIGN_COUNT_KEYS = [
    "customer_normal",
    "customer_brand",
    "employee_helpful",
    "employee_brand",
]
SIMPLIFIED_CAMPAIGN_KIND_META = {
    "customer_normal": {"role": "customer", "mode": "action", "draft_kind": None},
    "customer_brand": {"role": "customer", "mode": "draft", "draft_kind": "customer_brand"},
    "employee_helpful": {"role": "employee", "mode": "draft", "draft_kind": "employee_helpful"},
    "employee_brand": {"role": "employee", "mode": "draft", "draft_kind": "employee_brand"},
}
CAMPAIGN_LANE_DEFAULTS = {
    "customer_normal": {
        "enabled": False,
        "start_time": "10:00",
        "end_time": "12:00",
        "daily_target": 6,
        "gap_minutes": 2,
        "auto_calculate_gap": False,
    },
    "employee_helpful": {
        "enabled": False,
        "start_time": "10:00",
        "end_time": "12:00",
        "daily_target": 3,
        "gap_minutes": 20,
        "auto_calculate_gap": True,
    },
    "customer_brand": {
        "enabled": False,
        "start_time": "10:00",
        "end_time": "12:00",
        "daily_target": 2,
        "gap_minutes": 20,
        "auto_calculate_gap": True,
    },
    "employee_brand": {
        "enabled": False,
        "start_time": "10:00",
        "end_time": "12:00",
        "daily_target": 2,
        "gap_minutes": 20,
        "auto_calculate_gap": True,
    },
}
CAMPAIGN_LANE_META = {
    "customer_normal": {
        "label": "Customer Normal Comments",
        "short_label": "Customer Normal",
        "role": "customer",
        "mode": "auto_queue",
        "content_mode": "organic",
        "draft_kind": None,
        "approval_bucket": None,
        "description": "Auto-run one normal customer comment per account during the lane window.",
    },
    "employee_helpful": {
        "label": "Employee Helpful Comments",
        "short_label": "Employee Helpful",
        "role": "employee",
        "mode": "approval",
        "content_mode": "expert",
        "draft_kind": "employee_helpful",
        "approval_bucket": "employee_helpful",
        "description": "Prepare grounded helpful employee drafts that wait for approval.",
    },
    "customer_brand": {
        "label": "Customer Brand Mention Comments",
        "short_label": "Customer Brand",
        "role": "customer",
        "mode": "approval",
        "content_mode": "brand",
        "draft_kind": "customer_brand",
        "approval_bucket": "customer",
        "description": "Prepare customer-style brand mention drafts that wait for approval.",
    },
    "employee_brand": {
        "label": "Employee Brand Mention Comments",
        "short_label": "Employee Brand",
        "role": "employee",
        "mode": "approval",
        "content_mode": "brand",
        "draft_kind": "employee_brand",
        "approval_bucket": "employee_brand",
        "description": "Prepare employee brand mention drafts that wait for approval.",
    },
}
REDDIT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; RedAutomation/1.0; +https://reddit.com)",
    "Accept": "application/json",
}
BRAND_TOPIC_TERMS = [
    "safari", "wildlife", "photo tour", "photography tour", "wildlife photography", "game drive",
    "lodge", "camp", "reserve", "masai mara", "serengeti", "amboseli", "okavango", "ngorongoro",
    "kenya safari", "tanzania safari", "botswana safari", "south africa safari", "birding safari",
]
BRAND_INTENT_TERMS = [
    "recommend", "recommendation", "operator", "tour operator", "company", "itinerary", "book",
    "booking", "planner", "guide", "worth it", "best", "which one", "who did you use",
    "suggestions", "reviews", "planning", "trip report", "any advice", "help me plan",
]
STRONG_CUSTOMER_BRAND_TERMS = [
    "which operator", "tour operator", "which company", "who did you book", "who did you use",
    "recommend", "recommendation", "any suggestions", "worth it", "reviews",
]
BLOCKED_BRAND_TERMS = [
    "aita", "am i the asshole", "mother in law", "in-laws", "husband", "wife", "boyfriend",
    "girlfriend", "relationship", "concert", "wedding", "divorce", "cheating", "family drama",
    "vent", "rant", "confession", "meme", "shitpost", "circlejerk", "karma",
]
BLOCKED_BRAND_SUBREDDITS = {
    "r/amitheasshole", "r/aitah", "r/relationship_advice", "r/trueoffmychest", "r/offmychest",
    "r/confessions", "r/askreddit", "r/tifu",
}


def _safe_json_loads(raw_value, fallback):
    if not raw_value:
        return fallback
    try:
        parsed = json.loads(raw_value)
        return parsed if isinstance(parsed, type(fallback)) else fallback
    except Exception:
        return fallback


def _setting_record(key):
    return Setting.query.filter_by(key=key).first()


def _get_setting_value(key, default=""):
    record = _setting_record(key)
    return record.value if record and record.value is not None else default


def _set_setting_value(key, value):
    record = _setting_record(key)
    text_value = "" if value is None else str(value)
    if record:
        record.value = text_value
    else:
        db.session.add(Setting(key=key, value=text_value))


def _coerce_strategy_value(key, value):
    default = DEFAULT_CAMPAIGN_STRATEGY[key]
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(default, int):
        try:
            return int(value)
        except Exception:
            return default
    if isinstance(default, float):
        try:
            return float(value)
        except Exception:
            return default
    if value is None:
        return default
    return str(value).strip() or default


def _normalize_strategy(strategy):
    strategy["max_managed_accounts_per_thread"] = max(1, int(strategy["max_managed_accounts_per_thread"]))
    strategy["rolling_window_actions"] = max(5, int(strategy["rolling_window_actions"]))
    strategy["max_brand_mentions_per_window"] = max(0, int(strategy["max_brand_mentions_per_window"]))
    strategy["planner_interval_hours"] = max(1, int(strategy["planner_interval_hours"]))
    strategy["planner_customer_jobs_per_round"] = max(0, int(strategy["planner_customer_jobs_per_round"]))
    strategy["planner_employee_jobs_per_round"] = max(0, int(strategy["planner_employee_jobs_per_round"]))
    strategy["customer_brand_soft_ratio"] = min(0.5, max(0.0, float(strategy["customer_brand_soft_ratio"])))
    strategy["max_pending_customer_brand_drafts"] = max(0, int(strategy["max_pending_customer_brand_drafts"]))
    strategy["max_pending_employee_brand_drafts"] = max(0, int(strategy["max_pending_employee_brand_drafts"]))
    return strategy


def get_campaign_strategy(persist=False):
    strategy = dict(DEFAULT_CAMPAIGN_STRATEGY)
    raw = _get_setting_value("campaign_strategy", "")
    parsed = _safe_json_loads(raw, {})
    for legacy_key, new_key in LEGACY_STRATEGY_KEY_MAP.items():
        if legacy_key in parsed and new_key not in parsed:
            parsed[new_key] = parsed[legacy_key]
    for key in DEFAULT_CAMPAIGN_STRATEGY:
        if key in parsed:
            strategy[key] = _coerce_strategy_value(key, parsed[key])
    strategy = _normalize_strategy(strategy)

    if persist:
        _set_setting_value("campaign_strategy", json.dumps(strategy))
        db.session.commit()
    return strategy


def save_campaign_strategy(updates):
    strategy = get_campaign_strategy()
    normalized_updates = dict(updates or {})
    for legacy_key, new_key in LEGACY_STRATEGY_KEY_MAP.items():
        if legacy_key in normalized_updates and new_key not in normalized_updates:
            normalized_updates[new_key] = normalized_updates[legacy_key]
    for key in DEFAULT_CAMPAIGN_STRATEGY:
        if key in normalized_updates:
            strategy[key] = _coerce_strategy_value(key, normalized_updates[key])
    strategy = _normalize_strategy(strategy)
    _set_setting_value("campaign_strategy", json.dumps(strategy))
    db.session.commit()
    return strategy


def _coerce_non_negative_int(value, field_name):
    try:
        parsed = int(value)
    except Exception as exc:
        raise ValueError(f"{field_name} must be an integer.") from exc
    if parsed < 0:
        raise ValueError(f"{field_name} must be 0 or greater.")
    return parsed


def _safe_non_negative_int(value, default=0):
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(0, parsed)


def get_simplified_campaign_config(persist=False):
    config = dict(SIMPLIFIED_CAMPAIGN_DEFAULTS)
    raw = _get_setting_value("campaign_shared_config", "")
    parsed = _safe_json_loads(raw, {})
    if isinstance(parsed, dict):
        for key in SIMPLIFIED_CAMPAIGN_DEFAULTS:
            if key not in parsed:
                continue
            if key in {"start_time", "end_time", "approval_digest_time"}:
                config[key] = _parse_hhmm(parsed.get(key), SIMPLIFIED_CAMPAIGN_DEFAULTS[key])
            else:
                config[key] = _safe_non_negative_int(parsed.get(key), SIMPLIFIED_CAMPAIGN_DEFAULTS[key])
    if persist:
        _set_setting_value("campaign_shared_config", json.dumps(config))
        if _get_setting_value("approval_digest_time", "") != config["approval_digest_time"]:
            _set_setting_value("approval_digest_time", config["approval_digest_time"])
        db.session.commit()
    return config


def save_simplified_campaign_config(updates):
    payload = dict(updates or {})
    config = get_simplified_campaign_config()
    start_time = _parse_required_hhmm(payload.get("start_time", config["start_time"]))
    end_time = _parse_required_hhmm(payload.get("end_time", config["end_time"]))
    if _minutes_between_times(start_time, end_time) <= 0:
        raise ValueError("End time must be later than start time.")

    config.update({
        "start_time": start_time,
        "end_time": end_time,
        "customer_normal_per_agent": _coerce_non_negative_int(payload.get("customer_normal_per_agent", config["customer_normal_per_agent"]), "customer_normal_per_agent"),
        "customer_brand_total": _coerce_non_negative_int(payload.get("customer_brand_total", config["customer_brand_total"]), "customer_brand_total"),
        "employee_helpful_total": _coerce_non_negative_int(payload.get("employee_helpful_total", config["employee_helpful_total"]), "employee_helpful_total"),
        "employee_brand_total": _coerce_non_negative_int(payload.get("employee_brand_total", config["employee_brand_total"]), "employee_brand_total"),
        "approval_digest_time": _parse_required_hhmm(payload.get("approval_digest_time", config["approval_digest_time"])),
    })
    _set_setting_value("campaign_shared_config", json.dumps(config))
    _set_setting_value("approval_digest_time", config["approval_digest_time"])
    db.session.commit()
    return config


def get_simplified_campaign_enabled(persist=False):
    raw = str(_get_setting_value("campaign_shared_enabled", "false")).strip().lower()
    enabled = raw not in {"0", "false", "no", "off"}
    if persist and raw == "":
        _set_setting_value("campaign_shared_enabled", "false")
        db.session.commit()
    return enabled


def set_simplified_campaign_enabled(enabled):
    _set_setting_value("campaign_shared_enabled", "true" if enabled else "false")
    db.session.commit()
    return bool(enabled)


def _default_simplified_campaign_runtime(window_key=None):
    return {
        "window_key": window_key,
        "created_counts": {key: 0 for key in SIMPLIFIED_CAMPAIGN_COUNT_KEYS},
        "customer_normal_account_counts": {},
        "customer_normal_eligible_account_ids": [],
        "rotation": {key: {"last_account_id": None} for key in SIMPLIFIED_CAMPAIGN_COUNT_KEYS},
        "last_dispatch_at": None,
    }


def _normalize_simplified_campaign_runtime(runtime, window_key=None):
    normalized = _default_simplified_campaign_runtime(window_key)
    if isinstance(runtime, dict):
        normalized["window_key"] = str(runtime.get("window_key") or window_key or "") or None
        provided_counts = runtime.get("created_counts") if isinstance(runtime.get("created_counts"), dict) else {}
        normalized["created_counts"] = {
            key: _safe_non_negative_int(provided_counts.get(key), 0) for key in SIMPLIFIED_CAMPAIGN_COUNT_KEYS
        }
        per_account = runtime.get("customer_normal_account_counts") if isinstance(runtime.get("customer_normal_account_counts"), dict) else {}
        normalized["customer_normal_account_counts"] = {
            str(account_id): _safe_non_negative_int(count, 0)
            for account_id, count in per_account.items()
            if str(account_id).isdigit()
        }
        eligible_ids = runtime.get("customer_normal_eligible_account_ids")
        if not isinstance(eligible_ids, list):
            eligible_ids = []
        normalized["customer_normal_eligible_account_ids"] = [
            int(account_id) for account_id in eligible_ids if str(account_id).isdigit()
        ]
        rotation = runtime.get("rotation") if isinstance(runtime.get("rotation"), dict) else {}
        normalized["rotation"] = {}
        for key in SIMPLIFIED_CAMPAIGN_COUNT_KEYS:
            item = rotation.get(key) if isinstance(rotation.get(key), dict) else {}
            account_id = item.get("last_account_id")
            normalized["rotation"][key] = {
                "last_account_id": int(account_id) if str(account_id).isdigit() else None
            }
        normalized["last_dispatch_at"] = str(runtime.get("last_dispatch_at") or "") or None
    return normalized


def _current_campaign_window_key(config, now_utc=None):
    now_utc = now_utc or datetime.now(UTC)
    return f"{_today_key_from_utc(now_utc)}|{config['start_time']}|{config['end_time']}"


def get_simplified_campaign_runtime(config=None, now_utc=None, persist=False):
    config = config or get_simplified_campaign_config(persist=True)
    window_key = _current_campaign_window_key(config, now_utc=now_utc)
    raw = _get_setting_value("campaign_shared_runtime", "")
    runtime = _normalize_simplified_campaign_runtime(_safe_json_loads(raw, {}), window_key=window_key)
    if runtime.get("window_key") != window_key:
        runtime = _default_simplified_campaign_runtime(window_key)
    if not runtime.get("customer_normal_eligible_account_ids"):
        runtime["customer_normal_eligible_account_ids"] = [account.id for account in get_eligible_accounts("customer")]
    if persist:
        _set_setting_value("campaign_shared_runtime", json.dumps(runtime))
        db.session.commit()
    return runtime


def save_simplified_campaign_runtime(runtime, config=None, now_utc=None):
    config = config or get_simplified_campaign_config(persist=True)
    window_key = _current_campaign_window_key(config, now_utc=now_utc)
    normalized = _normalize_simplified_campaign_runtime(runtime, window_key=window_key)
    normalized["window_key"] = window_key
    _set_setting_value("campaign_shared_runtime", json.dumps(normalized))
    db.session.commit()
    return normalized


def _shared_window_bounds(now_utc=None, config=None):
    config = config or get_simplified_campaign_config(persist=True)
    now_utc = now_utc or datetime.now(UTC)
    now_local = _utc_to_local(now_utc)
    start_h, start_m = map(int, config["start_time"].split(":"))
    end_h, end_m = map(int, config["end_time"].split(":"))
    start_local = now_local.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
    end_local = now_local.replace(hour=end_h, minute=end_m, second=0, microsecond=0)
    return now_local, start_local, end_local


def build_simplified_campaign_state(now_utc=None, config=None):
    config = config or get_simplified_campaign_config(persist=True)
    enabled = get_simplified_campaign_enabled(persist=True)
    now_local, start_local, end_local = _shared_window_bounds(now_utc=now_utc, config=config)
    return {
        "enabled": enabled,
        "active_now": bool(enabled and start_local <= now_local <= end_local),
        "window_label": f"{_format_local_clock_12h(start_local)} - {_format_local_clock_12h(end_local)}",
        "current_local_time_label": _format_local_clock_12h(now_local),
    }


def _campaign_window_targets(config, eligible_customers=None):
    eligible_customers = eligible_customers if eligible_customers is not None else get_eligible_accounts("customer")
    return {
        "customer_normal_target": int(config["customer_normal_per_agent"]) * len(eligible_customers),
        "customer_brand_total": int(config["customer_brand_total"]),
        "employee_helpful_total": int(config["employee_helpful_total"]),
        "employee_brand_total": int(config["employee_brand_total"]),
    }


def _dispatch_eligible_accounts(kind):
    role = SIMPLIFIED_CAMPAIGN_KIND_META[kind]["role"]
    accounts = get_eligible_accounts(role)
    if SIMPLIFIED_CAMPAIGN_KIND_META[kind]["mode"] != "draft":
        return accounts
    pending_ids = get_pending_approval_draft_account_ids()
    return [account for account in accounts if account.id not in pending_ids]


def _rotate_accounts(accounts, last_account_id):
    if not accounts:
        return []
    sorted_accounts = sorted(accounts, key=lambda item: (item.username.lower(), item.id))
    if not last_account_id:
        return sorted_accounts
    for index, account in enumerate(sorted_accounts):
        if account.id == last_account_id:
            return sorted_accounts[index + 1:] + sorted_accounts[: index + 1]
    return sorted_accounts


def _choose_customer_normal_account(accounts, runtime, per_agent_target):
    if not accounts or per_agent_target <= 0:
        return None
    counts = runtime.get("customer_normal_account_counts") or {}
    remaining = [account for account in accounts if int(counts.get(str(account.id), 0) or 0) < per_agent_target]
    if not remaining:
        return None
    min_count = min(int(counts.get(str(account.id), 0) or 0) for account in remaining)
    candidates = [account for account in remaining if int(counts.get(str(account.id), 0) or 0) == min_count]
    last_account_id = ((runtime.get("rotation") or {}).get("customer_normal") or {}).get("last_account_id")
    rotated = _rotate_accounts(candidates, last_account_id)
    return rotated[0] if rotated else None


def _choose_rotated_account(kind, accounts, runtime):
    last_account_id = ((runtime.get("rotation") or {}).get(kind) or {}).get("last_account_id")
    rotated = _rotate_accounts(accounts, last_account_id)
    return rotated[0] if rotated else None


def _mark_runtime_dispatch(runtime, kind, account_id, now_utc=None):
    now_utc = now_utc or datetime.now(UTC)
    runtime["created_counts"][kind] = int(runtime.get("created_counts", {}).get(kind, 0) or 0) + 1
    runtime.setdefault("rotation", {}).setdefault(kind, {})["last_account_id"] = account_id
    if kind == "customer_normal":
        counts = runtime.setdefault("customer_normal_account_counts", {})
        key = str(account_id)
        counts[key] = int(counts.get(key, 0) or 0) + 1
    runtime["last_dispatch_at"] = now_utc.isoformat()
    return runtime


def dispatch_simplified_campaign(now_utc=None, queue_callback=None, ignore_window=False):
    with SIMPLIFIED_CAMPAIGN_DISPATCH_LOCK:
        now_utc = now_utc or datetime.now(UTC)
        strategy = get_campaign_strategy(persist=True)
        config = get_simplified_campaign_config(persist=True)
        runtime = get_simplified_campaign_runtime(config=config, now_utc=now_utc, persist=True)
        state = build_simplified_campaign_state(now_utc=now_utc, config=config)
        if not state["enabled"]:
            return []
        if not ignore_window and not state["active_now"]:
            return []

        stable_customer_ids = set(runtime.get("customer_normal_eligible_account_ids") or [])
        eligible_customers = [account for account in _dispatch_eligible_accounts("customer_normal") if account.id in stable_customer_ids]
        targets = _campaign_window_targets(config, eligible_customers=[object() for _ in stable_customer_ids])
        events = []

        if runtime["created_counts"].get("customer_normal", 0) < targets["customer_normal_target"]:
            account = _choose_customer_normal_account(eligible_customers, runtime, int(config["customer_normal_per_agent"]))
            if account:
                action = create_customer_normal_action(account, strategy, extra_params={
                    "campaign_kind": "customer_normal",
                    "campaign_window_key": runtime["window_key"],
                })
                queued_action = action
                job = None
                if queue_callback:
                    queued_action, job = queue_callback(action, commit=False, start_thread=False)
                runtime = _mark_runtime_dispatch(runtime, "customer_normal", account.id, now_utc=now_utc)
                save_simplified_campaign_runtime(runtime, config=config, now_utc=now_utc)
                db.session.commit()
                if job:
                    from app import _start_job_thread

                    _start_job_thread(job.id)
                events.append({
                    "campaign_kind": "customer_normal",
                    "lane_id": "customer_normal",
                    "lane_label": "Customer Normal",
                    "kind": "action",
                    "account_id": account.id,
                    "account_username": account.username,
                    "action": queued_action.to_dict(),
                    "job": job.to_dict() if job else None,
                })

        for kind in ["customer_brand", "employee_helpful", "employee_brand"]:
            if runtime["created_counts"].get(kind, 0) >= targets[f"{kind}_total"]:
                continue
            accounts = _dispatch_eligible_accounts(kind)
            account = _choose_rotated_account(kind, accounts, runtime)
            if not account:
                continue
            draft = create_approval_draft(account, strategy, SIMPLIFIED_CAMPAIGN_KIND_META[kind]["draft_kind"], extra_params={
                "campaign_kind": kind,
                "campaign_window_key": runtime["window_key"],
            })
            if not draft:
                continue
            db.session.flush()
            runtime = _mark_runtime_dispatch(runtime, kind, account.id, now_utc=now_utc)
            save_simplified_campaign_runtime(runtime, config=config, now_utc=now_utc)
            events.append({
                "campaign_kind": kind,
                "lane_id": kind,
                "lane_label": CAMPAIGN_LANE_META[kind]["short_label"],
                "kind": "draft",
                "account_id": account.id,
                "account_username": account.username,
                "draft": draft.to_dict(),
            })

        return events


def _parse_hhmm(value, fallback):
    text = str(value or fallback).strip()
    try:
        parsed = datetime.strptime(text, "%H:%M")
    except ValueError:
        parsed = datetime.strptime(fallback, "%H:%M")
    return parsed.strftime("%H:%M")


def _parse_required_hhmm(value):
    text = str(value or "").strip()
    if not text:
        raise ValueError("Time is required in HH:MM format.")
    try:
        parsed = datetime.strptime(text, "%H:%M")
    except ValueError as exc:
        raise ValueError("Time must use HH:MM format.") from exc
    return parsed.strftime("%H:%M")


def _minutes_between_times(start_time, end_time):
    start = datetime.strptime(start_time, "%H:%M")
    end = datetime.strptime(end_time, "%H:%M")
    minutes = int((end - start).total_seconds() // 60)
    return minutes if minutes > 0 else 0


def _coerce_lane_value(key, value, default):
    if isinstance(default, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
    if key in {"start_time", "end_time"}:
        return _parse_hhmm(value, default)
    try:
        return int(value)
    except Exception:
        return default


def _normalize_lane_config(config):
    normalized = {}
    for lane_id, defaults in CAMPAIGN_LANE_DEFAULTS.items():
        lane_config = dict(defaults)
        provided = config.get(lane_id) if isinstance(config, dict) else None
        if not isinstance(provided, dict):
            provided = {}
        for key, default in defaults.items():
            lane_config[key] = _coerce_lane_value(key, provided.get(key, default), default)
        lane_config["daily_target"] = max(0, int(lane_config["daily_target"]))
        lane_config["gap_minutes"] = max(1, int(lane_config["gap_minutes"]))
        if _minutes_between_times(lane_config["start_time"], lane_config["end_time"]) <= 0:
            lane_config["end_time"] = defaults["end_time"]
        normalized[lane_id] = lane_config
    return normalized


def get_campaign_lane_config(persist=False):
    raw = _get_setting_value("campaign_lane_config", "")
    parsed = _safe_json_loads(raw, {})
    config = _normalize_lane_config(parsed)
    if persist:
        _set_setting_value("campaign_lane_config", json.dumps(config))
        db.session.commit()
    return config


def save_campaign_lane_config(lane_id, updates):
    if lane_id not in CAMPAIGN_LANE_DEFAULTS:
        raise ValueError("Unknown campaign lane.")
    config = get_campaign_lane_config()
    lane_config = dict(config.get(lane_id) or CAMPAIGN_LANE_DEFAULTS[lane_id])
    for key in CAMPAIGN_LANE_DEFAULTS[lane_id]:
        if key in (updates or {}):
            lane_config[key] = _coerce_lane_value(key, updates[key], CAMPAIGN_LANE_DEFAULTS[lane_id][key])
    if _minutes_between_times(lane_config["start_time"], lane_config["end_time"]) <= 0:
        raise ValueError("End time must be later than start time.")
    config[lane_id] = _normalize_lane_config({lane_id: lane_config})[lane_id]
    _set_setting_value("campaign_lane_config", json.dumps(config))
    db.session.commit()
    return config[lane_id]


def _default_lane_runtime():
    return {
        "date": None,
        "run_count": 0,
        "used_account_ids": [],
        "last_run_at": None,
        "last_attempt_at": None,
        "today_override": None,
        "paused_date": None,
    }


def _normalize_lane_state(state):
    normalized = {}
    for lane_id in CAMPAIGN_LANE_DEFAULTS:
        runtime = _default_lane_runtime()
        provided = state.get(lane_id) if isinstance(state, dict) else None
        if isinstance(provided, dict):
            runtime.update({
                "date": str(provided.get("date") or "") or None,
                "run_count": max(0, int(provided.get("run_count") or 0)),
                "used_account_ids": [int(item) for item in (provided.get("used_account_ids") or []) if str(item).isdigit()],
                "last_run_at": str(provided.get("last_run_at") or "") or None,
                "last_attempt_at": str(provided.get("last_attempt_at") or "") or None,
                "paused_date": str(provided.get("paused_date") or "") or None,
            })
            override = provided.get("today_override")
            if isinstance(override, dict):
                runtime["today_override"] = {
                    "date": str(override.get("date") or "") or None,
                    "config": _normalize_lane_config({lane_id: override.get("config") or {}})[lane_id],
                }
        normalized[lane_id] = runtime
    return normalized


def get_campaign_lane_state(persist=False):
    raw = _get_setting_value("campaign_lane_state", "")
    parsed = _safe_json_loads(raw, {})
    state = _normalize_lane_state(parsed)
    if persist:
        _set_setting_value("campaign_lane_state", json.dumps(state))
        db.session.commit()
    return state


def save_campaign_lane_state(state):
    normalized = _normalize_lane_state(state)
    _set_setting_value("campaign_lane_state", json.dumps(normalized))
    db.session.commit()
    return normalized


def reset_lane_day_state(runtime, day_key):
    if runtime.get("date") != day_key:
        runtime["date"] = day_key
        runtime["run_count"] = 0
        runtime["used_account_ids"] = []
        runtime["last_run_at"] = None
        runtime["last_attempt_at"] = None
    override = runtime.get("today_override") or {}
    if override and override.get("date") != day_key:
        runtime["today_override"] = None
    if runtime.get("paused_date") and runtime.get("paused_date") != day_key:
        runtime["paused_date"] = None
    return runtime


def save_campaign_lane_override(lane_id, updates, day_key=None):
    if lane_id not in CAMPAIGN_LANE_DEFAULTS:
        raise ValueError("Unknown campaign lane.")
    target_day = day_key or _current_local_day_key()
    override_config = dict(get_campaign_lane_config().get(lane_id) or CAMPAIGN_LANE_DEFAULTS[lane_id])
    for key in CAMPAIGN_LANE_DEFAULTS[lane_id]:
        if key in (updates or {}):
            override_config[key] = _coerce_lane_value(key, updates[key], CAMPAIGN_LANE_DEFAULTS[lane_id][key])
    if _minutes_between_times(override_config["start_time"], override_config["end_time"]) <= 0:
        raise ValueError("End time must be later than start time.")
    state = get_campaign_lane_state()
    runtime = reset_lane_day_state(state.get(lane_id) or _default_lane_runtime(), target_day)
    runtime["today_override"] = {"date": target_day, "config": _normalize_lane_config({lane_id: override_config})[lane_id]}
    runtime["paused_date"] = None
    state[lane_id] = runtime
    save_campaign_lane_state(state)
    return runtime


def clear_campaign_lane_override(lane_id, day_key=None):
    state = get_campaign_lane_state()
    target_day = day_key or _current_local_day_key()
    runtime = reset_lane_day_state(state.get(lane_id) or _default_lane_runtime(), target_day)
    runtime["today_override"] = None
    state[lane_id] = runtime
    save_campaign_lane_state(state)
    return runtime


def set_campaign_lane_pause(lane_id, paused, day_key=None):
    state = get_campaign_lane_state()
    target_day = day_key or _current_local_day_key()
    runtime = reset_lane_day_state(state.get(lane_id) or _default_lane_runtime(), target_day)
    runtime["paused_date"] = target_day if paused else None
    state[lane_id] = runtime
    save_campaign_lane_state(state)
    return runtime


def get_last_planning_round():
    raw = _get_setting_value("campaign_last_planned_at", "")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def set_last_planning_round(dt_value):
    _set_setting_value("campaign_last_planned_at", dt_value.isoformat() if dt_value else "")


def get_window_reset_at():
    raw = _get_setting_value("campaign_window_reset_at", "")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def reset_campaign_window(dt_value=None):
    dt_value = dt_value or datetime.now(UTC)
    _set_setting_value("campaign_window_reset_at", dt_value.isoformat())
    db.session.commit()
    return dt_value


def parse_interests(raw_interests):
    return normalize_interest_list(raw_interests)


def choose_primary_keyword(account):
    interests = parse_interests(account.interests)
    return interests[0] if interests else ""


def _ordered_interest_search_terms(account, keyword=""):
    ordered_terms = []
    seen = set()
    for term in [keyword, *parse_interests(account.interests)]:
        normalized_term = str(term or "").strip()
        if not normalized_term:
            continue
        key = normalized_term.lower()
        if key in seen:
            continue
        seen.add(key)
        ordered_terms.append(normalized_term)
    return ordered_terms


def _rotate_account_interests(account):
    rotated_csv, rotated_interests, _ = rotate_interest_queue(account.interests)
    if rotated_interests:
        account.interests = rotated_csv
    else:
        account.interests = normalize_interest_csv(account.interests)


def rotate_account_interest(account, matched_interest):
    rotated_csv, rotated_interests, _ = move_interest_to_back(account.interests, matched_interest)
    if rotated_interests:
        account.interests = rotated_csv
    else:
        account.interests = normalize_interest_csv(account.interests)


def _clean_post_text(value, limit=3500):
    text = re.sub(r"\s+", " ", (value or "").replace("\u200b", " ")).strip()
    return text[:limit]


def _contains_any_phrase(text, phrases):
    haystack = (text or "").lower()
    return any(phrase in haystack for phrase in phrases)


def _count_phrase_hits(text, phrases):
    haystack = (text or "").lower()
    return sum(1 for phrase in phrases if phrase in haystack)


def _reddit_get_json(url, params=None):
    response = requests.get(url, headers=REDDIT_HEADERS, params=params, timeout=20)
    response.raise_for_status()
    return response.json()


def _search_candidate_posts(keyword, limit=8):
    if not keyword:
        return []
    payload = _reddit_get_json(
        "https://www.reddit.com/search.json",
        params={
            "q": keyword,
            "sort": "relevance",
            "t": "year",
            "limit": limit,
            "type": "link",
        },
    )
    children = payload.get("data", {}).get("children", [])
    posts = []
    for child in children:
        data = child.get("data", {})
        permalink = data.get("permalink")
        url = f"https://www.reddit.com{permalink}" if permalink else data.get("url_overridden_by_dest") or data.get("url")
        if not url:
            continue
        posts.append({
            "title": data.get("title", ""),
            "url": url.split("?")[0],
            "subreddit_name": data.get("subreddit_name_prefixed") or (f"r/{data.get('subreddit')}" if data.get("subreddit") else ""),
            "post_author": data.get("author"),
            "has_media": bool(data.get("is_video") or data.get("is_gallery") or data.get("post_hint") in {"image", "hosted:video", "rich:video", "link"}),
            "media_hint": data.get("post_hint") or ("gallery" if data.get("is_gallery") else "video" if data.get("is_video") else None),
            "score": data.get("score", 0),
            "num_comments": data.get("num_comments", 0),
            "selftext": data.get("selftext", ""),
            "is_self": bool(data.get("is_self")),
        })
    return posts


def _fetch_post_detail(post_url):
    json_url = post_url.rstrip("/") + ".json"
    payload = _reddit_get_json(json_url, params={"limit": 1})
    if not isinstance(payload, list) or not payload:
        return None
    children = payload[0].get("data", {}).get("children", [])
    if not children:
        return None
    data = children[0].get("data", {})
    body = data.get("selftext") or data.get("media_metadata") or ""
    if isinstance(body, dict):
        body = ""
    is_locked = bool(data.get("locked") or data.get("discussion_type") == "CHAT")
    is_archived = bool(data.get("archived"))
    can_comment = None
    if isinstance(data.get("commenting_disabled"), bool):
        can_comment = not data["commenting_disabled"]
    elif isinstance(data.get("comments_enabled"), bool):
        can_comment = data["comments_enabled"]
    return {
        "post_title": _clean_post_text(data.get("title", ""), limit=300),
        "post_body": _clean_post_text(body, limit=3500),
        "post_author": data.get("author"),
        "subreddit_name": data.get("subreddit_name_prefixed") or (f"r/{data.get('subreddit')}" if data.get("subreddit") else ""),
        "post_url": f"https://www.reddit.com{data.get('permalink')}" if data.get("permalink") else post_url,
        "has_media": bool(data.get("is_video") or data.get("is_gallery") or data.get("post_hint") in {"image", "hosted:video", "rich:video", "link"}),
        "media_hint": data.get("post_hint") or ("gallery" if data.get("is_gallery") else "video" if data.get("is_video") else None),
        "num_comments": data.get("num_comments", 0),
        "score": data.get("score", 0),
        "is_locked": is_locked,
        "is_archived": is_archived,
        "can_comment": can_comment,
    }


def _is_brand_review_candidate(post):
    haystack = " ".join([
        post.get("post_title", "") or post.get("title", ""),
        post.get("post_body", "") or post.get("selftext", ""),
    ]).lower()
    subreddit = (post.get("subreddit_name") or "").lower()
    if subreddit in BLOCKED_BRAND_SUBREDDITS:
        return False
    if _contains_any_phrase(haystack, BLOCKED_BRAND_TERMS):
        return False
    if _count_phrase_hits(haystack, BRAND_TOPIC_TERMS) < 1:
        return False
    if _count_phrase_hits(haystack, BRAND_INTENT_TERMS) < 1:
        return False
    if len((post.get("post_body") or post.get("selftext") or "")) < 80 and not post.get("has_media"):
        return False
    return bool(post.get("post_title") or post.get("title"))


def _is_customer_brand_candidate(post):
    haystack = " ".join([
        post.get("post_title", "") or post.get("title", ""),
        post.get("post_body", "") or post.get("selftext", ""),
    ]).lower()
    return _is_brand_review_candidate(post) and _contains_any_phrase(haystack, STRONG_CUSTOMER_BRAND_TERMS)


def _matches_keyword_context(post, keyword):
    if not keyword:
        return _count_phrase_hits(
            " ".join([
                post.get("post_title", "") or post.get("title", ""),
                post.get("post_body", "") or post.get("selftext", ""),
            ]).lower(),
            BRAND_TOPIC_TERMS,
        ) > 0

    haystack = " ".join([
        post.get("post_title", "") or post.get("title", ""),
        post.get("post_body", "") or post.get("selftext", ""),
        post.get("subreddit_name", ""),
    ]).lower()
    keyword_terms = [term for term in re.findall(r"[a-z0-9']+", keyword.lower()) if len(term) >= 4]
    return any(term in haystack for term in keyword_terms) or _count_phrase_hits(haystack, BRAND_TOPIC_TERMS) > 0


def _is_employee_helpful_candidate(post, keyword):
    if post.get("is_locked") or post.get("is_archived") or post.get("can_comment") is False:
        return False
    haystack = " ".join([
        post.get("post_title", "") or post.get("title", ""),
        post.get("post_body", "") or post.get("selftext", ""),
    ]).lower()
    subreddit = (post.get("subreddit_name") or "").lower()
    if subreddit in BLOCKED_BRAND_SUBREDDITS:
        return False
    if _contains_any_phrase(haystack, BLOCKED_BRAND_TERMS):
        return False
    if not _matches_keyword_context(post, keyword):
        return False
    if len((post.get("post_body") or post.get("selftext") or "")) < 60 and not post.get("has_media"):
        return False
    return bool(post.get("post_title") or post.get("title"))


def _approval_prompt_config(draft_kind, brand_name):
    if draft_kind == 'customer_brand':
        return {
            "role": "customer",
            "content_mode": "brand",
            "title_prefix": "Brand-ready customer reply",
            "brief": (
                f"Use this only if the traveler-style recommendation naturally fits the thread. Mention {brand_name} once at most, "
                "keep the tone conversational, and never make it sound like a pitch."
            ),
            "comment_text": (
                f"You may mention {brand_name} only when the thread is directly asking for a wildlife photo tour, safari guide, "
                "or destination recommendation that genuinely fits. Keep the reply helpful first, mention the brand once at most, and skip the brand entirely when it is not directly relevant."
            ),
            "extra_context": (
                f"Write like a real traveler sharing a grounded recommendation. If this post truly fits, mention {brand_name} exactly once by name in a natural way. "
                "Use 1-2 short sentences, stay conversational, lead with useful advice, and mention at least one concrete detail from the post."
            ),
            "require_brand": True,
            "max_words": 32,
            "max_sentences": 2,
        }
    if draft_kind == 'employee_brand':
        return {
            "role": "employee",
            "content_mode": "brand",
            "title_prefix": "Brand-ready employee reply",
            "brief": (
                f"Use this only in a thread where a helpful employee-style reply can naturally mention {brand_name}. "
                "The mention should be brief, directly relevant, and never feel like a pitch."
            ),
            "comment_text": (
                f"You are allowed to mention {brand_name} only if the thread is directly asking for a wildlife photo tour, safari guide, "
                "or destination recommendation that genuinely fits. Keep the reply helpful first, mention the brand once at most, and skip any brand mention when it is not directly relevant."
            ),
            "extra_context": (
                f"Reply like a knowledgeable safari or wildlife photography expert. If this post truly fits, mention {brand_name} exactly once by name in a natural way. "
                "Use 2-3 concise sentences, lead with useful advice, mention at least one concrete detail from the post, and avoid sales language."
            ),
            "require_brand": True,
            "max_words": 52,
            "max_sentences": 3,
        }
    return {
        "role": "employee",
        "content_mode": "expert",
        "title_prefix": "Helpful employee reply",
        "brief": "Use this only for a practical, experience-based reply. Do not mention the brand or turn the comment into promotion.",
        "comment_text": "Reply like a knowledgeable safari or wildlife photography expert. Use 2-3 concise sentences, mention one concrete detail from the post, share practical advice, and do not mention any brand, company, or tour business.",
        "extra_context": "Reply like a knowledgeable safari or wildlife photography expert. Use 2-3 concise sentences, mention at least one concrete detail from the post, share practical advice, and do not mention any brand, company, or tour business.",
        "require_brand": False,
        "max_words": 52,
        "max_sentences": 3,
    }


def _keyword_terms(keyword, post_title=None, post_body=None):
    combined = ' '.join([keyword or '', post_title or '', post_body or '']).lower()
    terms = [term for term in re.findall(r"[a-z0-9']+", combined) if len(term) >= 4]
    seen = []
    for term in terms:
        if term not in seen:
            seen.append(term)
    return seen[:8]


def _memory_category_weight(draft_kind, category):
    weights = {
        'customer_brand': {
            'tone': 6,
            'preferred_phrasing': 5,
            'avoid_phrasing': 6,
            'operations': 4,
            'itinerary_guidance': 3,
        },
        'employee_brand': {
            'tone': 5,
            'preferred_phrasing': 5,
            'avoid_phrasing': 6,
            'operations': 4,
            'itinerary_guidance': 4,
            'lodge_operator_preferences': 3,
        },
        'employee_helpful': {
            'tone': 4,
            'preferred_phrasing': 5,
            'avoid_phrasing': 5,
            'operations': 5,
            'conservation_guidance': 4,
            'itinerary_guidance': 3,
        },
    }
    return weights.get(draft_kind, {}).get(category, 1)


def _select_relevant_business_memory(draft_kind, keyword, post_title, post_body, limit=4):
    terms = _keyword_terms(keyword, post_title, post_body)
    scored = []
    for entry in BusinessMemory.query.filter_by(is_active=True).all():
        score = int(entry.priority or 3) * 10 + _memory_category_weight(draft_kind, entry.category)
        source_review = getattr(entry, 'source_review', None)
        if source_review and source_review.role == draft_kind:
            score += 18
        haystack = f"{entry.title or ''} {entry.content or ''}".lower()
        score += sum(3 for term in terms if term in haystack)
        scored.append((score, entry))
    scored.sort(key=lambda item: (-item[0], -(item[1].priority or 0), item[1].id))
    return [entry for _, entry in scored[:limit]]


def _select_relevant_approved_examples(draft_kind, keyword, post_title, post_body, limit=2):
    terms = _keyword_terms(keyword, post_title, post_body)
    scored = []
    reviews = ApprovalReview.query.filter_by(role=draft_kind).order_by(ApprovalReview.created_at.desc()).limit(20).all()
    for review in reviews:
        if not review.final_comment:
            continue
        score = 10
        haystack = f"{review.post_title or ''} {review.post_body or ''} {review.final_comment or ''}".lower()
        score += sum(2 for term in terms if term in haystack)
        if review.approval_notes:
            score += 1
        scored.append((score, review))
    scored.sort(key=lambda item: (-item[0], -(item[1].created_at.timestamp() if item[1].created_at else 0)))
    return [review for _, review in scored[:limit]]


def _build_learning_context(draft_kind, keyword, post_title, post_body):
    memory_entries = _select_relevant_business_memory(draft_kind, keyword, post_title, post_body)
    approved_examples = _select_relevant_approved_examples(draft_kind, keyword, post_title, post_body)
    chunks = []
    if memory_entries:
        rules = '\n'.join(
            f"- {entry.title}: {entry.content}" for entry in memory_entries
        )
        chunks.append(f"Use these approved business memory rules when relevant:\n{rules}")
    if approved_examples:
        examples = '\n'.join(
            f"- Post: {review.post_title or 'Untitled'}\n  Approved comment: {review.final_comment}"
            for review in approved_examples
        )
        chunks.append(f"Mirror the quality and restraint shown in these approved examples when they fit:\n{examples}")
    return '\n\n'.join(chunks)


def _generate_approval_comment(account, keyword, post_title, post_body, brand_name, draft_kind):
    api_key_setting = Setting.query.filter_by(key='claude_api_key').first()
    if not api_key_setting or not api_key_setting.value:
        return None
    model_setting = Setting.query.filter_by(key='claude_model_comment').first()
    model = model_setting.value if model_setting and model_setting.value else "claude-sonnet-4-20250514"
    config = _approval_prompt_config(draft_kind, brand_name)
    from selenium_agent import _ai_generate_comment
    learning_context = _build_learning_context(draft_kind, keyword, post_title, post_body)
    prompt_context = config["extra_context"]
    if learning_context:
        prompt_context = f"{prompt_context}\n\n{learning_context}"

    comment = _ai_generate_comment(
        post_title,
        post_body,
        keyword,
        account.personality or "You are a helpful safari expert on Reddit.",
        api_key_setting.value,
        model,
        prompt_context,
        None,
        max_words=config["max_words"],
        max_sentences=config["max_sentences"],
    )
    if not comment:
        return None

    normalized_comment = comment.lower()
    exact_brand_markers = [brand_name.lower(), "suzi eszterhas"]
    has_brand_mention = any(marker in normalized_comment for marker in exact_brand_markers)
    if has_brand_mention == config["require_brand"]:
        return comment

    if config["require_brand"]:
        retry_context = prompt_context + f" You MUST include either '{brand_name}' or 'Suzi Eszterhas' exactly once if and only if it fits naturally. Do not use generic substitutes like 'their tours' or 'that company'. If you cannot do that naturally, return nothing."
    else:
        retry_context = prompt_context + f" Do not mention {brand_name}, Suzi Eszterhas, the company, any tours, or any operator by name. If the draft includes any brand mention, return nothing."
    retry_comment = _ai_generate_comment(
        post_title,
        post_body,
        keyword,
        account.personality or "You are a helpful safari expert on Reddit.",
        api_key_setting.value,
        model,
        retry_context,
        None,
        max_words=config["max_words"],
        max_sentences=config["max_sentences"],
    )
    if not retry_comment:
        return None

    normalized_retry = retry_comment.lower()
    has_brand_mention = any(marker in normalized_retry for marker in exact_brand_markers)
    return retry_comment if has_brand_mention == config["require_brand"] else None


def prepare_approval_candidate(account, keyword, brand_name, draft_kind):
    for normalized_term in _ordered_interest_search_terms(account, keyword):
        try:
            candidates = _search_candidate_posts(normalized_term)
        except Exception:
            continue
        for candidate in candidates:
            try:
                detail = _fetch_post_detail(candidate["url"])
            except Exception:
                continue
            if not detail:
                continue
            merged = {**candidate, **detail, "keyword": normalized_term}
            if draft_kind == 'customer_brand':
                qualifies = _is_customer_brand_candidate(merged)
            elif draft_kind == 'employee_brand':
                qualifies = _is_brand_review_candidate(merged)
            else:
                qualifies = _is_employee_helpful_candidate(merged, normalized_term)
            if not qualifies:
                continue
            generated_comment = _generate_approval_comment(
                account,
                normalized_term,
                merged["post_title"],
                merged["post_body"],
                brand_name,
                draft_kind,
            )
            if not generated_comment:
                continue
            merged["generated_comment"] = generated_comment.strip()
            return merged
    return None


def reconcile_managed_actions_with_jobs():
    changed = False
    terminal_statuses = {'done', 'error', 'cancelled'}
    open_actions = ManagedAction.query.filter(ManagedAction.status.in_(OPEN_ACTION_STATUSES)).all()
    for action in open_actions:
        if not action.job_id:
            continue
        job = db.session.get(Job, action.job_id)
        if not job or job.status not in terminal_statuses:
            continue
        action.status = job.status
        action.result_json = job.result_json
        if not action.executed_at:
            action.executed_at = job.updated_at or job.started_at or datetime.now(UTC)
        changed = True
    if changed:
        db.session.commit()
    return changed


def get_open_action_account_ids():
    reconcile_managed_actions_with_jobs()
    return {
        action.account_id
        for action in ManagedAction.query.filter(ManagedAction.status.in_(OPEN_ACTION_STATUSES)).all()
    }


def get_approval_draft_kind(draft):
    params = _safe_json_loads(draft.params_json, {})
    approval_kind = str(params.get('approval_kind') or '').strip().lower()
    if approval_kind in APPROVAL_KINDS:
        return approval_kind
    role = draft.account.role if draft.account else None
    if role == 'customer':
        return 'customer_brand'
    if role in {'employee', 'pro'}:
        return 'employee_brand'
    return 'brand'


def get_pending_approval_draft_account_ids():
    return {
        draft.account_id
        for draft in ApprovalDraft.query.filter_by(status='pending').all()
    }


def get_pending_approval_draft_counts():
    counts = {"customer_brand": 0, "employee_brand": 0, "employee_helpful": 0}
    pending = ApprovalDraft.query.filter_by(status='pending').all()
    for draft in pending:
        approval_kind = get_approval_draft_kind(draft)
        if approval_kind in counts:
            counts[approval_kind] += 1
    return counts


def account_last_activity_map():
    last_activity = {}
    actions = ManagedAction.query.order_by(ManagedAction.created_at.desc()).all()
    for action in actions:
        if action.account_id not in last_activity:
            last_activity[action.account_id] = action.created_at
    return last_activity


def rank_accounts(accounts):
    open_ids = get_open_action_account_ids()
    pending_draft_ids = get_pending_approval_draft_account_ids()
    last_activity = account_last_activity_map()

    def sort_key(account):
        is_open = 1 if account.id in open_ids else 0
        has_pending_draft = 1 if account.id in pending_draft_ids else 0
        has_no_session = 1 if not account.cookies_json else 0
        last_seen = last_activity.get(account.id, datetime(1970, 1, 1))
        return (is_open, has_pending_draft, has_no_session, last_seen, account.id)

    return sorted(accounts, key=sort_key)


def get_eligible_accounts(role):
    accounts = Account.query.filter_by(role=role).order_by(Account.username.asc()).all()
    open_ids = get_open_action_account_ids()
    pending_draft_ids = get_pending_approval_draft_account_ids()
    ranked = rank_accounts(accounts)
    eligible = []
    for account in ranked:
        if account.id in open_ids:
            continue
        if role == "employee" and account.id in pending_draft_ids:
            continue
        eligible.append(account)
    return eligible


def _lane_datetime_from_iso(raw_value):
    if not raw_value:
        return None
    try:
        return datetime.fromisoformat(raw_value)
    except ValueError:
        return None


def _utc_to_local(now_utc):
    return now_utc.replace(tzinfo=UTC_TZ).astimezone(LOCAL_TZ)


def _today_key_from_utc(now_utc):
    return _utc_to_local(now_utc).date().isoformat()


def _effective_lane_config(lane_id, lane_config, runtime, day_key):
    override = (runtime or {}).get("today_override") or {}
    if override and override.get("date") == day_key and isinstance(override.get("config"), dict):
        return dict(override["config"]), True
    return dict(lane_config), False


def _lane_window_bounds(now_utc, effective_config):
    now_local = _utc_to_local(now_utc)
    start_h, start_m = map(int, effective_config["start_time"].split(":"))
    end_h, end_m = map(int, effective_config["end_time"].split(":"))
    start_local = now_local.replace(hour=start_h, minute=start_m, second=0, microsecond=0)
    end_local = now_local.replace(hour=end_h, minute=end_m, second=0, microsecond=0)
    return now_local, start_local, end_local


def _current_local_day_key():
    return datetime.now(LOCAL_TZ).date().isoformat()


def _format_local_clock(value, include_date=False):
    if not value:
        return '—'
    fmt = '%b %d, %H:%M' if include_date else '%H:%M'
    return value.strftime(fmt)


def _format_local_clock_12h(value):
    if not value:
        return '—'
    label = value.strftime('%I:%M %p')
    return label.lstrip('0')


def _humanize_remaining_time(seconds):
    if seconds is None:
        return 'No run queued'
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    parts = []
    if hours:
        parts.append(f"{hours}h")
    if minutes:
        parts.append(f"{minutes}m")
    if not parts:
        parts.append(f"{secs}s")
    return ' '.join(parts)


def _resolve_lane_gap_minutes(effective_config):
    target = max(1, int(effective_config.get("daily_target") or 0))
    manual_gap = max(1, int(effective_config.get("gap_minutes") or 1))
    if not effective_config.get("auto_calculate_gap"):
        return manual_gap
    window_minutes = _minutes_between_times(effective_config["start_time"], effective_config["end_time"])
    if window_minutes <= 0:
        return manual_gap
    return max(1, int(round(window_minutes / target)))


def _lane_available_accounts(lane_id, used_account_ids):
    meta = CAMPAIGN_LANE_META[lane_id]
    accounts = get_eligible_accounts(meta["role"])
    pending_ids = get_pending_approval_draft_account_ids()
    available = []
    for account in accounts:
        if account.id in used_account_ids:
            continue
        if meta["mode"] == "approval" and account.id in pending_ids:
            continue
        available.append(account)
    return available


def create_customer_normal_action(account, strategy, extra_params=None):
    params = {
        "keyword": "",
        "sort_filter": "hot",
        "interact_count": 1,
        "max_words": 16,
        "max_sentences": 1,
        "comment_text": "Leave one helpful, natural comment that fits the thread. Do not mention any brand, product, offer, or company.",
    }
    if extra_params:
        params.update(extra_params)
    return create_planned_action(
        account=account,
        title=f"Customer normal reply for {account.username}",
        action_type=strategy["customer_job_type"],
        content_mode='organic',
        notes="Lane scheduler: normal customer participation with no brand mention.",
        params=params,
    )


def dispatch_due_lane_items(now_utc=None, lane_id=None, queue_callback=None):
    # Compatibility wrapper only: active scheduler/manual campaign generation now
    # flows through the simplified shared-window dispatcher.
    if lane_id is None:
        return dispatch_simplified_campaign(now_utc=now_utc, queue_callback=queue_callback)

    strategy = get_campaign_strategy(persist=True)
    lane_config = get_campaign_lane_config(persist=True)
    lane_state = get_campaign_lane_state(persist=True)
    now_utc = now_utc or datetime.now(UTC)
    day_key = _today_key_from_utc(now_utc)
    now_local_naive = _utc_to_local(now_utc).replace(tzinfo=None)
    window_stats = build_window_stats(strategy)
    lane_ids = [lane_id] if lane_id else list(CAMPAIGN_LANE_META.keys())
    events = []
    state_changed = False

    for current_lane in lane_ids:
        if current_lane not in CAMPAIGN_LANE_META:
            continue
        runtime = reset_lane_day_state(lane_state.get(current_lane) or _default_lane_runtime(), day_key)
        lane_state[current_lane] = runtime
        meta = CAMPAIGN_LANE_META[current_lane]
        effective_config, using_override = _effective_lane_config(current_lane, lane_config[current_lane], runtime, day_key)
        gap_minutes = _resolve_lane_gap_minutes(effective_config)
        now_local, start_local, end_local = _lane_window_bounds(now_utc, effective_config)
        if not effective_config.get("enabled"):
            continue
        if runtime.get("paused_date") == day_key:
            continue
        if effective_config.get("daily_target", 0) <= 0 or runtime.get("run_count", 0) >= effective_config["daily_target"]:
            continue
        if now_local < start_local or now_local > end_local:
            continue
        if meta["content_mode"] == 'brand' and window_stats.get("brand_remaining", 0) <= 0:
            continue

        last_activity_at = _lane_datetime_from_iso(runtime.get("last_run_at")) or _lane_datetime_from_iso(runtime.get("last_attempt_at"))
        if last_activity_at and (now_utc - last_activity_at).total_seconds() < gap_minutes * 60:
            continue

        used_ids = set(runtime.get("used_account_ids") or [])
        candidates = _lane_available_accounts(current_lane, used_ids)
        created_payload = None
        for account in candidates:
            if meta["mode"] == "auto_queue":
                action = create_customer_normal_action(account, strategy)
                queued_action = action
                job = None
                if queue_callback:
                    queued_action, job = queue_callback(action)
                created_payload = {
                    "lane_id": current_lane,
                    "lane_label": meta["short_label"],
                    "kind": "action",
                    "account_id": account.id,
                    "account_username": account.username,
                    "using_override": using_override,
                    "action": queued_action.to_dict(),
                    "job": job.to_dict() if job else None,
                }
            else:
                draft = create_approval_draft(account, strategy, meta["draft_kind"])
                if draft:
                    db.session.flush()
                    created_payload = {
                        "lane_id": current_lane,
                        "lane_label": meta["short_label"],
                        "kind": "draft",
                        "account_id": account.id,
                        "account_username": account.username,
                        "using_override": using_override,
                        "draft": draft.to_dict(),
                    }
            if created_payload:
                runtime["run_count"] = int(runtime.get("run_count") or 0) + 1
                runtime["used_account_ids"] = sorted(used_ids | {account.id})
                runtime["last_run_at"] = now_local_naive.isoformat()
                runtime["last_attempt_at"] = now_local_naive.isoformat()
                if created_payload["kind"] == "draft" and meta["content_mode"] == 'brand':
                    window_stats["brand_remaining"] = max(0, int(window_stats.get("brand_remaining", 0)) - 1)
                events.append(created_payload)
                state_changed = True
                break

        if not created_payload:
            runtime["last_attempt_at"] = now_local_naive.isoformat()
            state_changed = True

    if state_changed:
        save_campaign_lane_state(lane_state)
    return events


def build_campaign_lane_payload(now_utc=None):
    now_utc = now_utc or datetime.now(UTC)
    day_key = _today_key_from_utc(now_utc)
    config = get_campaign_lane_config(persist=True)
    state = get_campaign_lane_state(persist=True)
    payload = {}
    current_local = _utc_to_local(now_utc)
    pending_counts = {key: 0 for key in ["customer", "employee_helpful", "employee_brand"]}
    for draft in ApprovalDraft.query.filter_by(status='pending').all():
        kind = get_approval_draft_kind(draft)
        bucket = "customer" if kind == "customer_brand" else kind if kind in pending_counts else None
        if bucket:
            pending_counts[bucket] += 1

    for lane_id, meta in CAMPAIGN_LANE_META.items():
        runtime = reset_lane_day_state(state.get(lane_id) or _default_lane_runtime(), day_key)
        effective_config, using_override = _effective_lane_config(lane_id, config[lane_id], runtime, day_key)
        gap_minutes = _resolve_lane_gap_minutes(effective_config)
        now_local, start_local, end_local = _lane_window_bounds(now_utc, effective_config)
        last_run_at = _lane_datetime_from_iso(runtime.get("last_run_at"))
        last_attempt_at = _lane_datetime_from_iso(runtime.get("last_attempt_at"))
        next_run_at = None
        next_run_local = None
        time_until_next_run_seconds = None
        time_until_next_run_label = 'No run queued'
        if effective_config.get("enabled") and runtime.get("paused_date") != day_key and runtime.get("run_count", 0) < effective_config.get("daily_target", 0):
            if now_local < start_local:
                next_run_local = start_local
            elif start_local <= now_local <= end_local:
                anchor = last_run_at or last_attempt_at
                candidate_local = now_local.replace(tzinfo=None) if not anchor else anchor + timedelta(minutes=gap_minutes)
                next_run_local = max(candidate_local, now_local.replace(tzinfo=None))
                end_local_naive = end_local.replace(tzinfo=None)
                if next_run_local > end_local_naive:
                    next_run_local = None
            if next_run_local:
                next_run_at = next_run_local.replace(tzinfo=LOCAL_TZ).astimezone(UTC_TZ).replace(tzinfo=None)
                time_until_next_run_seconds = max(0, int((next_run_local - now_local.replace(tzinfo=None)).total_seconds()))
                if now_local < start_local:
                    time_until_next_run_label = f"Starts in {_humanize_remaining_time(time_until_next_run_seconds)}"
                else:
                    time_until_next_run_label = f"In {_humanize_remaining_time(time_until_next_run_seconds)}"
            elif now_local > end_local:
                time_until_next_run_label = 'Window ended for today'
        elif not effective_config.get("enabled"):
            time_until_next_run_label = 'Lane disabled'
        elif runtime.get("paused_date") == day_key:
            time_until_next_run_label = 'Paused today'
        elif runtime.get("run_count", 0) >= effective_config.get("daily_target", 0):
            time_until_next_run_label = 'Daily target reached'
        available_accounts = _lane_available_accounts(lane_id, set(runtime.get("used_account_ids") or []))
        payload[lane_id] = {
            "id": lane_id,
            "label": meta["label"],
            "short_label": meta["short_label"],
            "description": meta["description"],
            "mode": meta["mode"],
            "defaults": config[lane_id],
            "effective": effective_config,
            "today_override": runtime.get("today_override"),
            "using_override": using_override,
            "paused_today": runtime.get("paused_date") == day_key,
            "run_count_today": runtime.get("run_count", 0),
            "remaining_today": max(0, int(effective_config.get("daily_target", 0)) - int(runtime.get("run_count", 0))),
            "used_accounts_today": [account.username for account in Account.query.filter(Account.id.in_(runtime.get("used_account_ids") or [])).all()] if runtime.get("used_account_ids") else [],
            "available_accounts": len(available_accounts),
            "pending_approvals": pending_counts.get(meta.get("approval_bucket")) if meta.get("approval_bucket") else None,
            "window_active": start_local <= now_local <= end_local,
            "window_start": start_local.astimezone(UTC_TZ).replace(tzinfo=None).isoformat(),
            "window_end": end_local.astimezone(UTC_TZ).replace(tzinfo=None).isoformat(),
            "window_label": f"{_format_local_clock(start_local)} - {_format_local_clock(end_local)}",
            "current_local_time": current_local.replace(tzinfo=None).isoformat(),
            "current_local_time_label": _format_local_clock(current_local),
            "gap_minutes": gap_minutes,
            "last_run_at": last_run_at.isoformat() if last_run_at else None,
            "last_attempt_at": last_attempt_at.isoformat() if last_attempt_at else None,
            "next_run_at": next_run_at.isoformat() if next_run_at else None,
            "next_run_label": _format_local_clock(next_run_local, include_date=bool(next_run_local and next_run_local.date() != current_local.date())) if next_run_local else 'No run queued',
            "time_until_next_run_seconds": time_until_next_run_seconds,
            "time_until_next_run_label": time_until_next_run_label,
        }
    return payload


def build_window_stats(strategy=None):
    strategy = strategy or get_campaign_strategy()
    limit = strategy["rolling_window_actions"]
    actions_query = ManagedAction.query.filter(ManagedAction.status.in_(WINDOW_ACTION_STATUSES))
    reset_at = get_window_reset_at()
    if reset_at:
        actions_query = actions_query.filter(ManagedAction.created_at >= reset_at)
    actions = actions_query.order_by(ManagedAction.created_at.desc()).all()

    considered = []
    maintenance_count = 0
    for action in actions:
        if action.content_mode == 'maintenance':
            maintenance_count += 1
            continue
        if len(considered) >= limit:
            break
        considered.append(action)

    organic = sum(1 for action in considered if action.content_mode == 'organic')
    expert = sum(1 for action in considered if action.content_mode == 'expert')
    brand = sum(1 for action in considered if action.content_mode == 'brand')
    customer_brand = sum(1 for action in considered if action.content_mode == 'brand' and action.account and action.account.role == 'customer')
    employee_brand = sum(1 for action in considered if action.content_mode == 'brand' and action.account and action.account.role == 'employee')
    customer_organic = sum(1 for action in considered if action.account and action.account.role == 'customer' and action.content_mode in {'organic', 'brand'})
    remaining = max(0, strategy["max_brand_mentions_per_window"] - brand)
    customer_brand_ratio = (customer_brand / customer_organic) if customer_organic else 0.0

    return {
        "window_size": limit,
        "considered": len(considered),
        "organic": organic,
        "expert": expert,
        "brand": brand,
        "customer_brand": customer_brand,
        "employee_brand": employee_brand,
        "customer_brand_ratio": customer_brand_ratio,
        "customer_brand_target": strategy["customer_brand_soft_ratio"],
        "maintenance": maintenance_count,
        "brand_remaining": remaining,
        "brand_limit": strategy["max_brand_mentions_per_window"],
        "reset_at": reset_at.isoformat() if reset_at else None,
    }


def can_create_brand_draft(strategy=None):
    strategy = strategy or get_campaign_strategy()
    if not strategy.get("brand_mention_requires_approval", True):
        return False
    if ApprovalDraft.query.filter_by(status='pending').count() > 0:
        return False
    return build_window_stats(strategy)["brand_remaining"] > 0


def can_create_customer_brand_draft(strategy=None):
    strategy = strategy or get_campaign_strategy()
    window = build_window_stats(strategy)
    pending_counts = get_pending_approval_draft_counts()
    if window["brand_remaining"] <= 0:
        return False
    if pending_counts["customer_brand"] >= strategy["max_pending_customer_brand_drafts"]:
        return False
    return window["customer_brand_ratio"] < strategy["customer_brand_soft_ratio"]


def can_create_employee_brand_draft(strategy=None):
    strategy = strategy or get_campaign_strategy()
    window = build_window_stats(strategy)
    pending_counts = get_pending_approval_draft_counts()
    if window["brand_remaining"] <= 0:
        return False
    return pending_counts["employee_brand"] < strategy["max_pending_employee_brand_drafts"]


def explain_brand_draft_availability(role, strategy=None):
    strategy = strategy or get_campaign_strategy()
    window = build_window_stats(strategy)
    pending_counts = get_pending_approval_draft_counts()
    accounts = get_eligible_accounts(role)

    if not strategy.get("brand_mention_requires_approval", True):
        return {
            "available": False,
            "reason": "Brand approvals are disabled in strategy settings.",
            "code": "approval_disabled",
        }
    if window["brand_remaining"] <= 0:
        return {
            "available": False,
            "reason": "Rolling window brand limit reached for now.",
            "code": "brand_limit_reached",
        }
    if not accounts:
        return {
            "available": False,
            "reason": f"No eligible {role} accounts are ready for a brand review round.",
            "code": "no_eligible_accounts",
        }
    if role == 'customer':
        if pending_counts["customer_brand"] >= strategy["max_pending_customer_brand_drafts"]:
            return {
                "available": False,
                "reason": "A customer brand draft is already pending review.",
                "code": "pending_customer_draft_exists",
            }
        if window["customer_brand_ratio"] >= strategy["customer_brand_soft_ratio"]:
            return {
                "available": False,
                "reason": f"Customer brand activity is already at {round(window['customer_brand_ratio'] * 100)}%, meeting the soft {round(strategy['customer_brand_soft_ratio'] * 100)}% cap.",
                "code": "customer_ratio_cap_reached",
            }
        return {
            "available": True,
            "reason": "Customer brand reviews are available if a strong recommendation-style safari thread is found.",
            "code": "available",
        }

    if pending_counts["employee_brand"] >= strategy["max_pending_employee_brand_drafts"]:
        return {
            "available": False,
            "reason": "An employee brand draft is already pending review.",
            "code": "pending_employee_draft_exists",
        }
    return {
        "available": True,
        "reason": "Employee brand reviews are available if a strong safari planning thread is found.",
        "code": "available",
    }


def create_planned_action(account, title, action_type, content_mode, notes, params, approval_state='not_required'):
    action = ManagedAction(
        account_id=account.id,
        title=title,
        action_type=action_type,
        content_mode=content_mode,
        status='planned',
        approval_state=approval_state,
        keyword=params.get('keyword') or None,
        notes=notes,
        params_json=json.dumps(params),
    )
    db.session.add(action)
    db.session.flush()
    return action


def create_approval_draft(account, strategy, draft_kind, extra_params=None):
    brand_name = strategy["brand_name"]
    keyword = choose_primary_keyword(account)
    config = _approval_prompt_config(draft_kind, brand_name)
    candidate = prepare_approval_candidate(account, keyword, brand_name, draft_kind)
    if not candidate:
        return None
    params = {
        "approval_kind": draft_kind,
        "planned_content_mode": config["content_mode"],
        "keyword": candidate["keyword"],
        "sort_filter": "hot",
        "interact_count": 1,
        "target_post_url": candidate["post_url"],
        "target_post_title": candidate["post_title"],
        "approved_comment": candidate["generated_comment"],
        "max_words": config["max_words"],
        "max_sentences": config["max_sentences"],
        "comment_text": config["comment_text"],
    }
    if extra_params:
        params.update(extra_params)
    draft = ApprovalDraft(
        account_id=account.id,
        title=f"{config['title_prefix']} for {account.username}",
        job_type=strategy["customer_job_type"] if account.role == 'customer' else strategy["employee_job_type"],
        keyword=candidate["keyword"] or None,
        thread_url=candidate["post_url"],
        post_title=candidate["post_title"],
        post_body=candidate["post_body"],
        post_author=candidate["post_author"],
        subreddit_name=candidate["subreddit_name"],
        has_media=candidate["has_media"],
        media_hint=candidate["media_hint"],
        brief=config["brief"],
        generated_comment=candidate["generated_comment"],
        edited_comment=candidate["generated_comment"],
        status='pending',
        params_json=json.dumps(params),
        prepared_at=datetime.now(UTC),
    )
    db.session.add(draft)
    return draft


def run_manual_planning_round(queue_callback=None):
    strategy = get_campaign_strategy(persist=True)
    created_actions = []
    created_drafts = []
    draft_outcomes = []
    auto_queued_actions = []
    auto_queue_errors = []

    customer_accounts = get_eligible_accounts('customer')[:strategy["planner_customer_jobs_per_round"]]
    for account in customer_accounts:
        params = {
            "keyword": "",
            "sort_filter": "hot",
            "interact_count": 1,
            "max_words": 16,
            "max_sentences": 1,
            "comment_text": "Leave one helpful, natural comment that fits the thread. Do not mention any brand, product, offer, or company.",
        }
        created_actions.append(create_planned_action(
            account=account,
            title=f"Customer organic reply for {account.username}",
            action_type=strategy["customer_job_type"],
            content_mode='organic',
            notes="Interest-led customer participation with no brand mention.",
            params=params,
        ))

    employee_accounts = get_eligible_accounts('employee')[:strategy["planner_employee_jobs_per_round"]]
    for account in employee_accounts:
        draft = create_approval_draft(account, strategy, 'employee_helpful')
        if draft:
            created_drafts.append(draft)
            draft_outcomes.append({"role": "employee", "draft_type": "employee_helpful", "status": "created", "reason": "Created employee helpful draft for review."})
        else:
            draft_outcomes.append({"role": "employee", "draft_type": "employee_helpful", "status": "skipped", "reason": "No grounded employee-helpful thread was found this round."})

    if can_create_employee_brand_draft(strategy):
        employee_draft_ids = {draft.account_id for draft in created_drafts if draft.account and draft.account.role == 'employee'}
        remaining_employees = [account for account in get_eligible_accounts('employee') if account.id not in employee_draft_ids]
        if remaining_employees:
            draft = create_approval_draft(remaining_employees[0], strategy, 'employee_brand')
            if draft:
                created_drafts.append(draft)
                draft_outcomes.append({"role": "employee", "draft_type": "employee_brand", "status": "created", "reason": "Created employee brand draft for review."})
            else:
                draft_outcomes.append({"role": "employee", "draft_type": "employee_brand", "status": "skipped", "reason": "No strong safari planning thread produced an employee brand draft this round."})
    else:
        explanation = explain_brand_draft_availability('employee', strategy)
        draft_outcomes.append({"role": "employee", "draft_type": "employee_brand", "status": "skipped", "reason": explanation["reason"], "code": explanation["code"]})

    if can_create_customer_brand_draft(strategy):
        customer_draft_ids = {draft.account_id for draft in created_drafts if draft.account and draft.account.role == 'customer'}
        remaining_customers = [account for account in get_eligible_accounts('customer') if account.id not in {item.account_id for item in created_actions} and account.id not in customer_draft_ids]
        if remaining_customers:
            draft = create_approval_draft(remaining_customers[0], strategy, 'customer_brand')
            if draft:
                created_drafts.append(draft)
                draft_outcomes.append({"role": "customer", "draft_type": "customer_brand", "status": "created", "reason": "Created customer brand draft for review."})
            else:
                draft_outcomes.append({"role": "customer", "draft_type": "customer_brand", "status": "skipped", "reason": "No recommendation-style safari thread produced a natural customer brand mention this round."})
    else:
        explanation = explain_brand_draft_availability('customer', strategy)
        draft_outcomes.append({"role": "customer", "draft_type": "customer_brand", "status": "skipped", "reason": explanation["reason"], "code": explanation["code"]})

    planned_at = datetime.now(UTC)
    set_last_planning_round(planned_at)
    db.session.commit()

    if queue_callback:
        for action in created_actions:
            try:
                queued_action, job = queue_callback(action)
                auto_queued_actions.append({"action": queued_action.to_dict(), "job": job.to_dict()})
            except ValueError as exc:
                auto_queue_errors.append({"action_id": action.id, "title": action.title, "error": str(exc)})

    return {
        "created_actions": [db.session.get(ManagedAction, action.id).to_dict() for action in created_actions],
        "created_drafts": [draft.to_dict() for draft in created_drafts],
        "draft_outcomes": draft_outcomes,
        "auto_queued_actions": auto_queued_actions,
        "auto_queue_errors": auto_queue_errors,
        "planned_at": planned_at.isoformat(),
    }


def build_planner_recommendation(strategy=None):
    strategy = strategy or get_campaign_strategy()
    eligible_customers = get_eligible_accounts('customer')
    eligible_employees = get_eligible_accounts('employee')
    window = build_window_stats(strategy)
    employee_availability = explain_brand_draft_availability('employee', strategy)
    customer_availability = explain_brand_draft_availability('customer', strategy)
    return {
        "customer_slots": min(strategy["planner_customer_jobs_per_round"], len(eligible_customers)),
        "employee_slots": min(strategy["planner_employee_jobs_per_round"], len(eligible_employees)),
        "employee_brand_draft_available": can_create_employee_brand_draft(strategy) and len(eligible_employees) > strategy["planner_employee_jobs_per_round"],
        "employee_helpful_review_expected": min(strategy["planner_employee_jobs_per_round"], len(eligible_employees)),
        "customer_brand_draft_available": can_create_customer_brand_draft(strategy) and len(eligible_customers) > strategy["planner_customer_jobs_per_round"],
        "eligible_customers": len(eligible_customers),
        "eligible_employees": len(eligible_employees),
        "customer_brand_ratio": window["customer_brand_ratio"],
        "customer_brand_target": strategy["customer_brand_soft_ratio"],
        "employee_brand_reason": employee_availability["reason"],
        "customer_brand_reason": customer_availability["reason"],
    }


def build_campaign_dashboard_payload():
    reconcile_managed_actions_with_jobs()
    strategy = get_campaign_strategy(persist=True)
    campaign_config = get_simplified_campaign_config(persist=True)
    campaign_state = build_simplified_campaign_state(config=campaign_config)
    campaign_runtime = get_simplified_campaign_runtime(config=campaign_config, persist=True)
    accounts = Account.query.order_by(Account.username.asc()).all()
    lanes = build_campaign_lane_payload()
    role_counts = {
        "customer": sum(1 for account in accounts if account.role == 'customer'),
        "employee": sum(1 for account in accounts if account.role == 'employee'),
        "inactive": sum(1 for account in accounts if account.role == 'inactive'),
    }
    open_actions = ManagedAction.query.filter(ManagedAction.status.in_(OPEN_ACTION_STATUSES)) \
        .order_by(ManagedAction.created_at.desc()).all()
    recent_actions = ManagedAction.query.filter(ManagedAction.status.in_(['done', 'error', 'cancelled'])) \
        .order_by(ManagedAction.updated_at.desc()).limit(12).all()
    pending_approvals = ApprovalDraft.query.filter_by(status='pending').order_by(ApprovalDraft.created_at.desc()).all()
    approval_groups = {
        "customer": [draft.to_dict() for draft in pending_approvals if get_approval_draft_kind(draft) == 'customer_brand'],
        "employee_helpful": [draft.to_dict() for draft in pending_approvals if get_approval_draft_kind(draft) == 'employee_helpful'],
        "employee_brand": [draft.to_dict() for draft in pending_approvals if get_approval_draft_kind(draft) == 'employee_brand'],
    }
    active_lanes = sum(1 for lane in lanes.values() if lane["effective"].get("enabled"))
    stable_customer_ids = campaign_runtime.get("customer_normal_eligible_account_ids") or []
    campaign_window_targets = _campaign_window_targets(campaign_config, eligible_customers=[object() for _ in stable_customer_ids])
    campaign_window_stats = {
        **campaign_window_targets,
        "customer_normal_created": int(campaign_runtime["created_counts"].get("customer_normal", 0) or 0),
        "customer_brand_created": int(campaign_runtime["created_counts"].get("customer_brand", 0) or 0),
        "employee_helpful_created": int(campaign_runtime["created_counts"].get("employee_helpful", 0) or 0),
        "employee_brand_created": int(campaign_runtime["created_counts"].get("employee_brand", 0) or 0),
    }

    return {
        "strategy": strategy,
        "lanes": lanes,
        "approval_digest_time": _get_setting_value("approval_digest_time", "08:00"),
        "campaign_config": campaign_config,
        "campaign_state": campaign_state,
        "accounts": [account.to_dict() for account in accounts],
        "planned_actions": [action.to_dict() for action in open_actions],
        "recent_actions": [action.to_dict() for action in recent_actions],
        "approval_drafts": [draft.to_dict() for draft in pending_approvals],
        "approval_groups": approval_groups,
        "stats": {
            "total_accounts": len(accounts),
            "role_counts": role_counts,
            "planned_actions": len([action for action in open_actions if action.status == 'planned']),
            "queued_actions": len([action for action in open_actions if action.status == 'queued']),
            "running_actions": len([action for action in open_actions if action.status == 'running']),
            "pending_approvals": len(pending_approvals),
            "active_lanes": active_lanes,
            "window": build_window_stats(strategy),
            "campaign_window": campaign_window_stats,
        },
    }


def normalize_account_role(role):
    normalized = str(role or '').strip().lower()
    if normalized == 'pro':
        return 'employee'
    return normalized


def account_role_is_valid(role):
    return normalize_account_role(role) in ACCOUNT_ROLES
