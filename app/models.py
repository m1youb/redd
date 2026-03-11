import os
from flask_sqlalchemy import SQLAlchemy
from cryptography.fernet import Fernet
from datetime import UTC, datetime
from werkzeug.security import check_password_hash, generate_password_hash

db = SQLAlchemy()

# Encryption Key Management
basedir = os.path.abspath(os.path.dirname(__file__))
KEY_FILE = os.path.join(basedir, "secret.key")

def get_encryption_key():
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as key_file:
            return key_file.read()
    else:
        key = Fernet.generate_key()
        with open(KEY_FILE, "wb") as key_file:
            key_file.write(key)
        return key

cipher_suite = Fernet(get_encryption_key())

class Proxy(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    address = db.Column(db.String(200), unique=True, nullable=False)
    status = db.Column(db.String(20), default="active")
    proxy_type = db.Column(db.String(50), default="manual")
    location = db.Column(db.String(100), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "address": self.address,
            "status": self.status,
            "proxy_type": self.proxy_type,
            "location": self.location
        }


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='reviewer')
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)

class Account(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_encrypted = db.Column(db.Text, nullable=False)
    proxy = db.Column(db.String(200), nullable=True)
    proxy_id = db.Column(db.Integer, db.ForeignKey('proxy.id'), nullable=True)
    status = db.Column(db.String(20), default="idle")
    cookies_json = db.Column(db.Text, nullable=True)
    personality = db.Column(db.Text, nullable=True)
    persona_name = db.Column(db.String(100), nullable=True)
    interests = db.Column(db.Text, nullable=True)
    role = db.Column(db.String(20), nullable=False, default="inactive")

    assigned_proxy = db.relationship('Proxy', backref='assigned_accounts')
    jobs = db.relationship('Job', backref='account', lazy='dynamic', cascade='all, delete-orphan')

    def __init__(self, username, password, proxy=None):
        self.username = username
        self.password_encrypted = cipher_suite.encrypt(password.encode()).decode()
        self.proxy = proxy

    @property
    def password(self):
        return cipher_suite.decrypt(self.password_encrypted.encode()).decode()

    def to_dict(self, include_password=False, include_cookies=False):
        data = {
            "id": self.id,
            "username": self.username,
            "proxy": self.proxy,
            "proxy_id": self.proxy_id,
            "proxy_address": self.assigned_proxy.address if self.assigned_proxy else None,
            "proxy_location": self.assigned_proxy.location if self.assigned_proxy else None,
            "status": self.status,
            "has_cookies": bool(self.cookies_json),
            "personality": self.personality,
            "persona_name": self.persona_name,
            "interests": self.interests,
            "role": self.role
        }
        if include_password:
            data["password"] = self.password
        if include_cookies:
            data["cookies_json"] = self.cookies_json
        return data


class CronJob(db.Model):
    """Scheduled recurring job definition."""
    __tablename__ = 'cron_job'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=False)
    job_type = db.Column(db.String(50), nullable=False)
    params_json = db.Column(db.Text, nullable=True)

    # schedule_type: 'interval' | 'daily' | 'weekly'
    schedule_type = db.Column(db.String(20), nullable=False, default='interval')
    # interval  -> {"minutes": 30}
    # daily     -> {"time": "16:00"}
    # weekly    -> {"days": [0,2,4], "time": "10:00"}  (0=Mon … 6=Sun)
    schedule_config = db.Column(db.Text, nullable=False, default='{}')

    is_active = db.Column(db.Boolean, default=True)
    last_run = db.Column(db.DateTime, nullable=True)
    next_run = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))

    account = db.relationship('Account', backref='cron_jobs')
    triggered_jobs = db.relationship('Job', backref='cron_source', lazy='dynamic')

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "name": self.name,
            "account_id": self.account_id,
            "account_username": self.account.username if self.account else None,
            "job_type": self.job_type,
            "params": json.loads(self.params_json) if self.params_json else {},
            "schedule_type": self.schedule_type,
            "schedule_config": json.loads(self.schedule_config) if self.schedule_config else {},
            "is_active": self.is_active,
            "last_run": self.last_run.isoformat() if self.last_run else None,
            "next_run": self.next_run.isoformat() if self.next_run else None,
            "created_at": self.created_at.isoformat()
        }


class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=False)
    job_type = db.Column(db.String(50), nullable=False)
    params_json = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), default="pending")
    result_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))
    started_at = db.Column(db.DateTime, nullable=True)
    last_heartbeat = db.Column(db.DateTime, nullable=True)
    cron_job_id = db.Column(db.Integer, db.ForeignKey('cron_job.id'), nullable=True)

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "account_id": self.account_id,
            "job_type": self.job_type,
            "params": json.loads(self.params_json) if self.params_json else {},
            "status": self.status,
            "result": json.loads(self.result_json) if self.result_json else None,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "last_heartbeat": self.last_heartbeat.isoformat() if self.last_heartbeat else None,
            "cron_job_id": self.cron_job_id
        }


