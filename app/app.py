import glob
import os
import re
import smtplib
import datetime as datetime_module
from difflib import SequenceMatcher
from flask import Flask, jsonify, request, render_template, redirect, session, url_for, g
from flask_cors import CORS
import jwt as pyjwt
from dotenv import load_dotenv
from models import db, User, Account, Proxy, Job, Log, Setting, CronJob, CommentedPost, SearchHistory, ManagedAction, ApprovalDraft, ApprovalReview, BusinessMemory, MemorySuggestion, cipher_suite, get_encryption_key
import threading
from selenium_agent import login_to_reddit, stop_driver, run_job, ai_generate_interests_tags, has_account_commented_post, normalize_commented_post_url
import time
import requests as http_requests
import json
from datetime import UTC, datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
from email_service import get_email_settings, normalize_digest_time, normalize_recipient_emails, send_email_message, send_scheduled_approval_digest
from interest_utils import normalize_interest_csv, normalize_interest_list
from campaign_service import (
    CAMPAIGN_LANE_META,
    account_role_is_valid,
    build_campaign_dashboard_payload,
    dispatch_simplified_campaign,
    clear_campaign_lane_override,
    get_campaign_strategy,
    get_simplified_campaign_enabled,
    normalize_account_role,
    reconcile_managed_actions_with_jobs,
    reset_campaign_window,
    save_simplified_campaign_config,
    save_campaign_lane_config,
    save_campaign_lane_override,
    save_campaign_strategy,
    set_simplified_campaign_enabled,
    set_campaign_lane_pause,
    rotate_account_interest,
)

load_dotenv()

JWT_SECRET = (
    os.environ.get('JWT_SECRET_KEY')
    or os.environ.get('JWT_SECRET')
    or os.environ.get('FLASK_SECRET_KEY')
    or os.environ.get('SECRET_KEY')
    or get_encryption_key().decode()
)
JWT_EXPIRY_HOURS = 24


def create_jwt_token(user):
    payload = {
        'user_id': user.id,
        'username': user.username,
        'role': user.role,
        'exp': datetime_module.datetime.now(datetime_module.UTC) + datetime_module.timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm='HS256')


def decode_jwt_token(token):
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except pyjwt.ExpiredSignatureError:
        return None
    except pyjwt.InvalidTokenError:
        return None


def _auth_user_payload(user):
    if not user:
        return None
    if isinstance(user, dict):
        return {
            'id': user['id'],
            'username': user['username'],
            'email': user.get('email', ''),
            'role': user['role'],
        }
    return {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'role': user.role,
    }

# ─── Flag Dictionary ────────────────────────────────────────────────────────
COUNTRY_FLAGS = {
    "Afghanistan": "🇦🇫", "Albania": "🇦🇱", "Algeria": "🇩🇿", "Andorra": "🇦🇩", "Angola": "🇦🇴", "Antigua and Barbuda": "🇦🇬",
    "Argentina": "🇦🇷", "Armenia": "🇦🇲", "Australia": "🇦🇺", "Austria": "🇦🇹", "Azerbaijan": "🇦🇿", "Bahamas": "🇧🇸",
    "Bahrain": "🇧🇭", "Bangladesh": "🇧🇩", "Barbados": "🇧🇧", "Belarus": "🇧🇾", "Belgium": "🇧🇪", "Belize": "🇧🇿",
    "Benin": "🇧🇯", "Bhutan": "🇧🇹", "Bolivia": "🇧🇴", "Bosnia and Herzegovina": "🇧🇦", "Botswana": "🇧🇼", "Brazil": "🇧🇷",
    "Brunei": "🇧🇳", "Bulgaria": "🇧🇬", "Burkina Faso": "🇧🇫", "Burundi": "🇧🇮", "Cabo Verde": "🇨🇻", "Cambodia": "🇰🇭",
    "Cameroon": "🇨🇲", "Canada": "🇨🇦", "Central African Republic": "🇨🇫", "Chad": "🇹🇩", "Chile": "🇨🇱", "China": "🇨🇳",
    "Colombia": "🇨🇴", "Comoros": "🇰🇲", "Congo": "🇨🇬", "Costa Rica": "🇨🇷", "Croatia": "🇭🇷", "Cuba": "🇨🇺",
    "Cyprus": "🇨🇾", "Czech Republic": "🇨🇿", "Denmark": "🇩🇰", "Djibouti": "🇩🇯", "Dominica": "🇩🇲", "Dominican Republic": "🇩🇴",
    "Ecuador": "🇪🇨", "Egypt": "🇪🇬", "El Salvador": "🇸🇻", "Equatorial Guinea": "🇬🇶", "Eritrea": "🇪🇷", "Estonia": "🇪🇪",
    "Eswatini": "🇸🇿", "Ethiopia": "🇪🇹", "Fiji": "🇫🇯", "Finland": "🇫🇮", "France": "🇫🇷", "Gabon": "🇬🇦",
    "Gambia": "🇬🇲", "Georgia": "🇬🇪", "Germany": "🇩🇪", "Ghana": "🇬🇭", "Greece": "🇬🇷", "Grenada": "🇬🇩",
    "Guatemala": "🇬🇹", "Guinea": "🇬🇳", "Guinea-Bissau": "🇬🇼", "Guyana": "🇬🇾", "Haiti": "🇭🇹", "Honduras": "🇭🇳",
    "Hungary": "🇭🇺", "Iceland": "🇮🇸", "India": "🇮🇳", "Indonesia": "🇮🇩", "Iran": "🇮🇷", "Iraq": "🇮🇶",
    "Ireland": "🇮🇪", "Israel": "🇮🇱", "Italy": "🇮🇹", "Jamaica": "🇯🇲", "Japan": "🇯🇵", "Jordan": "🇯🇴",
    "Kazakhstan": "🇰🇿", "Kenya": "🇰🇪", "Kiribati": "🇰🇮", "Korea, North": "🇰🇵", "Korea, South": "🇰🇷", "Kosovo": "🇽🇰",
    "Kuwait": "🇰🇼", "Kyrgyzstan": "🇰🇬", "Laos": "🇱🇦", "Latvia": "🇱🇻", "Lebanon": "🇱🇧", "Lesotho": "🇱🇸",
    "Liberia": "🇱🇷", "Libya": "🇱🇾", "Liechtenstein": "🇱🇮", "Lithuania": "🇱🇹", "Luxembourg": "🇱🇺", "Madagascar": "🇲🇬",
    "Malawi": "🇲🇼", "Malaysia": "🇲🇾", "Maldives": "🇲🇻", "Mali": "🇲🇱", "Malta": "🇲🇹", "Marshall Islands": "🇲🇭",
    "Mauritania": "🇲🇷", "Mauritius": "🇲🇺", "Mexico": "🇲🇽", "Micronesia": "🇫🇲", "Moldova": "🇲🇩", "Monaco": "🇲🇨",
    "Mongolia": "🇲🇳", "Montenegro": "🇲🇪", "Morocco": "🇲🇦", "Mozambique": "🇲🇿", "Myanmar": "🇲🇲", "Namibia": "🇳🇦",
    "Nauru": "🇳🇷", "Nepal": "🇳🇵", "Netherlands": "🇳🇱", "New Zealand": "🇳🇿", "Nicaragua": "🇳🇮", "Niger": "🇳🇪",
    "Nigeria": "🇳🇬", "North Macedonia": "🇲🇰", "Norway": "🇳🇴", "Oman": "🇴🇲", "Pakistan": "🇵🇰", "Palau": "🇵🇼",
    "Panama": "🇵🇦", "Papua New Guinea": "🇵🇬", "Paraguay": "🇵🇾", "Peru": "🇵🇪", "Philippines": "🇵🇭", "Poland": "🇵🇱",
    "Portugal": "🇵🇹", "Qatar": "🇶🇦", "Romania": "🇷🇴", "Russia": "🇷🇺", "Rwanda": "🇷🇼", "Saint Kitts and Nevis": "🇰🇳",
    "Saint Lucia": "🇱🇨", "Saint Vincent and the Grenadines": "🇻🇨", "Samoa": "🇼🇸", "San Marino": "🇸🇲", "Sao Tome and Principe": "🇸🇹",
    "Saudi Arabia": "🇸🇦", "Senegal": "🇸🇳", "Serbia": "🇷🇸", "Seychelles": "🇸🇨", "Sierra Leone": "🇸🇱", "Singapore": "🇸🇬",
    "Slovakia": "🇸🇰", "Slovenia": "🇸🇮", "Solomon Islands": "🇸🇧", "Somalia": "🇸🇴", "South Africa": "🇿🇦", "South Sudan": "🇸🇸",
    "Spain": "🇪🇸", "Sri Lanka": "🇱🇰", "Sudan": "🇸🇩", "Suriname": "🇸🇷", "Sweden": "🇸🇪", "Switzerland": "🇨🇭",
    "Syria": "🇸🇾", "Taiwan": "🇹🇼", "Tajikistan": "🇹🇯", "Tanzania": "🇹🇿", "Thailand": "🇹🇭", "Timor-Leste": "🇹🇱",
    "Togo": "🇹🇬", "Tonga": "🇹🇴", "Trinidad and Tobago": "🇹🇹", "Tunisia": "🇹🇳", "Turkey": "🇹🇷", "Turkmenistan": "🇹🇲",
    "Tuvalu": "🇹🇻", "Uganda": "🇺🇬", "Ukraine": "🇺🇦", "United Arab Emirates": "🇦🇪", "United Kingdom": "🇬🇧", "United States": "🇺🇸",
    "Uruguay": "🇺🇾", "Uzbekistan": "🇺🇿", "Vanuatu": "🇻🇺", "Vatican City": "🇻🇦", "Venezuela": "🇻🇪", "Vietnam": "🇻🇳",
    "Yemen": "🇾🇪", "Zambia": "🇿🇲", "Zimbabwe": "🇿🇼"
}

def get_flag(country_name):
    # Returns 🚩 if country not found in dictionary
    return COUNTRY_FLAGS.get(country_name, "🚩")

basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
database_url = os.environ.get('DATABASE_URL')
if database_url and database_url.startswith('postgres://'):
    database_url = database_url.replace('postgres://', 'postgresql://', 1)
if not database_url:
    raise RuntimeError("DATABASE_URL environment variable is required. Set it in .env file.")
app.config['SQLALCHEMY_DATABASE_URI'] = database_url
if database_url and 'postgresql' in database_url:
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'pool_size': 10,
        'pool_recycle': 300,
        'pool_pre_ping': True,
        'max_overflow': 20,
    }
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY') or os.environ.get('SECRET_KEY') or get_encryption_key().decode()

_db_uri = app.config['SQLALCHEMY_DATABASE_URI']
print(f"[DB] Connected to: {_db_uri.split('@')[-1] if '@' in _db_uri else '(check DATABASE_URL)'}")

CORS(
    app,
    resources={r"/*": {"origins": ['http://localhost:5173', 'http://127.0.0.1:5173']}},
    supports_credentials=True,
)

db.init_app(app)
CUSTOMER_JOB_COOLDOWN_SECONDS = 60
_customer_job_lock = threading.Lock()
_customer_job_state = {'last_finished_at': None}
_managed_action_queue_lock = threading.Lock()

