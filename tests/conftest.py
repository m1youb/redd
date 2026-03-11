# Tests use SQLite in-memory for speed/portability.
# For PostgreSQL-specific behavior, use integration tests against a real PG instance.
import os
import pytest
import sys

# Ensure tests can import app correctly without needing absolute paths
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../app')))

from app import app as flask_app, db, apply_migrations
from models import User, Setting
from werkzeug.security import generate_password_hash


@pytest.fixture
def app():
    """Create a fresh test app with in-memory DB for each test."""
    os.environ['FLASK_ENV'] = 'test'
    os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

    flask_app.config.update({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "SECRET_KEY": "test-secret-key",
    })

    with flask_app.app_context():
        apply_migrations()
        yield flask_app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def auth_client(app):
    """Return a test client with an authenticated admin session."""
    client = app.test_client()
    with app.app_context():
        # Create admin user
        admin = User(
            username='testadmin',
            email='admin@test.com',
            password_hash=generate_password_hash('testpassword123'),
            role='admin',
            is_active=True,
        )
        db.session.add(admin)
        db.session.commit()

    # Login via API to establish session
    resp = client.post('/api/login', json={
        'identity': 'testadmin',
        'password': 'testpassword123',
    })
    assert resp.status_code == 200, f"Auth setup failed: {resp.get_json()}"
    return client


@pytest.fixture
def reviewer_client(app):
    """Return a test client with an authenticated reviewer (non-admin) session."""
    client = app.test_client()
    with app.app_context():
        # Need at least one user to exist so signup doesn't auto-admin
        admin = User(
            username='existingadmin',
            email='existing@test.com',
            password_hash=generate_password_hash('testpassword123'),
            role='admin',
            is_active=True,
        )
        reviewer = User(
            username='testreviewer',
            email='reviewer@test.com',
            password_hash=generate_password_hash('reviewerpass123'),
            role='reviewer',
            is_active=True,
        )
        db.session.add(admin)
        db.session.add(reviewer)
        db.session.commit()

    resp = client.post('/api/login', json={
        'identity': 'testreviewer',
        'password': 'reviewerpass123',
    })
    assert resp.status_code == 200
    return client


@pytest.fixture
def runner(app):
    return app.test_cli_runner()