class ManagedAction(db.Model):
    __tablename__ = 'managed_action'

    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=False)
    job_id = db.Column(db.Integer, db.ForeignKey('job.id'), nullable=True)
    title = db.Column(db.String(200), nullable=False)
    action_type = db.Column(db.String(50), nullable=False)
    content_mode = db.Column(db.String(30), nullable=False, default='organic')
    status = db.Column(db.String(20), nullable=False, default='planned')
    approval_state = db.Column(db.String(20), nullable=False, default='not_required')
    keyword = db.Column(db.String(200), nullable=True)
    thread_url = db.Column(db.Text, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    params_json = db.Column(db.Text, nullable=True)
    result_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))
    queued_at = db.Column(db.DateTime, nullable=True)
    executed_at = db.Column(db.DateTime, nullable=True)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    account = db.relationship('Account', backref='managed_actions')
    job = db.relationship('Job', backref='managed_action', uselist=False)

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "account_id": self.account_id,
            "account_username": self.account.username if self.account else None,
            "role": self.account.role if self.account else None,
            "job_id": self.job_id,
            "title": self.title,
            "action_type": self.action_type,
            "content_mode": self.content_mode,
            "status": self.status,
            "approval_state": self.approval_state,
            "keyword": self.keyword,
            "thread_url": self.thread_url,
            "notes": self.notes,
            "params": json.loads(self.params_json) if self.params_json else {},
            "result": json.loads(self.result_json) if self.result_json else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "queued_at": self.queued_at.isoformat() if self.queued_at else None,
            "executed_at": self.executed_at.isoformat() if self.executed_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None
        }


class ApprovalDraft(db.Model):
    __tablename__ = 'approval_draft'

    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=False)
    managed_action_id = db.Column(db.Integer, db.ForeignKey('managed_action.id'), nullable=True)
    title = db.Column(db.String(200), nullable=False)
    job_type = db.Column(db.String(50), nullable=False)
    keyword = db.Column(db.String(200), nullable=True)
    thread_url = db.Column(db.Text, nullable=True)
    post_title = db.Column(db.Text, nullable=True)
    post_body = db.Column(db.Text, nullable=True)
    post_author = db.Column(db.String(120), nullable=True)
    subreddit_name = db.Column(db.String(120), nullable=True)
    has_media = db.Column(db.Boolean, nullable=False, default=False)
    media_hint = db.Column(db.String(120), nullable=True)
    brief = db.Column(db.Text, nullable=True)
    generated_comment = db.Column(db.Text, nullable=True)
    edited_comment = db.Column(db.Text, nullable=True)
    approval_notes = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default='pending')
    params_json = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))
    digest_sent_at = db.Column(db.DateTime, nullable=True)
    prepared_at = db.Column(db.DateTime, nullable=True)
    reviewed_at = db.Column(db.DateTime, nullable=True)

    account = db.relationship('Account', backref='approval_drafts')
    managed_action = db.relationship('ManagedAction', backref='approval_draft', uselist=False)

    def approval_kind(self):
        import json
        params = json.loads(self.params_json) if self.params_json else {}
        approval_kind = str(params.get('approval_kind') or '').strip().lower()
        if approval_kind in {'customer_brand', 'employee_brand', 'employee_helpful'}:
            return approval_kind
        if self.account and self.account.role == 'customer':
            return 'customer_brand'
        if self.account and self.account.role in {'employee', 'pro'}:
            return 'employee_brand'
        return 'brand'

    def to_dict(self):
        import json
        return {
            "id": self.id,
            "account_id": self.account_id,
            "account_username": self.account.username if self.account else None,
            "role": self.account.role if self.account else None,
            "draft_type": self.approval_kind(),
            "managed_action_id": self.managed_action_id,
            "title": self.title,
            "job_type": self.job_type,
            "keyword": self.keyword,
            "thread_url": self.thread_url,
            "post_title": self.post_title,
            "post_body": self.post_body,
            "post_author": self.post_author,
            "subreddit_name": self.subreddit_name,
            "has_media": self.has_media,
            "media_hint": self.media_hint,
            "brief": self.brief,
            "generated_comment": self.generated_comment,
            "edited_comment": self.edited_comment,
            "approval_notes": self.approval_notes,
            "status": self.status,
            "params": json.loads(self.params_json) if self.params_json else {},
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "digest_sent_at": self.digest_sent_at.isoformat() if self.digest_sent_at else None,
            "prepared_at": self.prepared_at.isoformat() if self.prepared_at else None,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None
        }