# ─── Migrations ───────────────────────────────────────────────────────────────
def apply_migrations():
    with app.app_context():
        import sqlalchemy as sa
        engine = db.engine
        inspector = sa.inspect(engine)
        db.create_all()

        existing = inspector.get_table_names()
        account_cols = [c['name'] for c in inspector.get_columns('account')] if 'account' in existing else []
        proxy_cols   = [c['name'] for c in inspector.get_columns('proxy')]   if 'proxy'   in existing else []
        job_cols     = [c['name'] for c in inspector.get_columns('job')]     if 'job'     in existing else []

        def add_col(table, col, type_def):
            with engine.connect() as conn:
                conn.execute(sa.text(f"ALTER TABLE {table} ADD COLUMN {col} {type_def}"))
                conn.commit()
                print(f"Migration: added {col} to {table}")

        if 'proxy_id'     not in account_cols: add_col('account', 'proxy_id',     'INTEGER REFERENCES proxy(id)')
        if 'cookies_json' not in account_cols: add_col('account', 'cookies_json', 'TEXT')
        if 'personality'  not in account_cols: add_col('account', 'personality',  'TEXT')
        if 'persona_name' not in account_cols: add_col('account', 'persona_name', 'TEXT')
        if 'interests'    not in account_cols: add_col('account', 'interests',    'TEXT')
        if 'role'         not in account_cols: add_col('account', 'role',         "TEXT DEFAULT 'inactive'")
        if 'proxy_type'   not in proxy_cols:   add_col('proxy',   'proxy_type',   "TEXT DEFAULT 'manual'")
        if 'status'       not in proxy_cols:   add_col('proxy',   'status',       "TEXT DEFAULT 'active'")
        if 'location'     not in proxy_cols:   add_col('proxy',   'location',     "TEXT")

        approval_cols = [c['name'] for c in inspector.get_columns('approval_draft')] if 'approval_draft' in existing else []
        if 'approval_draft' in existing:
            if 'post_title' not in approval_cols: add_col('approval_draft', 'post_title', 'TEXT')
            if 'post_body' not in approval_cols: add_col('approval_draft', 'post_body', 'TEXT')
            if 'post_author' not in approval_cols: add_col('approval_draft', 'post_author', 'TEXT')
            if 'subreddit_name' not in approval_cols: add_col('approval_draft', 'subreddit_name', 'TEXT')
            if 'has_media' not in approval_cols: add_col('approval_draft', 'has_media', 'BOOLEAN DEFAULT FALSE')
            if 'media_hint' not in approval_cols: add_col('approval_draft', 'media_hint', 'TEXT')
            if 'generated_comment' not in approval_cols: add_col('approval_draft', 'generated_comment', 'TEXT')
            if 'edited_comment' not in approval_cols: add_col('approval_draft', 'edited_comment', 'TEXT')
            if 'approval_notes' not in approval_cols: add_col('approval_draft', 'approval_notes', 'TEXT')
            if 'digest_sent_at' not in approval_cols: add_col('approval_draft', 'digest_sent_at', 'TIMESTAMP')
            if 'prepared_at' not in approval_cols: add_col('approval_draft', 'prepared_at', 'TIMESTAMP')

        normalized_roles = False
        for account in Account.query.all():
            if account.role == 'pro':
                account.role = 'employee'
                normalized_roles = True
            elif account.role not in {'customer', 'employee', 'inactive'}:
                account.role = 'inactive'
                normalized_roles = True

        review_labels_updated = False
        for review in ApprovalReview.query.all():
            if review.role == 'pro_brand':
                review.role = 'employee_brand'
                review_labels_updated = True
            elif review.role == 'pro_helpful':
                review.role = 'employee_helpful'
                review_labels_updated = True

        renamed_titles = False
        for action in ManagedAction.query.all():
            if action.title:
                updated_title = action.title.replace('Pro helpful reply', 'Helpful employee reply').replace('Brand-ready pro reply', 'Brand-ready employee reply')
                if updated_title != action.title:
                    action.title = updated_title
                    renamed_titles = True
            if action.notes:
                updated_notes = action.notes.replace('Pro account contribution', 'Employee account contribution')
                if updated_notes != action.notes:
                    action.notes = updated_notes
                    renamed_titles = True

        for draft in ApprovalDraft.query.all():
            if draft.title:
                updated_title = draft.title.replace('Brand-ready pro reply', 'Brand-ready employee reply').replace('Pro helpful reply', 'Helpful employee reply')
                if updated_title != draft.title:
                    draft.title = updated_title
                    renamed_titles = True

        if normalized_roles or review_labels_updated or renamed_titles:
            db.session.commit()

        # If settings table does not exist, it got created by create_all() above
        if 'setting' not in existing:
            # Seed default settings
            defaults = [
                Setting(key='claude_api_key', value=''),
                Setting(key='claude_model_search', value='claude-sonnet-4-20250514'),
                Setting(key='claude_model_comment', value='claude-sonnet-4-20250514'),
                Setting(key='auth_enabled', value='true'),
                Setting(key='signup_enabled', value='false')
            ]
            db.session.bulk_save_objects(defaults)
            db.session.commit()
        else:
            for key, default in [('auth_enabled', 'true'), ('signup_enabled', 'false'), ('approval_digest_time', '08:00')]:
                if not Setting.query.filter_by(key=key).first():
                    db.session.add(Setting(key=key, value=default))
            for key in ['claude_model_search', 'claude_model_comment']:
                setting = Setting.query.filter_by(key=key).first()
                if setting and setting.value in {'', 'claude-3-haiku-20240307', 'claude-3-7-sonnet-20250219'}:
                    setting.value = 'claude-sonnet-4-20250514'
            db.session.commit()

        if 'cron_job_id' not in job_cols:
            try:
                add_col('job', 'cron_job_id', 'INTEGER REFERENCES cron_job(id)')
            except Exception as e:
                print(f"[Migration] Column may already exist: {e}")
        if 'started_at' not in job_cols:
            try:
                add_col('job', 'started_at', 'TIMESTAMP')
            except Exception as e:
                print(f"[Migration] Column may already exist: {e}")
        if 'last_heartbeat' not in job_cols:
            try:
                add_col('job', 'last_heartbeat', 'TIMESTAMP')
            except Exception as e:
                print(f"[Migration] Column may already exist: {e}")

if os.environ.get('FLASK_ENV') != 'test':
    apply_migrations()

# ─── Startup: reset any orphaned 'running' jobs from a previous server crash ──
def _reset_orphaned_jobs():
    with app.app_context():
        try:
            stuck = Job.query.filter_by(status='running').all()
            if stuck:
                reset_count = 0
                for job in stuck:
                    last_seen = job.last_heartbeat or job.updated_at or job.created_at
                    if not last_seen:
                        continue
                    now_value = datetime.now(UTC)
                    if getattr(last_seen, 'tzinfo', None) is None:
                        now_value = now_value.replace(tzinfo=None)
                    if (now_value - last_seen).total_seconds() < 180:
                        continue
                    job.status = 'error'
                    job.result_json = json.dumps({"error": "Heartbeat stale — job likely interrupted"})
                    reset_count += 1
                if reset_count:
                    db.session.commit()
                    print(f"[Startup] Reset {reset_count} orphaned running job(s) to 'error'")
        except Exception as e:
            print(f"[Startup] Could not reset orphaned jobs: {e}")

if os.environ.get('FLASK_ENV') != 'test':
    _reset_orphaned_jobs()
    try:
        with app.app_context():
            reconcile_managed_actions_with_jobs()
    except Exception as e:
        print(f"[Startup] Could not reconcile managed actions: {e}")


def _is_api_request():
    return request.path == '/api' or request.path.startswith('/api/')


def _auth_enabled():
    setting = Setting.query.filter_by(key='auth_enabled').first()
    if not setting or setting.value is None:
        return True
    return setting.value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _signup_enabled():
    if User.query.count() == 0:
        return True
    setting = Setting.query.filter_by(key='signup_enabled').first()
    if not setting or setting.value is None:
        return False
    return setting.value.strip().lower() in {'1', 'true', 'yes', 'on'}


def _current_user():
    user_id = session.get('user_id')
    if not user_id:
        return None
    return db.session.get(User, int(user_id))


def _login_user(user):
    session['user_id'] = user.id
    session['user_role'] = user.role
    session.permanent = True


def _logout_user():
    session.pop('user_id', None)
    session.pop('user_role', None)


def _require_admin_api():
    user = g.current_user
    if not user or not user.is_active:
        return jsonify({'error': 'Authentication required'}), 401
    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    return None


@app.before_request
def require_authentication():
    g.current_user = None

    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        payload = decode_jwt_token(token)
        if payload:
            user = db.session.get(User, payload['user_id'])
            if user and user.is_active:
                g.current_user = user

    if not g.current_user:
        g.current_user = _current_user()

    exempt_paths = {
        '/login',
        '/signup',
        '/logout',
        '/api/login',
        '/api/signup',
        '/api/logout',
        '/api/auth/login',
        '/api/auth/signup',
        '/api/auth/logout',
        '/api/auth/status',
    }
    if request.path.startswith('/static/') or request.path in exempt_paths:
        return None
    if not _auth_enabled():
        return None
    if g.current_user and g.current_user.is_active:
        return None

    if _is_api_request():
        return jsonify({'error': 'Authentication required'}), 401
    next_url = request.full_path if request.query_string else request.path
    return redirect(url_for('login', next=next_url.rstrip('?')))

# ─── Logging helper ──────────────────────────────────────────────────────────
def add_log(message, level="info", account_id=None):
    try:
        with app.app_context():
            entry = Log(account_id=account_id, level=level, message=message)
            db.session.add(entry)
            db.session.commit()
    except Exception as e:
        print(f"Log error: {e}")

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if _auth_enabled() and not g.current_user:
        return redirect(url_for('login'))
    return render_template('index.html', current_user=g.current_user)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if g.get('current_user') and g.current_user.is_active:
        return redirect(url_for('index'))

    error = None
    next_url = request.values.get('next', '/')
    if request.method == 'POST':
        identity = (request.form.get('identity') or '').strip()
        password = request.form.get('password') or ''
        user = User.query.filter((User.username == identity) | (User.email == identity)).first()
        if not user or not user.is_active or not check_password_hash(user.password_hash, password):
            error = 'Invalid username/email or password.'
        else:
            _login_user(user)
            return redirect(next_url or url_for('index'))

    return render_template('login.html', signup_enabled=_signup_enabled(), bootstrap_mode=User.query.count() == 0, error=error, next_url=next_url)


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if not _signup_enabled():
        if request.method == 'POST':
            return jsonify({'error': 'Sign up is currently disabled.'}), 403
        return render_template('login.html', signup_enabled=False, bootstrap_mode=User.query.count() == 0, error='Sign up is currently disabled.', next_url=request.args.get('next', '/'))

    error = None
    next_url = request.values.get('next', '/')
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        email = (request.form.get('email') or '').strip().lower()
        password = request.form.get('password') or ''
        confirm = request.form.get('confirm_password') or ''

        if not username or not email or not password:
            error = 'Username, email, and password are required.'
        elif password != confirm:
            error = 'Passwords do not match.'
        elif len(password) < 8:
            error = 'Password must be at least 8 characters long.'
        elif User.query.filter((User.username == username) | (User.email == email)).first():
            error = 'A user with that username or email already exists.'
        else:
            role = 'admin' if User.query.count() == 0 else 'reviewer'
            user = User(username=username, email=email, password_hash=generate_password_hash(password), role=role, is_active=True)
            db.session.add(user)
            db.session.commit()
            _login_user(user)
            add_log(f"[Auth] User '{username}' signed up", 'success')
            return redirect(next_url or url_for('index'))

    return render_template('login.html', signup_enabled=True, bootstrap_mode=User.query.count() == 0, error=error, next_url=next_url, signup_mode=True)


@app.route('/logout', methods=['POST'])
def logout():
    _logout_user()
    return redirect(url_for('login'))


@app.route('/auth/status', methods=['GET'])
def auth_status():
    user = g.current_user
    return jsonify({
        'auth_enabled': _auth_enabled(),
        'signup_enabled': _signup_enabled(),
        'authenticated': bool(user and user.is_active),
        'user': user.to_dict() if user and user.is_active else None,
    }), 200


