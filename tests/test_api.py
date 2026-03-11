"""Tests for core API endpoints: accounts, proxies, settings, logs, cron."""
import json


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════════

class TestAuth:
    def test_unauthenticated_request_returns_401(self, client):
        resp = client.get('/api/accounts')
        assert resp.status_code == 401

    def test_login_with_valid_credentials(self, auth_client):
        resp = auth_client.get('/api/auth/status')
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['user'] is not None
        assert data['user']['username'] == 'testadmin'

    def test_login_with_invalid_credentials(self, client, app):
        resp = client.post('/api/login', json={
            'identity': 'nobody',
            'password': 'wrong',
        })
        assert resp.status_code == 401

    def test_logout(self, auth_client):
        resp = auth_client.post('/api/logout')
        assert resp.status_code == 200
        # After logout, should be unauthenticated
        resp2 = auth_client.get('/api/accounts')
        assert resp2.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════════
# ACCOUNTS
# ═══════════════════════════════════════════════════════════════════════════════

class TestAccounts:
    def test_add_account(self, auth_client):
        resp = auth_client.post('/api/accounts', json={
            'username': 'testuser123',
            'password': 'testpassword',
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['username'] == 'testuser123'
        assert data['status'] == 'idle'

    def test_get_accounts(self, auth_client):
        auth_client.post('/api/accounts', json={'username': 'user1', 'password': 'pw'})
        auth_client.post('/api/accounts', json={'username': 'user2', 'password': 'pw'})
        resp = auth_client.get('/api/accounts')
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) >= 2
        usernames = [a['username'] for a in data]
        assert 'user1' in usernames
        assert 'user2' in usernames

    def test_get_accounts_full(self, auth_client):
        auth_client.post('/api/accounts', json={'username': 'full_user', 'password': 'pw'})
        resp = auth_client.get('/api/accounts/full')
        assert resp.status_code == 200
        data = resp.get_json()
        assert any(a['username'] == 'full_user' for a in data)

    def test_update_account_personality(self, auth_client):
        post_res = auth_client.post('/api/accounts', json={'username': 'user_pers', 'password': 'pw'})
        act_id = post_res.get_json()['id']

        put_res = auth_client.put(f'/api/accounts/{act_id}', json={
            'personality': 'You are a friendly bot',
        })
        assert put_res.status_code == 200

        # Verify via full accounts
        fetch_res = auth_client.get('/api/accounts/full')
        acts = fetch_res.get_json()
        act = next((a for a in acts if a['id'] == act_id), None)
        assert act is not None
        assert act['personality'] == 'You are a friendly bot'

    def test_update_account_role(self, auth_client):
        post_res = auth_client.post('/api/accounts', json={'username': 'role_user', 'password': 'pw'})
        act_id = post_res.get_json()['id']

        put_res = auth_client.put(f'/api/accounts/{act_id}', json={'role': 'customer'})
        assert put_res.status_code == 200

        fetch_res = auth_client.get('/api/accounts/full')
        acts = fetch_res.get_json()
        act = next(a for a in acts if a['id'] == act_id)
        assert act['role'] == 'customer'

    def test_delete_account(self, auth_client):
        post_res = auth_client.post('/api/accounts', json={'username': 'todelete', 'password': 'pw'})
        act_id = post_res.get_json()['id']

        del_res = auth_client.delete(f'/api/accounts/{act_id}')
        assert del_res.status_code == 200

        accounts = auth_client.get('/api/accounts').get_json()
        assert not any(a['id'] == act_id for a in accounts)

    def test_delete_nonexistent_account(self, auth_client):
        resp = auth_client.delete('/api/accounts/99999')
        assert resp.status_code == 404

    def test_bulk_create_accounts(self, auth_client):
        resp = auth_client.post('/api/accounts/bulk', json={
            'lines': ['bulkuser1:pass1', 'bulkuser2:pass2'],
        })
        assert resp.status_code in (200, 201)
        accounts = auth_client.get('/api/accounts').get_json()
        usernames = [a['username'] for a in accounts]
        assert 'bulkuser1' in usernames
        assert 'bulkuser2' in usernames


# ═══════════════════════════════════════════════════════════════════════════════
# PROXIES
# ═══════════════════════════════════════════════════════════════════════════════

class TestProxies:
    def test_add_proxies(self, auth_client):
        resp = auth_client.post('/api/proxies', json={
            'addresses': ['127.0.0.1:8080', '127.0.0.1:8081'],
            'proxyType': 'manual',
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert len(data['added']) == 2
        addresses = [p['address'] for p in data['added']]
        assert '127.0.0.1:8080' in addresses

    def test_get_proxies(self, auth_client):
        auth_client.post('/api/proxies', json={'addresses': ['10.0.0.1:80']})
        resp = auth_client.get('/api/proxies')
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) >= 1

    def test_proxy_assignment(self, auth_client):
        pxy_res = auth_client.post('/api/proxies', json={'addresses': ['10.0.0.1:80']})
        proxy_id = pxy_res.get_json()['added'][0]['id']

        act1_id = auth_client.post('/api/accounts', json={'username': 'pa1', 'password': 'p'}).get_json()['id']
        act2_id = auth_client.post('/api/accounts', json={'username': 'pa2', 'password': 'p'}).get_json()['id']

        # Assign proxy to both accounts
        res1 = auth_client.post(f'/api/accounts/{act1_id}/assign_proxy', json={'proxy_id': proxy_id})
        assert res1.status_code == 200
        assert res1.get_json()['proxy_id'] == proxy_id

        res2 = auth_client.post(f'/api/accounts/{act2_id}/assign_proxy', json={'proxy_id': proxy_id})
        assert res2.status_code == 200

        # Verify
        acts = auth_client.get('/api/accounts').get_json()
        for a in acts:
            if a['id'] in [act1_id, act2_id]:
                assert a['proxy_id'] == proxy_id

        # Unassign
        res3 = auth_client.post(f'/api/accounts/{act1_id}/assign_proxy', json={'proxy_id': None})
        assert res3.get_json()['proxy_id'] is None

    def test_delete_all_proxies(self, auth_client):
        auth_client.post('/api/proxies', json={'addresses': ['1.1.1.1:80', '2.2.2.2:80']})
        del_res = auth_client.delete('/api/proxies/delete-all')
        assert del_res.status_code == 200
        proxies = auth_client.get('/api/proxies').get_json()
        assert len(proxies) == 0

    def test_delete_single_proxy(self, auth_client):
        pxy_res = auth_client.post('/api/proxies', json={'addresses': ['5.5.5.5:80']})
        proxy_id = pxy_res.get_json()['added'][0]['id']

        del_res = auth_client.delete(f'/api/proxies/{proxy_id}')
        assert del_res.status_code == 200

        proxies = auth_client.get('/api/proxies').get_json()
        assert not any(p['id'] == proxy_id for p in proxies)


# ═══════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═══════════════════════════════════════════════════════════════════════════════

class TestSettings:
    def test_get_settings(self, auth_client):
        resp = auth_client.get('/api/settings')
        assert resp.status_code == 200
        assert isinstance(resp.get_json(), dict)

    def test_update_settings(self, auth_client):
        resp = auth_client.post('/api/settings', json={
            'claude_api_key': 'sk-ant-test123',
            'claude_model_comment': 'claude-test-model',
        })
        assert resp.status_code == 200

        data = auth_client.get('/api/settings').get_json()
        assert data['claude_api_key'] == 'sk-ant-test123'
        assert data['claude_model_comment'] == 'claude-test-model'

    def test_update_settings_smtp(self, auth_client):
        resp = auth_client.post('/api/settings', json={
            'smtp_host': 'smtp.test.com',
            'smtp_port': '465',
            'smtp_username': 'test@test.com',
            'smtp_app_password': 'secret123',
        })
        assert resp.status_code == 200

        data = auth_client.get('/api/settings').get_json()
        assert data['smtp_host'] == 'smtp.test.com'
        assert data['smtp_port'] == '465'
        # Password should not be returned, only the configured flag
        assert data.get('smtp_app_password_configured') is True

    def test_empty_password_not_cleared(self, auth_client):
        # Set a password first
        auth_client.post('/api/settings', json={'smtp_app_password': 'realpass'})
        # Update with empty password — should not overwrite
        auth_client.post('/api/settings', json={
            'smtp_app_password': '',
            'smtp_host': 'new.host.com',
        })
        data = auth_client.get('/api/settings').get_json()
        assert data.get('smtp_app_password_configured') is True
        assert data['smtp_host'] == 'new.host.com'

    def test_settings_requires_admin(self, reviewer_client):
        resp = reviewer_client.post('/api/settings', json={
            'claude_api_key': 'hacked',
        })
        assert resp.status_code == 403

    def test_get_settings_allowed_for_reviewer(self, reviewer_client):
        resp = reviewer_client.get('/api/settings')
        assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# LOGS
# ═══════════════════════════════════════════════════════════════════════════════

class TestLogs:
    def test_get_logs_empty(self, auth_client):
        resp = auth_client.get('/api/logs')
        assert resp.status_code == 200
        # May include the signup log
        assert isinstance(resp.get_json(), list)

    def test_get_logs_with_data(self, auth_client, app):
        from models import Log
        with app.app_context():
            db = Log.__class__.__mro__  # just to avoid reimport
            from app import db as _db
            _db.session.add(Log(level='error', message='Test error'))
            _db.session.add(Log(level='info', message='Test info'))
            _db.session.commit()

        resp = auth_client.get('/api/logs')
        data = resp.get_json()
        assert any(l['message'] == 'Test error' for l in data)
        assert any(l['message'] == 'Test info' for l in data)

    def test_get_logs_filtered_by_account(self, auth_client, app):
        act_res = auth_client.post('/api/accounts', json={'username': 'loguser', 'password': 'pw'})
        act_id = act_res.get_json()['id']

        from app import db as _db
        from models import Log
        with app.app_context():
            _db.session.add(Log(level='info', message='Account log', account_id=act_id))
            _db.session.add(Log(level='info', message='Global log', account_id=None))
            _db.session.commit()

        resp = auth_client.get(f'/api/logs?account_id={act_id}')
        data = resp.get_json()
        assert all(l['account_id'] == act_id for l in data if l.get('account_id'))
        assert any(l['message'] == 'Account log' for l in data)

    def test_clear_all_logs(self, auth_client, app):
        from app import db as _db
        from models import Log
        with app.app_context():
            _db.session.add(Log(level='info', message='Will be cleared'))
            _db.session.commit()

        resp = auth_client.delete('/api/logs')
        assert resp.status_code == 200

        logs = auth_client.get('/api/logs').get_json()
        assert len(logs) == 0

    def test_clear_logs_by_account(self, auth_client, app):
        act_res = auth_client.post('/api/accounts', json={'username': 'clearuser', 'password': 'pw'})
        act_id = act_res.get_json()['id']

        from app import db as _db
        from models import Log
        with app.app_context():
            _db.session.add(Log(level='info', message='Account specific', account_id=act_id))
            _db.session.add(Log(level='info', message='Global log'))
            _db.session.commit()

        resp = auth_client.delete(f'/api/logs?account_id={act_id}')
        assert resp.status_code == 200

        # Global log should remain
        logs = auth_client.get('/api/logs').get_json()
        assert any(l['message'] == 'Global log' for l in logs)
        assert not any(l['message'] == 'Account specific' for l in logs)


# ═══════════════════════════════════════════════════════════════════════════════
# CRON
# ═══════════════════════════════════════════════════════════════════════════════

class TestCron:
    def _create_account(self, auth_client):
        resp = auth_client.post('/api/accounts', json={'username': 'cronuser', 'password': 'pw'})
        return resp.get_json()['id']

    def test_list_cron_jobs_empty(self, auth_client):
        resp = auth_client.get('/api/cron')
        assert resp.status_code == 200
        assert resp.get_json() == []

    def test_create_cron_job_interval(self, auth_client):
        act_id = self._create_account(auth_client)
        resp = auth_client.post('/api/cron', json={
            'name': 'Test Interval Job',
            'account_id': act_id,
            'job_type': 'search',
            'schedule_type': 'interval',
            'schedule_config': {'minutes': 15},
            'is_active': True,
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['name'] == 'Test Interval Job'
        assert data['schedule_type'] == 'interval'
        assert data['schedule_config']['minutes'] == 15
        assert data['is_active'] is True
        assert data['account_id'] == act_id
        assert data['next_run'] is not None

    def test_create_cron_job_daily(self, auth_client):
        act_id = self._create_account(auth_client)
        resp = auth_client.post('/api/cron', json={
            'name': 'Daily Job',
            'account_id': act_id,
            'job_type': 'comment',
            'schedule_type': 'daily',
            'schedule_config': {'time': '14:30'},
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['schedule_type'] == 'daily'
        assert data['schedule_config']['time'] == '14:30'

    def test_create_cron_job_weekly(self, auth_client):
        act_id = self._create_account(auth_client)
        resp = auth_client.post('/api/cron', json={
            'name': 'Weekly Job',
            'account_id': act_id,
            'job_type': 'post',
            'schedule_type': 'weekly',
            'schedule_config': {'days': [0, 2, 4], 'time': '10:00'},
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data['schedule_config']['days'] == [0, 2, 4]

    def test_create_cron_job_invalid_account(self, auth_client):
        resp = auth_client.post('/api/cron', json={
            'name': 'Bad Job',
            'account_id': 99999,
            'job_type': 'search',
            'schedule_type': 'interval',
            'schedule_config': {'minutes': 10},
        })
        assert resp.status_code == 400

    def test_update_cron_job(self, auth_client):
        act_id = self._create_account(auth_client)
        create_resp = auth_client.post('/api/cron', json={
            'name': 'Update Me',
            'account_id': act_id,
            'job_type': 'search',
            'schedule_type': 'interval',
            'schedule_config': {'minutes': 30},
        })
        job_id = create_resp.get_json()['id']

        update_resp = auth_client.put(f'/api/cron/{job_id}', json={
            'name': 'Updated Name',
            'schedule_config': {'minutes': 60},
            'is_active': False,
        })
        assert update_resp.status_code == 200
        data = update_resp.get_json()
        assert data['name'] == 'Updated Name'
        assert data['schedule_config']['minutes'] == 60
        assert data['is_active'] is False

    def test_delete_cron_job(self, auth_client):
        act_id = self._create_account(auth_client)
        create_resp = auth_client.post('/api/cron', json={
            'name': 'Delete Me',
            'account_id': act_id,
            'job_type': 'search',
            'schedule_type': 'interval',
            'schedule_config': {'minutes': 5},
        })
        job_id = create_resp.get_json()['id']

        del_resp = auth_client.delete(f'/api/cron/{job_id}')
        assert del_resp.status_code == 200

        jobs = auth_client.get('/api/cron').get_json()
        assert not any(j['id'] == job_id for j in jobs)

    def test_delete_nonexistent_cron(self, auth_client):
        resp = auth_client.delete('/api/cron/99999')
        assert resp.status_code == 404

    def test_trigger_cron_job(self, auth_client):
        act_id = self._create_account(auth_client)
        create_resp = auth_client.post('/api/cron', json={
            'name': 'Trigger Me',
            'account_id': act_id,
            'job_type': 'search',
            'schedule_type': 'interval',
            'schedule_config': {'minutes': 10},
        })
        job_id = create_resp.get_json()['id']

        trigger_resp = auth_client.post(f'/api/cron/{job_id}/trigger')
        assert trigger_resp.status_code in (200, 201)

    def test_trigger_nonexistent_cron(self, auth_client):
        resp = auth_client.post('/api/cron/99999/trigger')
        assert resp.status_code == 404

    def test_list_after_create(self, auth_client):
        act_id = self._create_account(auth_client)
        auth_client.post('/api/cron', json={
            'name': 'Job A',
            'account_id': act_id,
            'job_type': 'search',
            'schedule_type': 'interval',
            'schedule_config': {'minutes': 5},
        })
        auth_client.post('/api/cron', json={
            'name': 'Job B',
            'account_id': act_id,
            'job_type': 'comment',
            'schedule_type': 'daily',
            'schedule_config': {'time': '09:00'},
        })

        jobs = auth_client.get('/api/cron').get_json()
        assert len(jobs) == 2
        names = [j['name'] for j in jobs]
        assert 'Job A' in names
        assert 'Job B' in names