class ApprovalReview(db.Model):
    __tablename__ = 'approval_review'

    id = db.Column(db.Integer, primary_key=True)
    draft_id = db.Column(db.Integer, db.ForeignKey('approval_draft.id'), nullable=False)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=False)
    reviewer_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    role = db.Column(db.String(30), nullable=False, default='brand')
    post_title = db.Column(db.Text, nullable=True)
    post_body = db.Column(db.Text, nullable=True)
    thread_url = db.Column(db.Text, nullable=True)
    original_comment = db.Column(db.Text, nullable=True)
    final_comment = db.Column(db.Text, nullable=False)
    approval_notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))

    draft = db.relationship('ApprovalDraft', backref='reviews')
    account = db.relationship('Account', backref='approval_reviews')
    reviewer = db.relationship('User', backref='approval_reviews')

    def to_dict(self):
        return {
            "id": self.id,
            "draft_id": self.draft_id,
            "account_id": self.account_id,
            "account_username": self.account.username if self.account else None,
            "reviewer_id": self.reviewer_id,
            "reviewer_username": self.reviewer.username if self.reviewer else None,
            "role": self.role,
            "post_title": self.post_title,
            "post_body": self.post_body,
            "thread_url": self.thread_url,
            "original_comment": self.original_comment,
            "final_comment": self.final_comment,
            "approval_notes": self.approval_notes,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class MemorySuggestion(db.Model):
    __tablename__ = 'memory_suggestion'

    id = db.Column(db.Integer, primary_key=True)
    source_review_id = db.Column(db.Integer, db.ForeignKey('approval_review.id'), nullable=False)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=True)
    draft_type = db.Column(db.String(30), nullable=False, default='brand')
    category = db.Column(db.String(50), nullable=False, default='operations')
    title = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=False)
    confidence = db.Column(db.Integer, nullable=False, default=3)
    status = db.Column(db.String(20), nullable=False, default='pending')
    approved_memory_id = db.Column(db.Integer, db.ForeignKey('business_memory.id'), nullable=True)
    reviewed_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))
    reviewed_at = db.Column(db.DateTime, nullable=True)

    source_review = db.relationship('ApprovalReview', backref='memory_suggestions')
    account = db.relationship('Account', backref='memory_suggestions')
    approved_memory = db.relationship('BusinessMemory', foreign_keys=[approved_memory_id], backref='origin_suggestions')
    reviewer = db.relationship('User', foreign_keys=[reviewed_by], backref='reviewed_memory_suggestions')

    def to_dict(self):
        return {
            "id": self.id,
            "source_review_id": self.source_review_id,
            "account_id": self.account_id,
            "account_username": self.account.username if self.account else None,
            "draft_type": self.draft_type,
            "category": self.category,
            "title": self.title,
            "content": self.content,
            "confidence": self.confidence,
            "status": self.status,
            "approved_memory_id": self.approved_memory_id,
            "reviewed_by": self.reviewed_by,
            "reviewed_by_username": self.reviewer.username if self.reviewer else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "reviewed_at": self.reviewed_at.isoformat() if self.reviewed_at else None,
            "source_review": {
                "id": self.source_review.id if self.source_review else None,
                "role": self.source_review.role if self.source_review else None,
                "post_title": self.source_review.post_title if self.source_review else None,
                "original_comment": self.source_review.original_comment if self.source_review else None,
                "final_comment": self.source_review.final_comment if self.source_review else None,
                "approval_notes": self.source_review.approval_notes if self.source_review else None,
                "reviewer_username": self.source_review.reviewer.username if self.source_review and self.source_review.reviewer else None,
            },
        }


class BusinessMemory(db.Model):
    __tablename__ = 'business_memory'

    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(50), nullable=False, default='operations')
    title = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text, nullable=False)
    priority = db.Column(db.Integer, nullable=False, default=3)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    source_review_id = db.Column(db.Integer, db.ForeignKey('approval_review.id'), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))

    source_review = db.relationship('ApprovalReview', backref='business_memory_entries')
    creator = db.relationship('User', backref='business_memory_entries')

    def to_dict(self):
        return {
            "id": self.id,
            "category": self.category,
            "title": self.title,
            "content": self.content,
            "priority": self.priority,
            "is_active": self.is_active,
            "source_review_id": self.source_review_id,
            "created_by": self.created_by,
            "created_by_username": self.creator.username if self.creator else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class Log(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.now(UTC))
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=True)
    level = db.Column(db.String(20), default="info")
    message = db.Column(db.Text, nullable=False)

    def to_dict(self):
        acc = db.session.get(Account, self.account_id) if self.account_id else None
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "account_id": self.account_id,
            "account_username": acc.username if acc else None,
            "level": self.level,
            "message": self.message
        }

class CommentedPost(db.Model):
    """Tracks post URLs that an account has already commented on, to avoid duplicates."""
    __tablename__ = 'commented_post'
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=False)
    post_url = db.Column(db.Text, nullable=False)
    post_title = db.Column(db.Text, nullable=True)
    commented_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))

    account = db.relationship('Account', backref='commented_posts')

    def to_dict(self):
        return {
            "id": self.id,
            "account_id": self.account_id,
            "post_url": self.post_url,
            "post_title": self.post_title,
            "commented_at": self.commented_at.isoformat()
        }

class Setting(db.Model):

    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            "key": self.key,
            "value": self.value
        }


class SearchHistory(db.Model):
    """Tracks keywords that have already been searched by an account to avoid repetition."""
    __tablename__ = 'search_history'
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('account.id'), nullable=False)
    keyword = db.Column(db.String(200), nullable=False)
    searched_at = db.Column(db.DateTime, default=lambda: datetime.now(UTC))

    account = db.relationship('Account', backref='search_history_records')

    def to_dict(self):
        return {
            "id": self.id,
            "account_id": self.account_id,
            "keyword": self.keyword,
            "searched_at": self.searched_at.isoformat()
        }