# ─── JSON Auth Endpoints (for React frontend) ────────────────────────────────

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json(silent=True) or {}
    identity = (data.get('identity') or '').strip()
    password = data.get('password') or ''

    if not identity or not password:
        return jsonify({'error': 'Identity and password are required.'}), 400

    user = User.query.filter((User.username == identity) | (User.email == identity)).first()
    if not user or not user.is_active or not check_password_hash(user.password_hash, password):
        return jsonify({'error': 'Invalid username/email or password.'}), 401

    _login_user(user)
    return jsonify({'user': user.to_dict(), 'message': 'Logged in successfully.'}), 200


@app.route('/api/signup', methods=['POST'])
def api_signup():
    if not _signup_enabled():
        return jsonify({'error': 'Sign up is currently disabled.'}), 403

    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    confirm = data.get('confirm_password') or ''

    if not username or not email or not password:
        return jsonify({'error': 'Username, email, and password are required.'}), 400
    if password != confirm:
        return jsonify({'error': 'Passwords do not match.'}), 400
    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters long.'}), 400
    if User.query.filter((User.username == username) | (User.email == email)).first():
        return jsonify({'error': 'A user with that username or email already exists.'}), 409

    role = 'admin' if User.query.count() == 0 else 'reviewer'
    user = User(username=username, email=email, password_hash=generate_password_hash(password), role=role, is_active=True)
    db.session.add(user)
    db.session.commit()
    _login_user(user)
    add_log(f"[Auth] User '{username}' signed up", 'success')
    return jsonify({'user': user.to_dict(), 'message': 'Account created successfully.'}), 201


@app.route('/api/logout', methods=['POST'])
def api_logout():
    _logout_user()
    return jsonify({'message': 'Logged out successfully.'}), 200


@app.route('/api/auth/login', methods=['POST'])
def api_auth_login():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'JSON body required'}), 400

    identity = data.get('identity', '').strip()
    password = data.get('password', '')
    if not identity or not password:
        return jsonify({'error': 'Identity and password are required'}), 400

    user = User.query.filter((User.username == identity) | (User.email == identity)).first()
    if not user or not user.check_password(password):
        return jsonify({'error': 'Invalid credentials'}), 401
    if not user.is_active:
        return jsonify({'error': 'Account is disabled'}), 403

    token = create_jwt_token(user)
    return jsonify({
        'token': token,
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'role': user.role,
        },
    })


