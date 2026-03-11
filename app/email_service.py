import smtplib
from datetime import UTC, datetime, timezone
from email.message import EmailMessage

from models import ApprovalDraft, Setting, db


LOCAL_TZ = datetime.now().astimezone().tzinfo or timezone.utc
UTC_TZ = timezone.utc


def _setting_value(key, default=''):
    setting = Setting.query.filter_by(key=key).first()
    return setting.value if setting and setting.value is not None else default


def _bool_setting_value(key, default=False):
    return _setting_value(key, 'true' if default else 'false').strip().lower() in {'1', 'true', 'yes', 'on'}


def normalize_recipient_emails(raw_value):
    if isinstance(raw_value, list):
        candidates = raw_value
    else:
        text = str(raw_value or '')
        candidates = text.replace('\r', '\n').replace(',', '\n').split('\n')
    emails = []
    for item in candidates:
        email = str(item).strip()
        if email and email not in emails:
            emails.append(email)
    return emails


def get_email_settings(include_secret=False):
    payload = {
        'smtp_host': _setting_value('smtp_host', 'smtp.gmail.com'),
        'smtp_port': _setting_value('smtp_port', '587'),
        'smtp_username': _setting_value('smtp_username', ''),
        'smtp_from_name': _setting_value('smtp_from_name', 'Reddit Bot Manager'),
        'smtp_from_email': _setting_value('smtp_from_email', _setting_value('smtp_username', '')),
        'email_recipients': _setting_value('email_recipients', ''),
        'email_base_url': _setting_value('email_base_url', ''),
        'email_notifications_enabled': _bool_setting_value('email_notifications_enabled', False),
        'approval_digest_time': _setting_value('approval_digest_time', '08:00') or '08:00',
        'approval_digest_last_run_on': _setting_value('approval_digest_last_run_on', ''),
        'smtp_app_password_configured': bool(_setting_value('smtp_app_password', '')),
    }
    if include_secret:
        payload['smtp_app_password'] = _setting_value('smtp_app_password', '')
    return payload


def normalize_digest_time(raw_value, default='08:00'):
    text = str(raw_value or default).strip()
    try:
        parsed = datetime.strptime(text, '%H:%M')
    except ValueError as exc:
        raise ValueError('Digest time must use HH:MM in 24-hour format.') from exc
    return parsed.strftime('%H:%M')


def send_email_message(subject, body, to_emails, override_settings=None):
    settings = get_email_settings(include_secret=True)
    if override_settings:
        settings.update(override_settings)

    host = str(settings.get('smtp_host', 'smtp.gmail.com') or 'smtp.gmail.com').strip()
    port = int(str(settings.get('smtp_port', '587') or '587').strip())
    username = str(settings.get('smtp_username', '') or '').strip()
    password = str(settings.get('smtp_app_password', '') or '').strip()
    from_name = str(settings.get('smtp_from_name', 'Reddit Bot Manager') or 'Reddit Bot Manager').strip()
    from_email = str(settings.get('smtp_from_email', username) or username).strip()
    recipients = normalize_recipient_emails(to_emails)

    if not host or not username or not password or not from_email:
        raise ValueError('Email settings are incomplete. Please configure SMTP host, username, app password, and from email.')
    if not recipients:
        raise ValueError('Please provide at least one recipient email address.')

    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = f'{from_name} <{from_email}>' if from_name else from_email
    message['To'] = ', '.join(recipients)
    message.set_content(body)

    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.starttls()
        smtp.login(username, password)
        smtp.send_message(message)

    return {'recipients': recipients, 'host': host, 'port': port}


def _build_digest_body(drafts, base_url):
    lines = [
        'Approval digest from Reddit Bot Manager.',
        '',
    ]

    for draft in drafts:
        draft_url = f"{base_url}/?section=campaign&draft={draft.id}"
        preview = (draft.edited_comment or draft.generated_comment or '').strip()
        if len(preview) > 200:
            preview = preview[:197].rstrip() + '...'
        lines.extend([
            f"- {draft.title}",
            f"  Role: {draft.account.role.title() if draft.account and draft.account.role else 'Brand'}",
            f"  Agent: {draft.account.username if draft.account else 'Unknown'}",
            f"  Post: {draft.post_title or draft.thread_url or 'Untitled'}",
            f"  Draft preview: {preview or '(no draft text)'}",
            f"  Review link: {draft_url}",
            '',
        ])

    lines.append('Log in to the dashboard to review, edit, and approve these comments.')
    return '\n'.join(lines)


def send_approval_notification(drafts, override_settings=None, subject_prefix='Approval digest'):
    settings = get_email_settings(include_secret=True)
    if override_settings:
        settings.update(override_settings)
    if not settings.get('email_notifications_enabled'):
        return {'sent': False, 'reason': 'notifications_disabled'}

    recipients = normalize_recipient_emails(settings.get('email_recipients', ''))
    base_url = (settings.get('email_base_url') or '').strip().rstrip('/')
    if not recipients:
        return {'sent': False, 'reason': 'no_recipients'}
    if not base_url:
        return {'sent': False, 'reason': 'missing_base_url'}
    if not drafts:
        return {'sent': False, 'reason': 'no_drafts'}

    body = _build_digest_body(drafts, base_url)

    subject_label = str(subject_prefix or 'Approval digest').strip()
    send_info = send_email_message(
        subject=f"[{len(drafts)}] {subject_label} item{'s' if len(drafts) != 1 else ''} waiting in Reddit Bot Manager",
        body=body,
        to_emails=recipients,
        override_settings=settings,
    )
    return {'sent': True, 'count': len(drafts), 'recipients': send_info['recipients']}


def send_scheduled_approval_digest(now_utc=None, force=False):
    settings = get_email_settings(include_secret=True)
    if not settings.get('email_notifications_enabled'):
        return {'sent': False, 'reason': 'notifications_disabled'}

    digest_time = normalize_digest_time(settings.get('approval_digest_time', '08:00'))
    now_utc = now_utc or datetime.now(UTC)
    now_local = now_utc.replace(tzinfo=UTC_TZ).astimezone(LOCAL_TZ)
    scheduled_today_local = now_local.replace(
        hour=int(digest_time[:2]),
        minute=int(digest_time[3:5]),
        second=0,
        microsecond=0,
    )
    today_key = now_local.date().isoformat()
    last_run_on = str(settings.get('approval_digest_last_run_on') or '').strip()

    if not force:
        if now_local < scheduled_today_local:
            return {'sent': False, 'reason': 'not_due_yet', 'scheduled_time': digest_time}
        if last_run_on == today_key:
            return {'sent': False, 'reason': 'already_ran_today', 'scheduled_time': digest_time}

    cutoff_utc = now_utc if force else scheduled_today_local.astimezone(UTC_TZ).replace(tzinfo=None)
    drafts = ApprovalDraft.query.filter_by(status='pending') \
        .filter(ApprovalDraft.digest_sent_at.is_(None)) \
        .filter(ApprovalDraft.created_at <= cutoff_utc) \
        .order_by(ApprovalDraft.created_at.asc()) \
        .all()

    if not drafts:
        if not force:
            setting = Setting.query.filter_by(key='approval_digest_last_run_on').first()
            if setting:
                setting.value = today_key
            else:
                setting = Setting(key='approval_digest_last_run_on', value=today_key)
                db.session.add(setting)
            db.session.commit()
        return {'sent': False, 'reason': 'no_drafts_due', 'scheduled_time': digest_time}

    send_info = send_approval_notification(drafts, override_settings=settings, subject_prefix='Approval digest')
    if not send_info.get('sent'):
        return send_info

    for draft in drafts:
        draft.digest_sent_at = now_utc
    setting = Setting.query.filter_by(key='approval_digest_last_run_on').first()
    if setting:
        setting.value = today_key
    else:
        db.session.add(Setting(key='approval_digest_last_run_on', value=today_key))
    db.session.commit()

    send_info['scheduled_time'] = digest_time
    send_info['draft_ids'] = [draft.id for draft in drafts]
    return send_info