@app.route('/api/auth/signup', methods=['POST'])
def api_auth_signup():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'error': 'JSON body required'}), 400

    username = data.get('username', '').strip()
    email = data.get('email', '').strip()
    password = data.get('password', '')
    confirm_password = data.get('confirm_password', '')
    if not username or not email or not password:
        return jsonify({'error': 'All fields are required'}), 400
    if password != confirm_password:
        return jsonify({'error': 'Passwords do not match'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400

    user_count = User.query.count()
    if user_count > 0:
        signup_enabled = _signup_enabled()
        if not signup_enabled:
            return jsonify({'error': 'Signup is disabled'}), 403

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'Email already registered'}), 409

    role = 'admin' if user_count == 0 else 'reviewer'
    user = User(username=username, email=email, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()

    token = create_jwt_token(user)
    return jsonify({
        'token': token,
        'user': {
            'id': user.id,
            'username': user.username,
            'email': user.email,
            'role': user.role,
        },
    }), 201


@app.route('/api/auth/logout', methods=['POST'])
def api_auth_logout():
    return jsonify({'message': 'Logged out successfully'})


@app.route('/api/auth/status', methods=['GET'])
def api_auth_status():
    auth_enabled_val = _auth_enabled()
    signup_enabled_val = _signup_enabled()
    user_data = _auth_user_payload(g.current_user) if getattr(g, 'current_user', None) else None
    bootstrap = User.query.count() == 0

    return jsonify({
        'auth_enabled': auth_enabled_val,
        'signup_enabled': signup_enabled_val,
        'bootstrap_mode': bootstrap,
        'user': user_data,
    })


@app.route('/api/campaign/reviews', methods=['GET'])
def get_campaign_reviews():
    limit = request.args.get('limit', default=25, type=int) or 25
    limit = max(1, min(limit, 100))
    reviews = ApprovalReview.query.order_by(ApprovalReview.created_at.desc()).limit(limit).all()
    return jsonify([review.to_dict() for review in reviews]), 200

# ── Accounts ──────────────────────────────────────────────────────────────────
@app.route('/api/accounts', methods=['GET'])
def get_accounts():
    return jsonify([a.to_dict() for a in Account.query.all()])

@app.route('/api/accounts/full', methods=['GET'])
def get_accounts_full():
    return jsonify([a.to_dict(include_password=True, include_cookies=True) for a in Account.query.all()])


def _resolve_persona_csv_path():
    workspace_root = os.path.dirname(basedir)
    candidates = []

    root_candidates = glob.glob(os.path.join(workspace_root, "Reddit Personas and Personalities*.csv"))
    prompt_candidates = glob.glob(os.path.join(basedir, "prompts", "Reddit Personas and Personalities*.csv"))

    for path in root_candidates + prompt_candidates:
        if os.path.exists(path):
            candidates.append(path)

    if not candidates:
        return None

    candidates.sort(key=lambda path: os.path.getmtime(path), reverse=True)
    return candidates[0]


@app.route('/api/personas', methods=['GET'])
def get_personas():
    import csv
    personas = []
    csv_path = _resolve_persona_csv_path()
    if csv_path and os.path.exists(csv_path):
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                personas.append(row)
    return jsonify(personas)

@app.route('/api/accounts/<int:account_id>/cookies', methods=['DELETE'])
def delete_cookies(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    account.cookies_json = None
    db.session.commit()
    add_log("Cookies deleted", "info", account_id)
    return jsonify({"message": "Cookies deleted"}), 200

@app.route('/api/accounts/cookies/delete-all', methods=['DELETE'])
def delete_all_cookies():
    accounts = Account.query.filter(Account.cookies_json.isnot(None)).all()
    count = 0
    for acc in accounts:
        acc.cookies_json = None
        count += 1
    db.session.commit()
    add_log(f"All cookies cleared ({count} accounts)", "info")
    return jsonify({"message": f"Cleared cookies for {count} accounts"}), 200

@app.route('/api/accounts', methods=['POST'])
def add_account():
    data = request.get_json(silent=True) or {}
    username, password = data.get('username'), data.get('password')
    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400
    if Account.query.filter_by(username=username).first():
        return jsonify({"error": "Account already exists"}), 400
    acc = Account(username=username, password=password)
    db.session.add(acc)
    db.session.commit()
    add_log(f"Account '{username}' created", "success", acc.id)
    return jsonify(acc.to_dict()), 201

@app.route('/api/accounts/bulk', methods=['POST'])
def add_accounts_bulk():
    data = request.get_json(silent=True) or {}
    lines = data.get('lines', [])
    if not lines: return jsonify({"error": "No data provided"}), 400
    
    added, errors = [], []
    for line in lines:
        line = line.strip()
        if not line: continue
        
        # Try different delimiters: :, |, comma, tab
        parts = None
        for sep in [':', '|', ',', '\t']:
            if sep in line:
                parts = line.split(sep, 1)
                break
        
        if not parts or len(parts) < 2:
            errors.append(f"Invalid format: {line}")
            continue
            
        username, password = parts[0].strip(), parts[1].strip()
        if not username or not password:
            errors.append(f"Missing user/pass: {line}")
            continue
            
        if Account.query.filter_by(username=username).first():
            errors.append(f"Exists: {username}")
            continue
            
        acc = Account(username=username, password=password)
        db.session.add(acc)
        added.append(acc)
        
    db.session.commit()
    for a in added:
        add_log(f"Account '{a.username}' imported", "success", a.id)
        
    return jsonify({
        "added": [a.to_dict() for a in added],
        "errors": errors
    }), 201

@app.route('/api/accounts/<int:account_id>', methods=['PUT'])
def update_account(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    data = request.get_json(silent=True) or {}
    if 'username' in data: account.username = data['username']
    if 'password' in data:
        account.password_encrypted = cipher_suite.encrypt(data['password'].encode()).decode()
    if 'personality' in data: account.personality = data['personality']
    if 'persona_name' in data: account.persona_name = data['persona_name']
    if 'interests' in data:
        account.interests = normalize_interest_csv(data['interests'])
    if 'role' in data:
        role = normalize_account_role(data['role'])
        if not account_role_is_valid(role):
            return jsonify({"error": "Invalid role"}), 400
        account.role = role

    db.session.commit()
    return jsonify(account.to_dict(include_password=True)), 200

@app.route('/api/accounts/<int:account_id>', methods=['DELETE'])
def delete_account(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404

    Log.query.filter_by(account_id=account_id).update({"account_id": None}, synchronize_session=False)
    MemorySuggestion.query.filter_by(account_id=account_id).update({"account_id": None}, synchronize_session=False)
    SearchHistory.query.filter_by(account_id=account_id).delete(synchronize_session=False)
    CommentedPost.query.filter_by(account_id=account_id).delete(synchronize_session=False)
    ApprovalDraft.query.filter_by(account_id=account_id).delete(synchronize_session=False)
    ApprovalReview.query.filter_by(account_id=account_id).delete(synchronize_session=False)
    ManagedAction.query.filter_by(account_id=account_id).delete(synchronize_session=False)
    CronJob.query.filter_by(account_id=account_id).delete(synchronize_session=False)

    db.session.delete(account)
    db.session.commit()
    return jsonify({"message": "Account deleted"}), 200

@app.route('/api/interests/suggestions', methods=['GET'])
def get_interests_suggestions():
    accounts = Account.query.all()
    all_interests = set()
    for acc in accounts:
        if acc.interests:
            tags = [tag.lower() for tag in normalize_interest_list(acc.interests)]
            all_interests.update(tags)
    return jsonify(sorted(list(all_interests))), 200

@app.route('/api/accounts/<int:account_id>/generate_interests', methods=['POST'])
def generate_interests(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Account not found"}), 404
    
    # We allow generating even if they don't have a rigid personality, but better if they do
    # Actually, let's auto-fill a basic prompt if empty.
    personality = account.personality
    if not personality:
        personality = "You are a standard Reddit user looking for engaging communities and topics."
        
    claude_api_key_setting = Setting.query.filter_by(key='claude_api_key').first()
    if not claude_api_key_setting or not claude_api_key_setting.value:
        return jsonify({"error": "Claude API key not configured. Please set it in AI Settings."}), 400
        
    claude_model_setting = Setting.query.filter_by(key='claude_model_search').first()
    model = claude_model_setting.value if claude_model_setting and claude_model_setting.value else "claude-sonnet-4-20250514"
    
    tags = ai_generate_interests_tags(personality, claude_api_key_setting.value, model)
    if not tags:
        return jsonify({"error": "Failed to generate tags."}), 500
        
    return jsonify({"tags": tags}), 200

# ── Session launch/stop ───────────────────────────────────────────────────────
def run_selenium_task(app_context, account_id):
    with app_context:
        try:
            account = db.session.get(Account, account_id)
            if not account:
                return

            account.status = "running"
            db.session.commit()
            add_log("Browser session starting…", "info", account_id)

            proxy_to_use = account.proxy
            if account.assigned_proxy:
                proxy_to_use = account.assigned_proxy.address

            success, message, new_cookies = login_to_reddit(
                account.id, account.username, account.password,
                proxy_to_use, account.cookies_json
            )

            db.session.refresh(account)
            if account.status == "running":
                account.status = "success" if success else "error"
                if success and new_cookies:
                    account.cookies_json = new_cookies
                db.session.commit()
                add_log(message, "success" if success else "error", account_id)
            else:
                if success and new_cookies:
                    account.cookies_json = new_cookies
                    db.session.commit()
                add_log("Session stopped manually", "info", account_id)
        except Exception:
            db.session.rollback()
            raise
        finally:
            db.session.remove()

@app.route('/api/accounts/<int:account_id>/launch', methods=['POST'])
def launch_account(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    if account.status == "running": return jsonify({"error": "Already running"}), 400
    threading.Thread(target=run_selenium_task, args=(app.app_context(), account_id)).start()
    return jsonify({"message": "Launch triggered"}), 200

def run_proxy_test_task(app_context, account_id):
    with app_context:
        try:
            account = db.session.get(Account, account_id)
            if not account:
                return

            account.status = "running"
            db.session.commit()
            add_log("Browser proxy test starting…", "info", account_id)

            proxy_to_use = account.proxy
            if account.assigned_proxy:
                proxy_to_use = account.assigned_proxy.address

            from selenium_agent import open_browser_for_proxy_test
            success, message = open_browser_for_proxy_test(account.id, proxy_to_use)

            db.session.refresh(account)
            if account.status == "running":
                account.status = "success" if success else "error"
                db.session.commit()
                add_log("Proxy test: " + message, "success" if success else "error", account_id)
            else:
                add_log("Proxy test stopped manually", "info", account_id)
        except Exception:
            db.session.rollback()
            raise
        finally:
            db.session.remove()

@app.route('/api/accounts/<int:account_id>/test_proxy_browser', methods=['POST'])
def test_proxy_browser(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    if account.status == "running": return jsonify({"error": "Already running"}), 400
    threading.Thread(target=run_proxy_test_task, args=(app.app_context(), account_id)).start()
    return jsonify({"message": "Proxy review browser launched"}), 200

@app.route('/api/accounts/<int:account_id>/stop', methods=['POST'])
def stop_account(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    killed = stop_driver(account.id)
    account.status = "idle"
    db.session.commit()
    add_log(f"Session stopped (driver killed: {killed})", "info", account_id)
    return jsonify({"message": "Stopped"}), 200

@app.route('/api/accounts/<int:account_id>/assign_proxy', methods=['POST'])
def assign_proxy(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    proxy_id = (request.get_json(silent=True) or {}).get('proxy_id')
    if proxy_id is None:
        account.proxy_id = None
    else:
        proxy = db.session.get(Proxy, proxy_id)
        if not proxy: return jsonify({"error": "Proxy not found"}), 404
        account.proxy_id = proxy.id
    db.session.commit()
    return jsonify(account.to_dict()), 200

# ── Jobs ──────────────────────────────────────────────────────────────────────
def _get_managed_action_from_job(job):
    try:
        params = json.loads(job.params_json or '{}')
    except Exception:
        return None
    managed_action_id = params.get('managed_action_id')
    if not managed_action_id:
        return None
    action = db.session.get(ManagedAction, int(managed_action_id))
    if action and action.job_id != job.id:
        action.job_id = job.id
    return action


def _sync_managed_action_from_job(job, status=None, result_payload=None):
    try:
        action = _get_managed_action_from_job(job)
        if not action:
            return None

        if status:
            action.status = status
        if result_payload is not None:
            action.result_json = json.dumps(result_payload)
        if status == 'running':
            action.queued_at = action.queued_at or datetime.now(UTC)
        if status in {'done', 'error', 'cancelled'}:
            action.executed_at = datetime.now(UTC)

        if isinstance(result_payload, dict) and not action.thread_url:
            post_urls = result_payload.get('post_urls') or []
            if not post_urls:
                interacted_posts = result_payload.get('interacted_posts') or []
                for item in interacted_posts:
                    if isinstance(item, dict) and item.get('url'):
                        post_urls = [item['url']]
                        break
            if post_urls:
                action.thread_url = post_urls[0]

        return action
    except Exception:
        db.session.rollback()
        raise


def _job_requires_customer_cooldown(job):
    action = _get_managed_action_from_job(job)
    return bool(action and action.account and action.account.role == 'customer')


def _start_job_thread(job_id):
    if app.config.get('TESTING') or os.environ.get('FLASK_ENV') == 'test':
        return
    threading.Thread(target=_run_job_background, args=(app.app_context(), job_id), daemon=True).start()


def _run_job_background(app_context, job_id):
    with app_context:
        try:
            job = db.session.get(Job, job_id)
            if not job:
                return
            account = db.session.get(Account, job.account_id)
            if not account:
                return

            uses_customer_cooldown = _job_requires_customer_cooldown(job)
            lock = _customer_job_lock if uses_customer_cooldown else None

            def _run_once():
                current_job = job
                started_running = False
                if uses_customer_cooldown:
                    last_finished_at = _customer_job_state.get('last_finished_at')
                    if last_finished_at:
                        wait_seconds = CUSTOMER_JOB_COOLDOWN_SECONDS - (datetime.now(UTC) - last_finished_at).total_seconds()
                        if wait_seconds > 0:
                            add_log(f"[Campaign] Waiting {int(wait_seconds)}s before starting the next customer job", "info", current_job.account_id)
                            time.sleep(wait_seconds)

                db.session.refresh(current_job)
                if current_job.status == 'cancelled':
                    return
                current_job.status = "running"
                current_job.started_at = datetime.now(UTC)
                current_job.last_heartbeat = datetime.now(UTC)
                _sync_managed_action_from_job(current_job, status='running')
                db.session.commit()
                started_running = True
                add_log(f"Job '{current_job.job_type}' started", "info", current_job.account_id)

                stop_heartbeat = {"stop": False}

                def _heartbeat():
                    with app.app_context():
                        try:
                            while not stop_heartbeat["stop"]:
                                try:
                                    hb_job = db.session.get(Job, job_id)
                                    if hb_job and hb_job.status == "running":
                                        hb_job.last_heartbeat = datetime.now(UTC)
                                        db.session.commit()
                                except Exception:
                                    db.session.rollback()
                                time.sleep(10)
                        finally:
                            db.session.remove()

                threading.Thread(target=_heartbeat, daemon=True).start()

                params = json.loads(current_job.params_json or '{}')
                try:
                    result = run_job(current_job.account_id, current_job.job_type, params)
                    db.session.refresh(current_job)
                    if current_job and current_job.status != 'cancelled':
                        current_job.status = "done"
                        current_job.result_json = json.dumps(result)
                        action = _sync_managed_action_from_job(current_job, status='done', result_payload=result)
                        if action and action.approval_state == 'approved' and action.keyword and result.get('success'):
                            action_params = json.loads(action.params_json or '{}')
                            if not action_params.get('interest_rotated_after_success'):
                                rotate_account_interest(action.account, action.keyword)
                                action_params['interest_rotated_after_success'] = True
                                action.params_json = json.dumps(action_params)
                        add_log(f"Job '{current_job.job_type}' completed: {result.get('message','')}", "success", current_job.account_id)
                except Exception as e:
                    db.session.rollback()
                    current_job = db.session.get(Job, job_id)
                    if current_job:
                        db.session.refresh(current_job)
                    if current_job and current_job.status != 'cancelled':
                        current_job.status = "error"
                        error_payload = {"error": str(e)}
                        current_job.result_json = json.dumps(error_payload)
                        _sync_managed_action_from_job(current_job, status='error', result_payload=error_payload)
                        add_log(f"Job '{current_job.job_type}' error: {e}", "error", current_job.account_id)
                finally:
                    stop_heartbeat["stop"] = True
                    if uses_customer_cooldown and started_running:
                        _customer_job_state['last_finished_at'] = datetime.now(UTC)
                    db.session.commit()

            if lock:
                with lock:
                    _run_once()
            else:
                _run_once()
        finally:
            db.session.remove()

@app.route('/api/accounts/<int:account_id>/jobs', methods=['GET'])
def get_jobs(account_id):
    jobs = Job.query.filter_by(account_id=account_id).order_by(Job.created_at.desc()).all()
    return jsonify([j.to_dict() for j in jobs])

@app.route('/api/accounts/<int:account_id>/jobs', methods=['DELETE'])
def delete_all_jobs(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    count = Job.query.filter_by(account_id=account_id).delete()
    db.session.commit()
    add_log(f"All jobs deleted ({count} removed)", "warning", account_id)
    return jsonify({"message": f"Deleted {count} jobs"}), 200

@app.route('/api/accounts/<int:account_id>/jobs', methods=['POST'])
def create_job(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    data = request.get_json(silent=True) or {}
    job_type = data.get('job_type')
    if not job_type: return jsonify({"error": "job_type required"}), 400
    params = data.get('params', {})
    job = Job(account_id=account_id, job_type=job_type, params_json=json.dumps(params))
    db.session.add(job)
    db.session.commit()
    # Run immediately in background
    _start_job_thread(job.id)
    return jsonify(job.to_dict()), 201

@app.route('/api/accounts/<int:account_id>/jobs/<int:job_id>', methods=['DELETE'])
def delete_job(account_id, job_id):
    job = db.session.get(Job, job_id)
    if not job or job.account_id != account_id: return jsonify({"error": "Not found"}), 404
    db.session.delete(job)
    db.session.commit()
    return jsonify({"message": "Deleted"}), 200

@app.route('/api/accounts/<int:account_id>/jobs/<int:job_id>/cancel', methods=['POST'])
def cancel_job(account_id, job_id):
    """Mark a job as cancelled without cooperative worker shutdown."""
    job = db.session.get(Job, job_id)
    if not job or job.account_id != account_id: return jsonify({"error": "Not found"}), 404
    if job.status in {'done', 'error', 'cancelled'}:
        return jsonify({"error": "Job already completed"}), 400
    job.status = 'cancelled'
    cancel_payload = {"error": "Manually cancelled by user"}
    job.result_json = json.dumps(cancel_payload)
    _sync_managed_action_from_job(job, status='cancelled', result_payload=cancel_payload)
    db.session.commit()
    add_log(f"Job '{job.job_type}' was force-cancelled", "warning", account_id)
    return jsonify({"message": "Job cancelled", "job": job.to_dict()}), 200

@app.route('/api/accounts/<int:account_id>/jobs/<int:job_id>', methods=['PUT'])
def update_job(account_id, job_id):
    job = db.session.get(Job, job_id)
    if not job or job.account_id != account_id: return jsonify({"error": "Not found"}), 404
    
    data = request.get_json(silent=True) or {}
    if 'job_type' in data:
        job.job_type = data['job_type']
    if 'params' in data:
        job.params_json = json.dumps(data['params'])
    
    # If the user wants to re-run it
    if data.get('rerun', False):
        job.status = "pending"
        db.session.commit()
        _start_job_thread(job.id)
        return jsonify(job.to_dict()), 200

    db.session.commit()
    return jsonify(job.to_dict()), 200

# ── Commented Posts (dedup tracking) ─────────────────────────────────────────
@app.route('/api/accounts/<int:account_id>/commented-posts', methods=['GET'])
def get_commented_posts(account_id):
    posts = CommentedPost.query.filter_by(account_id=account_id)\
        .order_by(CommentedPost.commented_at.desc()).all()
    return jsonify([p.to_dict() for p in posts])

@app.route('/api/accounts/<int:account_id>/commented-posts', methods=['DELETE'])
def clear_commented_posts(account_id):
    account = db.session.get(Account, account_id)
    if not account: return jsonify({"error": "Not found"}), 404
    count = CommentedPost.query.filter_by(account_id=account_id).delete()
    db.session.commit()
    add_log(f"Cleared {count} commented post(s) from history", "info", account_id)
    return jsonify({"message": f"Cleared {count} entries"}), 200

# ── Proxies ───────────────────────────────────────────────────────────────────
@app.route('/api/proxies', methods=['GET'])
def get_proxies():
    return jsonify([p.to_dict() for p in Proxy.query.all()])

@app.route('/api/proxies', methods=['POST'])
def add_proxy():
    data = request.get_json(silent=True) or {}
    addresses = data.get('addresses', [])
    if 'address' in data and not addresses:
        addresses = [data['address']]
    if not addresses: return jsonify({"error": "No addresses provided"}), 400
    proxy_type = data.get('proxyType', 'manual')
    added, errors = [], []
    for addr in addresses:
        addr = addr.strip()
        if not addr: continue
        if Proxy.query.filter_by(address=addr).first():
            errors.append(f"{addr} (already exists)")
            continue
        p = Proxy(address=addr, proxy_type=proxy_type)
        db.session.add(p)
        added.append(p)
    db.session.commit()
    return jsonify({"added": [p.to_dict() for p in added], "errors": errors}), 201

@app.route('/api/proxies/<int:proxy_id>', methods=['PUT'])
def update_proxy(proxy_id):
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy: return jsonify({"error": "Not found"}), 404
    data = request.get_json(silent=True) or {}
    if 'address' in data: proxy.address = data['address']
    db.session.commit()
    return jsonify(proxy.to_dict()), 200

@app.route('/api/proxies/<int:proxy_id>', methods=['DELETE'])
def delete_proxy(proxy_id):
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy: return jsonify({"error": "Not found"}), 404
    for acc in Account.query.filter_by(proxy_id=proxy_id).all():
        acc.proxy_id = None
    db.session.delete(proxy)
    db.session.commit()
    return jsonify({"message": "Proxy deleted"}), 200

@app.route('/api/proxies/delete-all', methods=['DELETE'])
def delete_all_proxies():
    proxies = Proxy.query.all()
    count = len(proxies)
    # Unassign from all accounts
    for acc in Account.query.all():
        acc.proxy_id = None
    # Delete all proxies
    for p in proxies:
        db.session.delete(p)
    db.session.commit()
    return jsonify({"message": f"Deleted {count} proxies"}), 200

def _perform_geo_check(proxy_id):
    with app.app_context():
        try:
            proxy = db.session.get(Proxy, proxy_id)
            if not proxy:
                return
            url = proxy.address
            if not url.startswith('http'):
                url = 'http://' + url
            
            geo_r = http_requests.get('http://ip-api.com/json/', proxies={"http": url, "https": url}, timeout=10)
            if geo_r.status_code == 200:
                geo_data = geo_r.json()
                if geo_data.get('status') == 'success':
                    city = geo_data.get('city', 'Unknown City')
                    country = geo_data.get('country', 'Unknown Country')
                    flag = get_flag(country)
                    proxy.location = f"{city}/{country} {flag}"
                    db.session.commit()
        except Exception:
            db.session.rollback()
        finally:
            db.session.remove()

def _perform_proxy_test(proxy_id):
    with app.app_context():
        try:
            proxy = db.session.get(Proxy, proxy_id)
            if not proxy:
                return
            # Most purchased HTTP proxies don't support tunneling HTTPS directly through requests easily
            # Use HTTP specifically for testing if they are basic proxies to avoid SSL errors "Tunnel connection failed"
            url = proxy.address
            if not url.startswith('http'):
                url = 'http://' + url
            
            # Fetch IP and Status
            r = http_requests.get('http://api.ipify.org', proxies={"http": url, "https": url}, timeout=15)
            # 200 is success, 407 means proxy is alive and working but requires authentication
            proxy.status = 'active' if r.status_code in [200, 407] else 'down'

            # Fetch Geolocation if active
            if proxy.status == 'active':
                _perform_geo_check(proxy_id)
        except Exception:
            db.session.rollback()
            proxy = db.session.get(Proxy, proxy_id)
            if not proxy:
                return
            proxy.status = 'down'
            db.session.commit()
        else:
            db.session.commit()
        finally:
            db.session.remove()

@app.route('/api/proxies/<int:proxy_id>/check-location', methods=['POST'])
def check_location(proxy_id):
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy: return jsonify({"error": "Not found"}), 404
    proxy.status = 'testing'
    db.session.commit()
    _perform_geo_check(proxy_id)
    db.session.refresh(proxy)
    proxy.status = 'active' if proxy.location else 'down' # Or keep previous status
    db.session.commit()
    return jsonify(proxy.to_dict()), 200

@app.route('/api/proxies/check-locations', methods=['POST'])
def check_all_locations():
    proxies = Proxy.query.all()
    ids = [p.id for p in proxies]
    for p in proxies:
        p.status = 'testing'
    db.session.commit()
    def _run(proxy_ids):
        with app.app_context():
            try:
                for pid in proxy_ids:
                    _perform_geo_check(pid)
                    # Set status to active if location was found, assuming it works
                    try:
                        p = db.session.get(Proxy, pid)
                        if p and p.location:
                            p.status = 'active'
                        db.session.commit()
                    except Exception:
                        db.session.rollback()
                    finally:
                        db.session.remove()
            finally:
                db.session.remove()
    threading.Thread(target=_run, args=(ids,)).start()
    return jsonify({"message": "Checking locations in background"}), 202

@app.route('/api/proxies/<int:proxy_id>/test', methods=['POST'])
def test_proxy(proxy_id):
    proxy = db.session.get(Proxy, proxy_id)
    if not proxy: return jsonify({"error": "Not found"}), 404
    proxy.status = 'testing'
    db.session.commit()
    _perform_proxy_test(proxy_id)
    db.session.refresh(proxy)
    return jsonify(proxy.to_dict()), 200

@app.route('/api/proxies/test-all', methods=['POST'])
def test_all_proxies():
    proxies = Proxy.query.all()
    ids = [p.id for p in proxies]
    for p in proxies:
        p.status = 'testing'
    db.session.commit()
    def _run(proxy_ids):
        with app.app_context():
            for pid in proxy_ids:
                _perform_proxy_test(pid)
    threading.Thread(target=_run, args=(ids,)).start()
    return jsonify({"message": "Testing in background"}), 202

# ── Logs ──────────────────────────────────────────────────────────────────────
@app.route('/api/logs', methods=['GET'])
def get_logs():
    account_id = request.args.get('account_id', type=int)
    q = Log.query.order_by(Log.timestamp.desc())
    if account_id:
        q = q.filter_by(account_id=account_id)
    logs = q.limit(200).all()
    return jsonify([l.to_dict() for l in logs])

@app.route('/api/logs', methods=['DELETE'])
def clear_logs():
    account_id = request.args.get('account_id', type=int)
    if account_id:
        Log.query.filter_by(account_id=account_id).delete()
    else:
        Log.query.delete()
    db.session.commit()
    return jsonify({"message": "Logs cleared"}), 200

# ── Settings ──────────────────────────────────────────────────────────────────
@app.route('/api/settings', methods=['GET'])
def get_settings():
    settings = Setting.query.all()
    data = {s.key: s.value for s in settings}
    app_password = data.pop('smtp_app_password', '')
    data['smtp_app_password_configured'] = bool(app_password)
    return jsonify(data)


def _setting_value(key, default=''):
    setting = Setting.query.filter_by(key=key).first()
    return setting.value if setting and setting.value is not None else default


def _save_setting_value(key, value):
    setting = Setting.query.filter_by(key=key).first()
    if setting:
        setting.value = value
    else:
        db.session.add(Setting(key=key, value=value))


def _bool_setting_value(key, default=False):
    return _setting_value(key, 'true' if default else 'false').strip().lower() in {'1', 'true', 'yes', 'on'}


BUSINESS_MEMORY_CATEGORIES = {
    'tone',
    'preferred_phrasing',
    'avoid_phrasing',
    'operations',
    'itinerary_guidance',
    'lodge_operator_preferences',
    'conservation_guidance',
}

LEARNING_STATUSES = {'pending', 'approved', 'dismissed'}


def _normalize_business_memory_payload(data, allow_partial=False):
    payload = data or {}
    normalized = {}

    if 'category' in payload or not allow_partial:
        category = str(payload.get('category') or 'operations').strip().lower().replace(' ', '_')
        if category not in BUSINESS_MEMORY_CATEGORIES:
            raise ValueError('Choose a valid business memory category.')
        normalized['category'] = category

    if 'title' in payload or not allow_partial:
        title = str(payload.get('title') or '').strip()
        if not title:
            raise ValueError('Title is required.')
        normalized['title'] = title

    if 'content' in payload or not allow_partial:
        content = str(payload.get('content') or '').strip()
        if not content:
            raise ValueError('Content is required.')
        normalized['content'] = content

    if 'priority' in payload or not allow_partial:
        raw_priority = payload.get('priority', 3)
        try:
            priority = int(raw_priority)
        except (TypeError, ValueError):
            raise ValueError('Priority must be between 1 and 5.')
        if priority < 1 or priority > 5:
            raise ValueError('Priority must be between 1 and 5.')
        normalized['priority'] = priority

    if 'is_active' in payload:
        normalized['is_active'] = bool(payload.get('is_active'))
    elif not allow_partial:
        normalized['is_active'] = True

    if 'source_review_id' in payload:
        raw_review_id = payload.get('source_review_id')
        if raw_review_id in (None, ''):
            normalized['source_review_id'] = None
        else:
            try:
                normalized['source_review_id'] = int(raw_review_id)
            except (TypeError, ValueError):
                raise ValueError('Source review must be a valid review id.')
            if not db.session.get(ApprovalReview, normalized['source_review_id']):
                raise ValueError('Source review could not be found.')

    return normalized


def _normalize_learning_text(value):
    return re.sub(r'\s+', ' ', str(value or '').strip())


def _normalize_learning_compare_text(value):
    text = _normalize_learning_text(value).lower()
    text = re.sub(r'[^a-z0-9\s]', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def _edit_is_meaningful_for_learning(original_comment, final_comment):
    original = _normalize_learning_text(original_comment)
    final = _normalize_learning_text(final_comment)
    if not original or not final:
        return False
    if original == final:
        return False

    original_compare = _normalize_learning_compare_text(original)
    final_compare = _normalize_learning_compare_text(final)
    if not original_compare or not final_compare or original_compare == final_compare:
        return False

    similarity = SequenceMatcher(None, original_compare, final_compare).ratio()
    changed_chars = max(len(original_compare), len(final_compare)) * (1 - similarity)
    word_delta = abs(len(original_compare.split()) - len(final_compare.split()))
    if similarity > 0.97 and changed_chars < 8:
        return False
    if similarity > 0.94 and changed_chars < 14 and word_delta <= 1:
        return False
    return True


def _extract_json_array(raw_text):
    text = str(raw_text or '').strip()
    if not text:
        return []
    candidates = [text]
    match = re.search(r'\[[\s\S]*\]', text)
    if match:
        candidates.insert(0, match.group(0))
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        if isinstance(parsed, list):
            return parsed
    return []


def _memory_text_exists(category, title, content):
    normalized_title = _normalize_learning_compare_text(title)
    normalized_content = _normalize_learning_compare_text(content)
    for entry in BusinessMemory.query.all():
        if entry.category != category:
            continue
        if _normalize_learning_compare_text(entry.title) == normalized_title and _normalize_learning_compare_text(entry.content) == normalized_content:
            return True
    for suggestion in MemorySuggestion.query.filter(MemorySuggestion.status.in_(['pending', 'approved'])).all():
        if suggestion.category != category:
            continue
        if _normalize_learning_compare_text(suggestion.title) == normalized_title and _normalize_learning_compare_text(suggestion.content) == normalized_content:
            return True
    return False


def _build_learning_suggestion_prompt(review):
    return f"""
You are extracting reusable writing guidance from an approved Reddit draft edit.

Return JSON only. Output a JSON array with 0 to 3 suggestion objects.
Each object must use this schema exactly:
{{
  \"category\": \"tone|preferred_phrasing|avoid_phrasing|operations|itinerary_guidance|lodge_operator_preferences|conservation_guidance\",
  \"title\": \"short reusable rule title\",
  \"content\": \"one reusable instruction for future drafts\",
  \"confidence\": 1-5
}}

Rules:
- Only include lessons that are reusable across future drafts.
- Do not include one-off facts from a single thread.
- Focus on meaningful edits in tone, phrasing, specificity, grounding, brand restraint, or helpfulness.
- If there is no reusable lesson, return [].
- Keep titles short and content direct.

Draft type: {review.role}
Post title: {review.post_title or ''}
Post body: {review.post_body or ''}
Approval notes: {review.approval_notes or ''}
Original comment: {review.original_comment or ''}
Final comment: {review.final_comment or ''}
""".strip()


def _generate_learning_suggestions(review):
    if not review or review.role not in {'customer_brand', 'employee_brand', 'employee_helpful'}:
        return []
    if not _edit_is_meaningful_for_learning(review.original_comment, review.final_comment):
        return []

    api_key_setting = Setting.query.filter_by(key='claude_api_key').first()
    if not api_key_setting or not api_key_setting.value:
        return []
    model_setting = Setting.query.filter_by(key='claude_model_comment').first()
    model = model_setting.value if model_setting and model_setting.value else 'claude-sonnet-4-20250514'

    try:
        import anthropic
    except Exception:
        return []

    try:
        client = anthropic.Anthropic(api_key=api_key_setting.value)
        response = client.messages.create(
            model=model,
            max_tokens=900,
            temperature=0,
            messages=[{"role": "user", "content": _build_learning_suggestion_prompt(review)}],
        )
        raw_text = ''.join(block.text for block in getattr(response, 'content', []) if hasattr(block, 'text'))
    except Exception as exc:
        add_log(f"[Memory] Suggestion extraction failed for review #{review.id}: {exc}", 'warning', review.account_id)
        return []

    created = []
    for item in _extract_json_array(raw_text)[:3]:
        if not isinstance(item, dict):
            continue
        category = str(item.get('category') or 'operations').strip().lower().replace(' ', '_')
        if category not in BUSINESS_MEMORY_CATEGORIES:
            continue
        title = _normalize_learning_text(item.get('title'))
        content = _normalize_learning_text(item.get('content'))
        if not title or not content:
            continue
        if _memory_text_exists(category, title, content):
            continue
        try:
            confidence = int(item.get('confidence') or 3)
        except (TypeError, ValueError):
            confidence = 3
        confidence = max(1, min(5, confidence))
        suggestion = MemorySuggestion(
            source_review_id=review.id,
            account_id=review.account_id,
            draft_type=review.role,
            category=category,
            title=title,
            content=content,
            confidence=confidence,
            status='pending',
        )
        db.session.add(suggestion)
        created.append(suggestion)
    return created


@app.route('/api/settings', methods=['POST'])
def update_settings():
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error
    data = request.get_json(silent=True) or {}
    email_recipients = data.get('email_recipients')
    if email_recipients is not None:
        data['email_recipients'] = '\n'.join(normalize_recipient_emails(email_recipients))
    if 'smtp_port' in data:
        data['smtp_port'] = str(data.get('smtp_port') or '587').strip() or '587'
    if 'approval_digest_time' in data:
        data['approval_digest_time'] = normalize_digest_time(data.get('approval_digest_time') or '08:00')
    data.pop('email_mode', None)
    data.pop('email_digest_interval_minutes', None)
    for key, val in data.items():
        if key == 'smtp_app_password' and (val is None or str(val).strip() == ''):
            continue
        if val is None: val = ""
        # Find setting and update, or create if missing
        setting = Setting.query.filter_by(key=key).first()
        if setting:
            setting.value = str(val)
        else:
            db.session.add(Setting(key=key, value=str(val)))
    db.session.commit()
    return jsonify({"message": "Settings updated"}), 200


@app.route('/api/settings/test_email', methods=['POST'])
def test_email_settings():
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error
    data = request.get_json(silent=True) or {}
    stored = get_email_settings(include_secret=True)
    override = {
        'smtp_host': str(data.get('smtp_host') or stored.get('smtp_host') or 'smtp.gmail.com').strip(),
        'smtp_port': str(data.get('smtp_port') or stored.get('smtp_port') or '587').strip(),
        'smtp_username': str(data.get('smtp_username') or stored.get('smtp_username') or '').strip(),
        'smtp_app_password': str(data.get('smtp_app_password') or stored.get('smtp_app_password') or '').strip(),
        'smtp_from_name': str(data.get('smtp_from_name') or stored.get('smtp_from_name') or 'Reddit Bot Manager').strip(),
        'smtp_from_email': str(data.get('smtp_from_email') or stored.get('smtp_from_email') or '').strip(),
    }
    recipients = normalize_recipient_emails(data.get('email_recipients') or data.get('to') or stored.get('email_recipients') or '')
    base_url = str(data.get('email_base_url') or stored.get('email_base_url') or '').strip()

    try:
        send_info = send_email_message(
            subject='Reddit Bot Manager Email Test',
            body=(
                'This is a test email from Reddit Bot Manager.\n\n'
                f'SMTP login: {override["smtp_username"] or "(not set)"}\n'
                f'Base URL: {base_url or "(not set)"}\n\n'
                'If you received this, your Gmail app password configuration is working.'
            ),
            to_emails=recipients,
            override_settings=override,
        )
        return jsonify({
            'message': f"Test email sent to {', '.join(send_info['recipients'])}",
            'recipients': send_info['recipients'],
        }), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except smtplib.SMTPAuthenticationError:
        return jsonify({'error': 'SMTP authentication failed. Check your username and app password.'}), 502
    except smtplib.SMTPException as e:
        return jsonify({'error': f'SMTP error while sending test email: {str(e)}'}), 502
    except Exception as e:
        return jsonify({'error': f'Unexpected error while sending test email: {str(e)}'}), 500

@app.route('/api/settings/test_api', methods=['POST'])
def test_api():
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error
    import anthropic
    data = request.get_json(silent=True) or {}
    api_key = data.get('api_key', '').strip()
    
    if not api_key:
        stored_key = Setting.query.filter_by(key='claude_api_key').first()
        if stored_key and stored_key.value:
            api_key = stored_key.value
        else:
            return jsonify({"error": "No API key provided or found in settings."}), 400

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=40,
            messages=[{"role": "user", "content": "hi, please reply with 'hi there!' only."}]
        )
        return jsonify({
            "message": "API key works", 
            "response_text": response.content[0].text.strip()
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route('/api/business-memory', methods=['GET'])
def get_business_memory():
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error
    include_archived = str(request.args.get('include_archived', 'false')).strip().lower() in {'1', 'true', 'yes', 'on'}
    query = BusinessMemory.query
    if not include_archived:
        query = query.filter_by(is_active=True)
    entries = query.order_by(BusinessMemory.is_active.desc(), BusinessMemory.priority.desc(), BusinessMemory.created_at.desc()).all()
    return jsonify([entry.to_dict() for entry in entries]), 200


@app.route('/api/business-memory', methods=['POST'])
def create_business_memory():
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error

    try:
        normalized = _normalize_business_memory_payload(request.get_json(silent=True) or {}, allow_partial=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    entry = BusinessMemory(
        category=normalized['category'],
        title=normalized['title'],
        content=normalized['content'],
        priority=normalized['priority'],
        is_active=normalized['is_active'],
        source_review_id=normalized.get('source_review_id'),
        created_by=g.current_user.id if g.get('current_user') and g.current_user.is_active else None,
    )
    db.session.add(entry)
    db.session.commit()
    return jsonify({'message': 'Business memory saved.', 'entry': entry.to_dict()}), 201


@app.route('/api/business-memory/<int:entry_id>', methods=['PATCH'])
def update_business_memory(entry_id):
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error

    entry = db.session.get(BusinessMemory, entry_id)
    if not entry:
        return jsonify({'error': 'Business memory entry not found.'}), 404

    try:
        normalized = _normalize_business_memory_payload(request.get_json(silent=True) or {}, allow_partial=True)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if not normalized:
        return jsonify({'error': 'No updates were provided.'}), 400

    for key, value in normalized.items():
        setattr(entry, key, value)
    db.session.commit()
    return jsonify({'message': 'Business memory updated.', 'entry': entry.to_dict()}), 200


@app.route('/api/memory-suggestions', methods=['GET'])
def get_memory_suggestions():
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error
    status = str(request.args.get('status', 'pending')).strip().lower()
    query = MemorySuggestion.query
    if status in LEARNING_STATUSES:
        query = query.filter_by(status=status)
    suggestions = query.order_by(MemorySuggestion.status.asc(), MemorySuggestion.confidence.desc(), MemorySuggestion.created_at.desc()).all()
    return jsonify([suggestion.to_dict() for suggestion in suggestions]), 200


@app.route('/api/memory-suggestions/<int:suggestion_id>/approve', methods=['POST'])
def approve_memory_suggestion(suggestion_id):
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error
    suggestion = db.session.get(MemorySuggestion, suggestion_id)
    if not suggestion:
        return jsonify({'error': 'Memory suggestion not found.'}), 404
    if suggestion.status != 'pending':
        return jsonify({'error': 'Only pending suggestions can be approved.'}), 400

    payload = request.get_json(silent=True) or {}
    try:
        normalized = _normalize_business_memory_payload({
            'category': payload.get('category', suggestion.category),
            'title': payload.get('title', suggestion.title),
            'content': payload.get('content', suggestion.content),
            'priority': payload.get('priority', suggestion.confidence),
            'is_active': payload.get('is_active', True),
            'source_review_id': suggestion.source_review_id,
        }, allow_partial=False)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    entry = BusinessMemory(
        category=normalized['category'],
        title=normalized['title'],
        content=normalized['content'],
        priority=normalized['priority'],
        is_active=normalized['is_active'],
        source_review_id=suggestion.source_review_id,
        created_by=g.current_user.id if g.get('current_user') and g.current_user.is_active else None,
    )
    db.session.add(entry)
    db.session.flush()

    suggestion.status = 'approved'
    suggestion.approved_memory_id = entry.id
    suggestion.reviewed_by = g.current_user.id if g.get('current_user') and g.current_user.is_active else None
    suggestion.reviewed_at = datetime.now(UTC)
    db.session.commit()
    return jsonify({'message': 'Suggestion promoted to business memory.', 'suggestion': suggestion.to_dict(), 'entry': entry.to_dict()}), 200


@app.route('/api/memory-suggestions/<int:suggestion_id>/dismiss', methods=['POST'])
def dismiss_memory_suggestion(suggestion_id):
    admin_error = _require_admin_api()
    if admin_error:
        return admin_error
    suggestion = db.session.get(MemorySuggestion, suggestion_id)
    if not suggestion:
        return jsonify({'error': 'Memory suggestion not found.'}), 404
    if suggestion.status != 'pending':
        return jsonify({'error': 'Only pending suggestions can be dismissed.'}), 400

    suggestion.status = 'dismissed'
    suggestion.reviewed_by = g.current_user.id if g.get('current_user') and g.current_user.is_active else None
    suggestion.reviewed_at = datetime.now(UTC)
    db.session.commit()
    return jsonify({'message': 'Suggestion dismissed.', 'suggestion': suggestion.to_dict()}), 200


def _thread_guard_conflict(action):
    strategy = get_campaign_strategy()
    max_accounts = max(1, int(strategy.get('max_managed_accounts_per_thread', 1)))
    normalized_thread_url = normalize_commented_post_url(action.thread_url)
    if not normalized_thread_url:
        return None

    same_account_conflict = ManagedAction.query.filter(
        ManagedAction.account_id == action.account_id,
        ManagedAction.id != action.id,
        ManagedAction.status.in_(['planned', 'queued', 'running'])
    ).all()
    for existing_action in same_account_conflict:
        if normalize_commented_post_url(existing_action.thread_url) == normalized_thread_url:
            return "Thread guard blocked this action: this account already has an open action for that thread."

    other_accounts = {
        row.account_id
        for row in ManagedAction.query.filter(
            ManagedAction.id != action.id,
            ManagedAction.status.in_(['queued', 'running', 'done', 'error'])
        ).all()
        if row.account_id != action.account_id and normalize_commented_post_url(row.thread_url) == normalized_thread_url
    }
    if len(other_accounts) >= max_accounts:
        return f"Thread guard blocked this action: {len(other_accounts)} account(s) already managed that thread."
    return None


def _queue_managed_action(action, commit=True, start_thread=True):
    with _managed_action_queue_lock:
        if action.status != 'planned':
            raise ValueError('Only planned actions can be queued.')

        conflict_error = _thread_guard_conflict(action)
        if conflict_error:
            raise ValueError(conflict_error)

        params = json.loads(action.params_json or '{}')
        params['managed_action_id'] = action.id
        job = Job(account_id=action.account_id, job_type=action.action_type, params_json=json.dumps(params))
        db.session.add(job)
        db.session.flush()

        action.job_id = job.id
        action.status = 'queued'
        action.queued_at = datetime.now(UTC)
        if commit:
            db.session.commit()

    add_log(f"[Campaign] Queued managed action #{action.id}: {action.title}", "info", action.account_id)
    if start_thread:
        _start_job_thread(job.id)
    return action, job


@app.route('/api/campaign/dashboard', methods=['GET'])
def get_campaign_dashboard():
    return jsonify(build_campaign_dashboard_payload())


def _run_simplified_campaign_pass(ignore_window=False):
    events = dispatch_simplified_campaign(queue_callback=_queue_managed_action, ignore_window=ignore_window)
    action_count = sum(1 for event in events if event.get('kind') == 'action')
    draft_count = sum(1 for event in events if event.get('kind') == 'draft')
    return events, action_count, draft_count


def _campaign_disabled_response(message):
    return jsonify({
        "message": message,
        "events": [],
        "dashboard": build_campaign_dashboard_payload(),
    }), 200


@app.route('/api/campaign/config', methods=['POST'])
def update_campaign_config_route():
    data = request.get_json(silent=True) or {}
    if 'approval_digest_time' in data:
        data['approval_digest_time'] = normalize_digest_time(data.get('approval_digest_time') or '08:00')
    try:
        config = save_simplified_campaign_config(data)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    add_log("[Campaign] Updated shared campaign config", "info")
    return jsonify({
        "message": "Campaign config updated.",
        "campaign_config": config,
        "dashboard": build_campaign_dashboard_payload(),
    }), 200


@app.route('/api/campaign/start', methods=['POST'])
def start_campaign_route():
    set_simplified_campaign_enabled(True)
    add_log("[Campaign] Shared campaign enabled", "success")
    return jsonify({
        "message": "Campaign enabled. Scheduler will create new items during the shared campaign window.",
        "dashboard": build_campaign_dashboard_payload(),
    }), 200


@app.route('/api/campaign/stop', methods=['POST'])
def stop_campaign_route():
    set_simplified_campaign_enabled(False)
    add_log("[Campaign] Shared campaign disabled", "warning")
    return jsonify({
        "message": "Campaign disabled. Existing jobs and drafts continue, but no new scheduled campaign items will be created.",
        "dashboard": build_campaign_dashboard_payload(),
    }), 200


@app.route('/api/campaign/run-now', methods=['POST'])
def run_campaign_now_route():
    if not get_simplified_campaign_enabled():
        return _campaign_disabled_response("Campaign is disabled. Enable it before running a manual campaign pass.")
    events, action_count, draft_count = _run_simplified_campaign_pass(ignore_window=True)
    if action_count or draft_count:
        add_log(f"[Campaign] Manual run created {action_count} customer action(s) and {draft_count} approval draft(s)", "info")
    return jsonify({
        "message": f"Manual campaign run created {action_count} customer action(s) and {draft_count} approval draft(s). Runs are allowed outside the shared window when the campaign is enabled.",
        "events": events,
        "dashboard": build_campaign_dashboard_payload(),
    }), 200


@app.route('/api/campaign/strategy', methods=['POST'])
def update_campaign_strategy_route():
    data = request.get_json(silent=True) or {}
    strategy = save_campaign_strategy(data)
    return jsonify({"message": "Campaign strategy updated", "strategy": strategy}), 200


@app.route('/api/campaign/plan', methods=['POST'])
def run_campaign_plan():
    if not get_simplified_campaign_enabled():
        return _campaign_disabled_response("Campaign is disabled. Enable it before running a manual campaign pass.")
    events, action_count, draft_count = _run_simplified_campaign_pass(ignore_window=True)
    if action_count or draft_count:
        add_log(f"[Campaign] Manual compatibility run created {action_count} customer action(s) and {draft_count} approval draft(s)", "info")
    return jsonify({
        "message": f"Manual campaign run created {action_count} customer action(s) and {draft_count} approval draft(s)",
        "events": events,
        "dashboard": build_campaign_dashboard_payload()
    }), 200


@app.route('/api/campaign/lanes/<lane_id>/config', methods=['POST'])
def update_campaign_lane_config(lane_id):
    if lane_id not in CAMPAIGN_LANE_META:
        return jsonify({"error": "Unknown campaign lane."}), 404
    try:
        config = save_campaign_lane_config(lane_id, request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    add_log(f"[Campaign] Updated default settings for {CAMPAIGN_LANE_META[lane_id]['short_label']}", 'info')
    return jsonify({"message": "Lane defaults updated.", "lane": lane_id, "config": config, "dashboard": build_campaign_dashboard_payload()}), 200


@app.route('/api/campaign/lanes/<lane_id>/override', methods=['POST'])
def update_campaign_lane_override(lane_id):
    if lane_id not in CAMPAIGN_LANE_META:
        return jsonify({"error": "Unknown campaign lane."}), 404
    try:
        runtime = save_campaign_lane_override(lane_id, request.get_json(silent=True) or {})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    add_log(f"[Campaign] Saved today-only override for {CAMPAIGN_LANE_META[lane_id]['short_label']}", 'info')
    return jsonify({"message": "Today-only override saved.", "lane": lane_id, "runtime": runtime, "dashboard": build_campaign_dashboard_payload()}), 200


@app.route('/api/campaign/lanes/<lane_id>/override/clear', methods=['POST'])
def clear_campaign_lane_override_route(lane_id):
    if lane_id not in CAMPAIGN_LANE_META:
        return jsonify({"error": "Unknown campaign lane."}), 404
    runtime = clear_campaign_lane_override(lane_id)
    add_log(f"[Campaign] Cleared today-only override for {CAMPAIGN_LANE_META[lane_id]['short_label']}", 'info')
    return jsonify({"message": "Today-only override cleared.", "lane": lane_id, "runtime": runtime, "dashboard": build_campaign_dashboard_payload()}), 200


@app.route('/api/campaign/lanes/<lane_id>/pause', methods=['POST'])
def pause_campaign_lane_route(lane_id):
    if lane_id not in CAMPAIGN_LANE_META:
        return jsonify({"error": "Unknown campaign lane."}), 404
    paused = bool((request.get_json(silent=True) or {}).get('paused', True))
    runtime = set_campaign_lane_pause(lane_id, paused)
    add_log(f"[Campaign] {'Paused' if paused else 'Resumed'} {CAMPAIGN_LANE_META[lane_id]['short_label']} for today", 'warning' if paused else 'info')
    return jsonify({"message": "Lane pause state updated.", "lane": lane_id, "runtime": runtime, "dashboard": build_campaign_dashboard_payload()}), 200


@app.route('/api/campaign/reset_window', methods=['POST'])
def reset_campaign_window_route():
    reset_at = reset_campaign_window()
    add_log("[Campaign] Rolling brand window reset", "warning")
    return jsonify({
        "message": "Rolling brand window reset",
        "reset_at": reset_at.isoformat(),
        "dashboard": build_campaign_dashboard_payload()
    }), 200


@app.route('/api/campaign/accounts/<int:account_id>/role', methods=['POST'])
def update_campaign_account_role(account_id):
    account = db.session.get(Account, account_id)
    if not account:
        return jsonify({"error": "Not found"}), 404

    role = normalize_account_role((request.get_json(silent=True) or {}).get('role', ''))
    if not account_role_is_valid(role):
        return jsonify({"error": "Invalid role"}), 400

    account.role = role
    db.session.commit()
    add_log(f"[Campaign] Role set to '{role}'", "info", account.id)
    return jsonify(account.to_dict()), 200


@app.route('/api/campaign/actions/<int:action_id>/queue', methods=['POST'])
def queue_campaign_action(action_id):
    action = db.session.get(ManagedAction, action_id)
    if not action:
        return jsonify({"error": "Not found"}), 404
    if action.approval_state == 'pending':
        return jsonify({"error": "This action still requires approval."}), 400

    try:
        action, job = _queue_managed_action(action)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify({"message": "Managed action queued", "action": action.to_dict(), "job": job.to_dict()}), 200


@app.route('/api/campaign/actions/queue_all', methods=['POST'])
def queue_all_campaign_actions():
    planned_actions = ManagedAction.query.filter_by(status='planned').order_by(ManagedAction.created_at.asc()).all()
    queued = []
    errors = []

    for action in planned_actions:
        if action.approval_state == 'pending':
            continue
        try:
            queued_action, job = _queue_managed_action(action)
            queued.append({"action": queued_action.to_dict(), "job": job.to_dict()})
        except ValueError as exc:
            errors.append({"action_id": action.id, "title": action.title, "error": str(exc)})

    return jsonify({
        "message": f"Queued {len(queued)} action(s)",
        "queued": queued,
        "errors": errors,
        "dashboard": build_campaign_dashboard_payload()
    }), 200


@app.route('/api/campaign/actions/<int:action_id>/cancel', methods=['POST'])
def cancel_campaign_action(action_id):
    action = db.session.get(ManagedAction, action_id)
    if not action:
        return jsonify({"error": "Not found"}), 404
    if action.status != 'planned':
        return jsonify({"error": "Only planned actions can be dismissed here."}), 400

    action.status = 'cancelled'
    action.executed_at = datetime.now(UTC)
    db.session.commit()
    add_log(f"[Campaign] Dismissed managed action #{action.id}", "info", action.account_id)
    return jsonify({"message": "Managed action dismissed", "action": action.to_dict()}), 200


@app.route('/api/campaign/approvals/<int:draft_id>/approve', methods=['POST'])
def approve_campaign_draft(draft_id):
    draft = db.session.get(ApprovalDraft, draft_id)
    if not draft:
        return jsonify({"error": "Not found"}), 404
    if draft.status != 'pending':
        return jsonify({"error": "Draft has already been reviewed."}), 400

    params = json.loads(draft.params_json or '{}')
    final_comment = (draft.edited_comment or draft.generated_comment or '').strip()
    if not final_comment:
        return jsonify({"error": "No approved comment text is saved for this draft."}), 400

    normalized_thread_url = normalize_commented_post_url(draft.thread_url)
    if normalized_thread_url and has_account_commented_post(draft.account_id, normalized_thread_url):
        return jsonify({"error": f"This account already commented on the approved draft target post: {normalized_thread_url}"}), 400

    params['approved_comment'] = final_comment
    params['target_post_url'] = draft.thread_url
    params['target_post_title'] = draft.post_title
    draft_kind = draft.approval_kind() if hasattr(draft, 'approval_kind') else 'brand'
    content_mode = params.get('planned_content_mode') or ('expert' if draft_kind == 'employee_helpful' else 'brand')
    action = ManagedAction(
        account_id=draft.account_id,
        title=draft.title,
        action_type=draft.job_type,
        content_mode=content_mode,
        status='planned',
        approval_state='approved',
        keyword=draft.keyword,
        thread_url=draft.thread_url,
        notes=final_comment,
        params_json=json.dumps(params),
    )
    db.session.add(action)
    db.session.flush()

    try:
        action, job = _queue_managed_action(action)
    except ValueError as exc:
        db.session.rollback()
        return jsonify({"error": str(exc)}), 400

    review_role = draft_kind if draft_kind in {'customer_brand', 'employee_brand', 'employee_helpful'} else 'brand'
    review = ApprovalReview(
        draft_id=draft.id,
        account_id=draft.account_id,
        reviewer_id=g.current_user.id if g.get('current_user') and g.current_user.is_active else None,
        role=review_role,
        post_title=draft.post_title,
        post_body=draft.post_body,
        thread_url=draft.thread_url,
        original_comment=draft.generated_comment,
        final_comment=final_comment,
        approval_notes=draft.approval_notes,
    )
    db.session.add(review)
    db.session.flush()

    created_suggestions = []
    try:
        created_suggestions = _generate_learning_suggestions(review)
        if created_suggestions:
            add_log(f"[Memory] Created {len(created_suggestions)} learning suggestion(s) from draft #{draft.id}", 'info', draft.account_id)
    except Exception as exc:
        add_log(f"[Memory] Learning suggestion generation failed for draft #{draft.id}: {exc}", 'warning', draft.account_id)

    draft.status = 'approved'
    draft.reviewed_at = datetime.now(UTC)
    draft.managed_action_id = action.id

    db.session.commit()

    add_log(f"[Campaign] Approved {review_role.replace('_', ' ')} draft #{draft.id}", "success", draft.account_id)
    return jsonify({
        "message": "Draft approved and queued",
        "draft": draft.to_dict(),
        "action": action.to_dict(),
        "job": job.to_dict(),
        "learning_suggestions_created": len(created_suggestions),
    }), 200


@app.route('/api/campaign/approvals/<int:draft_id>/save', methods=['POST'])
def save_campaign_draft(draft_id):
    draft = db.session.get(ApprovalDraft, draft_id)
    if not draft:
        return jsonify({"error": "Not found"}), 404
    if draft.status != 'pending':
        return jsonify({"error": "Only pending drafts can be edited."}), 400

    data = request.get_json(silent=True) or {}
    edited_comment = str(data.get('edited_comment', '')).strip()
    approval_notes = str(data.get('approval_notes', '')).strip()
    if not edited_comment:
        return jsonify({"error": "Edited comment cannot be empty."}), 400

    draft.edited_comment = edited_comment
    draft.approval_notes = approval_notes or None
    params = json.loads(draft.params_json or '{}')
    params['approved_comment'] = edited_comment
    params['target_post_url'] = draft.thread_url
    params['target_post_title'] = draft.post_title
    draft.params_json = json.dumps(params)
    db.session.commit()
    return jsonify({"message": "Draft saved", "draft": draft.to_dict()}), 200


@app.route('/api/campaign/approvals/<int:draft_id>/reject', methods=['POST'])
def reject_campaign_draft(draft_id):
    draft = db.session.get(ApprovalDraft, draft_id)
    if not draft:
        return jsonify({"error": "Not found"}), 404
    if draft.status != 'pending':
        return jsonify({"error": "Draft has already been reviewed."}), 400

    draft.status = 'rejected'
    draft.reviewed_at = datetime.now(UTC)
    db.session.commit()
    add_log(f"[Campaign] Rejected brand draft #{draft.id}", "warning", draft.account_id)
    return jsonify({"message": "Draft rejected", "draft": draft.to_dict()}), 200

# ── Cron Jobs ─────────────────────────────────────────────────────────────────
from datetime import timezone

LOCAL_TZ = datetime.now().astimezone().tzinfo or timezone.utc
UTC_TZ = timezone.utc

def _compute_next_run(cron: 'CronJob') -> datetime:
    """Compute when this cron job should next fire using local machine time, stored as UTC."""
    import json
    cfg = json.loads(cron.schedule_config) if cron.schedule_config else {}
    now_utc = datetime.now(UTC).astimezone(UTC_TZ)
    now_local = now_utc.astimezone(LOCAL_TZ)

    if cron.schedule_type == 'interval':
        minutes = int(cfg.get('minutes', 60))
        candidate_local = now_local + timedelta(minutes=minutes)
        return candidate_local.astimezone(UTC_TZ).replace(tzinfo=None)

    elif cron.schedule_type == 'daily':
        t = cfg.get('time', '09:00')
        h, m = map(int, t.split(':'))
        candidate_local = now_local.replace(hour=h, minute=m, second=0, microsecond=0)
        if candidate_local <= now_local:
            candidate_local += timedelta(days=1)
        return candidate_local.astimezone(UTC_TZ).replace(tzinfo=None)

    elif cron.schedule_type == 'weekly':
        days = cfg.get('days', [0])  # 0=Mon
        t = cfg.get('time', '09:00')
        h, m = map(int, t.split(':'))
        today_wd = now_local.weekday()  # 0=Monday
        best = None
        for delta in range(1, 8):
            candidate_wd = (today_wd + delta) % 7
            if candidate_wd in days:
                candidate_local = (now_local + timedelta(days=delta)).replace(hour=h, minute=m, second=0, microsecond=0)
                if best is None or candidate_local < best:
                    best = candidate_local
        if today_wd in days:
            same_day = now_local.replace(hour=h, minute=m, second=0, microsecond=0)
            if same_day > now_local and (best is None or same_day < best):
                best = same_day
        return (best or (now_local + timedelta(hours=1))).astimezone(UTC_TZ).replace(tzinfo=None)

    return (now_local + timedelta(hours=1)).astimezone(UTC_TZ).replace(tzinfo=None)


def _cron_scheduler_loop():
    """Background thread: fire due cron jobs every 30 seconds."""
    import time as _time
    _time.sleep(10)  # brief delay on startup
    while True:
        try:
            with app.app_context():
                now = datetime.now(UTC).replace(tzinfo=None)
                due = CronJob.query.filter(
                    CronJob.is_active == True,
                    CronJob.next_run != None,
                    CronJob.next_run <= now
                ).all()
                for cron in due:
                    # Create a real Job record tagged with this cron
                    job = Job(
                        account_id=cron.account_id,
                        job_type=cron.job_type,
                        params_json=cron.params_json,
                        cron_job_id=cron.id
                    )
                    db.session.add(job)
                    db.session.flush()  # get job.id
                    add_log(f"[Cron] '{cron.name}' triggered job #{job.id} ({cron.job_type})", "info", cron.account_id)
                    cron.last_run = now
                    cron.next_run = _compute_next_run(cron)
                    db.session.commit()
                    # Run in background thread
                    _start_job_thread(job.id)

                lane_events = dispatch_simplified_campaign(now_utc=now, queue_callback=_queue_managed_action)
                for event in lane_events:
                    if event.get('kind') == 'action':
                        add_log(f"[Campaign] {event.get('lane_label')} auto-queued {event.get('account_username')}", 'success', event.get('account_id'))
                    elif event.get('kind') == 'draft':
                        add_log(f"[Campaign] {event.get('lane_label')} prepared an approval draft for {event.get('account_username')}", 'info', event.get('account_id'))

                digest_result = send_scheduled_approval_digest(now_utc=now)
                if digest_result.get('sent'):
                    add_log(f"[Email] Approval digest sent for {digest_result.get('count', 0)} draft(s) to {', '.join(digest_result.get('recipients', []))}", 'success')
                elif digest_result.get('reason') not in {'notifications_disabled', 'not_due_yet', 'already_ran_today', 'no_drafts_due'}:
                    add_log(f"[Email] Approval digest skipped: {digest_result.get('reason')}", 'warning')

                db.session.remove()
        except Exception as e:
            try:
                with app.app_context():
                    db.session.rollback()
                    db.session.remove()
            except Exception:
                pass
            print(f"[Cron Scheduler] Error: {e}")
        _time.sleep(30)


@app.route('/api/cron', methods=['GET'])
def list_cron_jobs():
    jobs = CronJob.query.order_by(CronJob.created_at.desc()).all()
    return jsonify([j.to_dict() for j in jobs])


@app.route('/api/cron', methods=['POST'])
def create_cron_job():
    data = request.get_json(silent=True) or {}
    account_id = data.get('account_id')
    if not account_id or not db.session.get(Account, account_id):
        return jsonify({"error": "Invalid account_id"}), 400

    cron = CronJob(
        name=data.get('name', 'Unnamed Schedule'),
        account_id=account_id,
        job_type=data.get('job_type', 'search'),
        params_json=json.dumps(data.get('params', {})),
        schedule_type=data.get('schedule_type', 'interval'),
        schedule_config=json.dumps(data.get('schedule_config', {})),
        is_active=data.get('is_active', True)
    )
    db.session.add(cron)
    db.session.flush()
    cron.next_run = _compute_next_run(cron)
    db.session.commit()
    return jsonify(cron.to_dict()), 201


@app.route('/api/cron/<int:cron_id>', methods=['PUT'])
def update_cron_job(cron_id):
    cron = db.session.get(CronJob, cron_id)
    if not cron:
        return jsonify({"error": "Not found"}), 404
    data = request.get_json(silent=True) or {}
    if 'name' in data: cron.name = data['name']
    if 'job_type' in data: cron.job_type = data['job_type']
    if 'params' in data: cron.params_json = json.dumps(data['params'])
    if 'schedule_type' in data: cron.schedule_type = data['schedule_type']
    if 'schedule_config' in data: cron.schedule_config = json.dumps(data['schedule_config'])
    if 'is_active' in data:
        cron.is_active = bool(data['is_active'])
    cron.next_run = _compute_next_run(cron)
    db.session.commit()
    return jsonify(cron.to_dict()), 200


@app.route('/api/cron/<int:cron_id>', methods=['DELETE'])
def delete_cron_job(cron_id):
    cron = db.session.get(CronJob, cron_id)
    if not cron:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(cron)
    db.session.commit()
    return jsonify({"message": "Deleted"}), 200


@app.route('/api/cron/<int:cron_id>/trigger', methods=['POST'])
def trigger_cron_now(cron_id):
    """Manually fire a cron job immediately."""
    cron = db.session.get(CronJob, cron_id)
    if not cron:
        return jsonify({"error": "Not found"}), 404
    job = Job(
        account_id=cron.account_id,
        job_type=cron.job_type,
        params_json=cron.params_json,
        cron_job_id=cron.id
    )
    db.session.add(job)
    db.session.flush()
    cron.last_run = datetime.now(UTC)
    cron.next_run = _compute_next_run(cron)
    db.session.commit()
    add_log(f"[Cron] '{cron.name}' manually triggered", "info", cron.account_id)
    _start_job_thread(job.id)
    return jsonify({"message": "Triggered", "job": job.to_dict()}), 200


# Start scheduler thread when server launches
if os.environ.get('FLASK_ENV') != 'test':
    _sched_thread = threading.Thread(target=_cron_scheduler_loop, daemon=True)
    _sched_thread.start()


if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG', 'false').lower() == 'true', port=int(os.environ.get('PORT', 5000)))
