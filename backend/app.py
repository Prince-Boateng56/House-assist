"""House Assist backend API.

Run with: python -m pip install -r requirements.txt && python backend/app.py
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    load_dotenv = None
from flask import Flask, g, jsonify, request, send_from_directory
import psycopg
from psycopg import errors as pg_errors
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
if load_dotenv is not None:
    load_dotenv(ROOT / ".env")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_PUBLISHABLE_KEY = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
SUPABASE_JWKS_URL = os.environ.get("SUPABASE_JWKS_URL", "")
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
RATE_LIMIT_SECRET = os.environ.get("HOUSE_ASSIST_RATE_LIMIT_SECRET", "") or SUPABASE_SECRET_KEY or SUPABASE_DB_URL or "house-assist-unconfigured"
TOKEN_TTL = 60 * 60 * 24 * 14
SERVICES = {
    "House Cleaning", "Plumbing", "Electrical", "Mason", "Painting", "Repairs",
    "Gardening", "Lawn Care", "Laundry", "Ironing", "Cooking", "Kitchen Assist",
    "Moving", "Packing", "Elderly Care", "Child Care",
}
app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024


@app.after_request
def security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; "
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; "
        "form-action 'self'; upgrade-insecure-requests"
    )
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
    if request.is_secure or request.headers.get("X-Forwarded-Proto") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


class Database:
    """Small adapter so the existing API can use parameterized psycopg queries."""
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, params=()):
        return self.connection.execute(sql.replace("?", "%s"), params)

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()


def connect() -> Database:
    if not SUPABASE_DB_URL:
        raise RuntimeError("Set SUPABASE_DB_URL to your Supabase Postgres connection string.")
    connection = psycopg.connect(
        SUPABASE_DB_URL,
        row_factory=dict_row,
        prepare_threshold=None,
    )
    return Database(connection)


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def unique_conflict(exc: pg_errors.UniqueViolation):
    constraint = getattr(getattr(exc, "diag", None), "constraint_name", "")
    if constraint in {"users_username_lower_uq", "users_username_key"}:
        return error("That username is already in use. Try a different username.", 409)
    if constraint in {"users_email_lower_uq", "users_email_key"}:
        return error("A House Assist account with this email already exists. Sign in using its existing method.", 409)
    if constraint == "users_pkey":
        return error("This Google account already has a House Assist profile. Try signing in instead.", 409)
    return error("This account conflicts with an existing record. Check the username and email, then try again.", 409)


def body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def auth_rate_key(bucket: str) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
    client_ip = forwarded or request.remote_addr or "unknown"
    return hashlib.sha256(f"{RATE_LIMIT_SECRET}:{bucket}:{client_ip}".encode("utf-8")).hexdigest()


def auth_rate_limit(bucket: str, maximum: int, window_seconds: int = 900):
    now = int(time.time())
    key_hash = auth_rate_key(bucket)
    cutoff = now - window_seconds
    g.db.execute("DELETE FROM house_assist.auth_attempts WHERE window_started_at<?", (now - 86400,))
    row = g.db.execute("""INSERT INTO house_assist.auth_attempts AS attempt_row(key_hash,window_started_at,attempts)
                          VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET
                          window_started_at=CASE WHEN attempt_row.window_started_at<=? THEN ? ELSE attempt_row.window_started_at END,
                          attempts=CASE WHEN attempt_row.window_started_at<=? THEN 1 ELSE attempt_row.attempts+1 END
                          RETURNING window_started_at,attempts""",
                       (key_hash, now, cutoff, now, cutoff)).fetchone()
    g.db.commit()
    if row["attempts"] <= maximum:
        return None
    retry_after = max(1, int(row["window_started_at"]) + window_seconds - now)
    response = error("Too many attempts. Wait a little and try again.", 429)
    response[0].headers["Retry-After"] = str(retry_after)
    return response


def clear_auth_rate_limit(bucket: str) -> None:
    g.db.execute("DELETE FROM house_assist.auth_attempts WHERE key_hash=?", (auth_rate_key(bucket),))


def password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return salt.hex() + ":" + digest.hex()


def password_ok(password: str, saved: str) -> bool:
    try:
        salt_hex, digest_hex = saved.split(":", 1)
        digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def valid_email(value: str) -> bool:
    return bool(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value))


def clean_google_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = "".join(
        char if unicodedata.category(char)[0] in {"L", "M"} or char in " '-." else " "
        for char in value
    )
    return " ".join(cleaned.split())[:40].strip()


def google_profile_name(google_user: dict[str, Any], email: str) -> str:
    metadata = google_user.get("user_metadata") or {}
    identities = google_user.get("identities") or []
    profile_sources = [metadata] if isinstance(metadata, dict) else []
    profile_sources.extend(
        identity.get("identity_data") or {}
        for identity in identities
        if isinstance(identity, dict) and identity.get("provider") == "google"
        and isinstance(identity.get("identity_data") or {}, dict)
    )
    for profile in profile_sources:
        given = profile.get("given_name") or profile.get("first_name") or ""
        family = profile.get("family_name") or profile.get("last_name") or ""
        for value in (profile.get("full_name"), profile.get("name"), f"{given} {family}"):
            name = clean_google_name(value)
            if len(name) >= 2:
                name = name.title()
                parts = name.split()
                local_part = re.sub(r"\d+$", "", email.split("@", 1)[0]).lower()
                compact_local = re.sub(r"[^a-z]", "", local_part)
                if len(parts) == 2:
                    first = re.sub(r"[^a-z]", "", parts[0].lower())
                    last = re.sub(r"[^a-z]", "", parts[-1].lower())
                    if (first and last and compact_local.startswith(first) and compact_local.endswith(last)
                            and len(compact_local) > len(first) + len(last)):
                        middle = compact_local[len(first):-len(last)].title()
                        if middle:
                            name = f"{parts[0]} {middle} {parts[-1]}"
                return name

    local_part = re.sub(r"\d+$", "", email.split("@", 1)[0])
    words = [part for part in re.split(r"[._+\-]+", local_part) if part]
    fallback = " ".join(part[:1].upper() + part[1:].lower() for part in words)
    return clean_google_name(fallback) or "Google User"


def unique_google_username(preferred: str, email: str, exclude_user_id: Any = None) -> str:
    base = preferred[:40].strip() or "Google User"

    def is_taken(candidate: str) -> bool:
        if exclude_user_id is not None:
            return g.db.execute(
                "SELECT 1 FROM house_assist.users WHERE lower(username)=lower(?) AND id<>? LIMIT 1",
                (candidate, exclude_user_id),
            ).fetchone() is not None
        return g.db.execute(
            "SELECT 1 FROM house_assist.users WHERE lower(username)=lower(?) LIMIT 1",
            (candidate,),
        ).fetchone() is not None

    if not is_taken(base):
        return base

    def with_suffix(suffix: str) -> str:
        prefix = base[:max(1, 39 - len(suffix))].rstrip()
        return f"{prefix} {suffix}"[:40]

    email_suffix = re.search(r"(\d+)$", email.split("@", 1)[0])
    suffix = email_suffix.group(1) if email_suffix else "2"
    candidate = with_suffix(suffix)
    if not is_taken(candidate):
        return candidate

    for number in range(2, 1000):
        suffix = str(number)
        candidate = with_suffix(suffix)
        if not is_taken(candidate):
            return candidate
    raise RuntimeError("Could not create a unique username for this Google account.")


def supabase_request(path: str, payload: dict[str, Any], *, admin: bool = False) -> dict[str, Any]:
    if not SUPABASE_URL:
        raise RuntimeError("Set SUPABASE_URL on the server.")
    key = SUPABASE_SECRET_KEY if admin else SUPABASE_PUBLISHABLE_KEY
    if not key:
        raise RuntimeError("Supabase authentication is not configured on the server.")
    request_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/{path}",
        data=request_data,
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = json.loads(exc.read().decode("utf-8") or "{}")
        raise ValueError(detail.get("msg") or detail.get("message") or detail.get("error_description") or "Supabase authentication failed.") from exc


def supabase_user(access_token: str) -> dict[str, Any]:
    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        raise RuntimeError("Supabase authentication is not configured on the server.")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={"apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ValueError("Google authentication could not be verified.") from exc


def delete_supabase_user(user_id: Any) -> None:
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        return
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={"apikey": SUPABASE_SECRET_KEY, "Authorization": f"Bearer {SUPABASE_SECRET_KEY}"},
        method="DELETE",
    )
    try:
        urllib.request.urlopen(req, timeout=15).close()
    except Exception:
        app.logger.exception("Could not remove an incomplete Supabase account")


def update_supabase_user(user_id: Any, payload: dict[str, Any]) -> None:
    if not SUPABASE_URL or not SUPABASE_SECRET_KEY:
        raise RuntimeError("Supabase authentication is not configured on the server.")
    request_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        data=request_data,
        headers={"apikey": SUPABASE_SECRET_KEY, "Authorization": f"Bearer {SUPABASE_SECRET_KEY}", "Content-Type": "application/json"},
        method="PUT",
    )
    try:
        urllib.request.urlopen(req, timeout=15).close()
    except urllib.error.HTTPError as exc:
        detail = json.loads(exc.read().decode("utf-8") or "{}")
        raise ValueError(detail.get("msg") or detail.get("message") or "Supabase authentication update failed.") from exc


def token_for(role: str, user_id: Any | None = None, *, ttl: int = TOKEN_TTL) -> str:
    token = secrets.token_urlsafe(32)
    g.db.execute("DELETE FROM house_assist.sessions WHERE expires_at<?", (int(time.time()),))
    g.db.execute("INSERT INTO house_assist.sessions(token_hash,user_id,role,expires_at) VALUES(?,?,?,?)",
                 (hashlib.sha256(token.encode()).hexdigest(), user_id, role, int(time.time()) + ttl))
    g.db.commit()
    return token


@app.before_request
def open_db():
    if request.path == "/api/health":
        return
    g.db = connect()


@app.teardown_request
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def current_user(required: bool = True):
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    row = g.db.execute("""SELECT s.role session_role,s.expires_at,u.* FROM house_assist.sessions s
                          LEFT JOIN house_assist.users u ON u.id=s.user_id WHERE s.token_hash=?""",
                       (hashlib.sha256(token.encode()).hexdigest(),)).fetchone() if token else None
    if not row or row["expires_at"] < int(time.time()):
        if required:
            return None
        return None
    return row


def auth_required(role: str | None = None):
    user = current_user()
    if not user:
        return None, error("Please log in to continue.", 401)
    if role and user["session_role"] != role:
        return None, error("You do not have permission to do that.", 403)
    return user, None


def helper_json(row, *, reveal_contact: bool = False):
    return {"id": row["id"], "n": row["name"], "l": row["location"],
            "s": json.loads(row["services"]), "p": row["price"], "r": round(row["rating"]), "rc": row["rating_count"],
            "ph": (row["phone"] or "") if reveal_contact else "", "h": 1 if row["user_id"] else 0,
            "b": row["bio"], "x": row["experience"], "av": row["availability"], "lg": row["languages"]}


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/admin")
@app.get("/admin/")
@app.get("/admin.")
def admin_page():
    return send_from_directory(ROOT, "index.html")


@app.get("/app.js")
def frontend_script():
    return send_from_directory(ROOT, "app.js")


@app.get("/<path:filename>")
def frontend_asset(filename: str):
    """Serve the static frontend when running Flask directly."""
    candidate = (ROOT / filename).resolve()
    if ROOT not in candidate.parents or not candidate.is_file():
        return error("Not found.", 404)
    return send_from_directory(ROOT, filename)


@app.get("/api/health")
def health():
    try:
        g.db = connect()
        g.db.execute("SELECT 1").fetchone()
    except Exception:
        app.logger.exception("Health check could not reach the database")
        return jsonify({"ok": False, "database": "unavailable"}), 503
    return jsonify({"ok": True, "database": "available"})


@app.post("/api/contact")
def create_contact_message():
    limited = auth_rate_limit("contact", 5, 3600)
    if limited:
        return limited
    data = body()
    raw_name, raw_email, raw_message = data.get("name", ""), data.get("email", ""), data.get("message", "")
    if not isinstance(raw_name, str) or not isinstance(raw_email, str) or not isinstance(raw_message, str):
        return error("Enter your name, a valid email address, and a message.")
    name, email, message = raw_name.strip(), raw_email.strip().lower(), raw_message.strip()
    if not name or len(name) > 80:
        return error("Enter your name (up to 80 characters).")
    if email and (len(email) > 254 or not valid_email(email)):
        return error("Enter a valid email address or leave it blank.")
    if not message or len(message) > 3000:
        return error("Your message must contain between 1 and 3,000 characters.")
    row = g.db.execute("""INSERT INTO house_assist.contact_messages(name,email,body,created_at)
                          VALUES(?,?,?,?) RETURNING id""",
                       (name, email, message, int(time.time()))).fetchone()
    g.db.commit()
    return jsonify({"ok": True, "id": row["id"]}), 201


@app.get("/api/auth/config")
def auth_config():
    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        return error("Supabase authentication is not configured on the server.", 503)
    return jsonify({"url": SUPABASE_URL, "publishable_key": SUPABASE_PUBLISHABLE_KEY})


@app.post("/api/auth/register")
def register():
    limited = auth_rate_limit("register", 5, 3600)
    if limited:
        return limited
    data = body()
    username, password = str(data.get("username", "")).strip(), str(data.get("password", ""))
    email = str(data.get("email", "")).strip().lower()
    role, location = data.get("role"), str(data.get("location", "")).strip()
    if len(username) < 2 or len(username) > 40:
        return error("Username must be between 2 and 40 characters.")
    if len(password) < 10 or len(password) > 128:
        return error("Password must contain 10 to 128 characters.")
    if not valid_email(email):
        return error("Enter a valid email address.")
    if role not in ("customer", "helper"):
        return error("Choose whether you need help or offer help.")
    if not location:
        return error("Add your location so we can match you nearby.")
    services = data.get("services")
    if not isinstance(services, list):
        services = [data.get("service")]
    services = [str(service).strip() for service in services if str(service).strip()]
    try:
        price = int(data.get("price", 0))
    except (TypeError, ValueError):
        price = 0
    if role == "helper" and (not services or any(service not in SERVICES for service in services) or price < 1):
        return error("Choose a service and add a valid daily price.")
    user_id = None
    try:
        auth_user = supabase_request("admin/users", {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"username": username, "role": role, "location": location},
        }, admin=True)
        user_id = auth_user["id"]
        g.db.execute("INSERT INTO house_assist.users(id,username,email,password_hash,role,location,created_at) VALUES(?,?,?,?,?,?,?)",
                     (user_id, username, email, None, role, location, int(time.time())))
        g.db.execute("INSERT INTO house_assist.preferences(user_id) VALUES(?)", (user_id,))
        if role == "helper":
            g.db.execute("INSERT INTO house_assist.helpers(user_id,name,location,services,price) VALUES(?,?,?,?,?)",
                         (user_id, username, location, json.dumps(services), price))
        g.db.commit()
    except ValueError as exc:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        return error(str(exc), 409)
    except pg_errors.UniqueViolation as exc:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        return unique_conflict(exc)
    except (KeyError, RuntimeError) as exc:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        return error(str(exc), 503)
    except Exception:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        app.logger.exception("Account provisioning failed")
        return error("The account could not be completed. Please try again.", 503)
    clear_auth_rate_limit("register")
    token = token_for(role, user_id)
    return jsonify({"token": token, "user": {"id": user_id, "name": username, "role": role, "loc": location}}), 201


@app.post("/api/auth/login")
def login():
    limited = auth_rate_limit("login", 8)
    if limited:
        return limited
    data = body()
    username, password, role = str(data.get("username", "")).strip(), str(data.get("password", "")), data.get("role")
    email = str(data.get("email", "")).strip().lower()
    if len(password) > 128:
        return error("Password cannot exceed 128 characters.")
    if not valid_email(email):
        return error("Enter a valid email address.")
    row = g.db.execute("SELECT * FROM house_assist.users WHERE lower(username)=lower(?)", (username,)).fetchone()
    if not row:
        return error("Username or password is incorrect.", 401)
    if row["email"] and row["email"].lower() != email:
        return error("Username, email or password is incorrect.", 401)
    try:
        supabase_request("token?grant_type=password", {
            "email": email, "password": password,
        })
    except (ValueError, RuntimeError):
        if not row["password_hash"] or not password_ok(password, row["password_hash"]):
            return error("Username or password is incorrect.", 401)
        try:
            supabase_request("admin/users", {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"username": username, "role": row["role"], "location": row["location"]},
            }, admin=True)
            g.db.execute("UPDATE house_assist.users SET email=?,password_hash=NULL WHERE id=?", (email, row["id"]))
            g.db.commit()
        except (ValueError, RuntimeError) as exc:
            g.db.rollback()
            return error(str(exc), 503)
    if role != row["role"]:
        return error("That account uses a different sign-in option.", 403)
    clear_auth_rate_limit("login")
    token = token_for(row["role"], row["id"])
    return jsonify({"token": token, "user": {"id": row["id"], "name": row["username"], "role": row["role"], "loc": row["location"]}})


@app.post("/api/auth/google")
def google_login():
    auth = request.headers.get("Authorization", "")
    access_token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not access_token:
        return error("Google authentication is missing.", 401)
    try:
        google_user = supabase_user(access_token)
    except (ValueError, RuntimeError) as exc:
        return error(str(exc), 401)

    data = body()
    requested_role = data.get("role")
    requested_mode = data.get("mode")
    if requested_role not in ("customer", "helper") or requested_mode not in ("login", "signup"):
        return error("Your selected account type was not preserved. Return to sign-in, choose Customer or House help, and try Google again.", 400)
    user_id = google_user.get("id")
    email = str(google_user.get("email", "")).strip().lower()
    if not valid_email(email):
        return error("Google did not provide a valid email address.", 401)
    row = g.db.execute("SELECT * FROM house_assist.users WHERE id=?", (user_id,)).fetchone()
    if not row:
        email_row = g.db.execute(
            "SELECT * FROM house_assist.users WHERE lower(email)=lower(?) ORDER BY created_at LIMIT 1",
            (email,),
        ).fetchone()
        app_metadata = google_user.get("app_metadata") or {}
        providers = app_metadata.get("providers") or []
        google_identity = app_metadata.get("provider") == "google" or "google" in providers
        user_metadata = google_user.get("user_metadata") or {}
        identities = google_user.get("identities") or []
        identity_verified = any(
            identity.get("provider") == "google"
            and isinstance(identity.get("identity_data"), dict)
            and identity["identity_data"].get("email_verified") is True
            for identity in identities
            if isinstance(identity, dict)
        )
        email_verified = bool(
            google_user.get("email_confirmed_at")
            or google_user.get("confirmed_at")
            or (isinstance(user_metadata, dict) and user_metadata.get("email_verified") is True)
            or identity_verified
        )
        if email_row and google_identity and email_verified:
            row = email_row
            preferred_name = google_profile_name(google_user, email)
            if preferred_name.casefold() != row["username"].casefold():
                linked_name = unique_google_username(preferred_name, email, exclude_user_id=row["id"])
                g.db.execute("UPDATE house_assist.users SET username=? WHERE id=?", (linked_name, row["id"]))
                if row["role"] == "helper":
                    g.db.execute("UPDATE house_assist.helpers SET name=? WHERE user_id=?", (linked_name, row["id"]))
                g.db.commit()
                row = g.db.execute("SELECT * FROM house_assist.users WHERE id=?", (row["id"],)).fetchone()
    if not row:
        if data.get("mode") == "login":
            return error("No House Assist account exists for this Google account. Sign up first.", 404)
        username = unique_google_username(google_profile_name(google_user, email), email)
        role = data.get("role")
        location = str(data.get("location", "")).strip()
        if len(username) < 2 or len(username) > 40 or role not in ("customer", "helper") or not location:
            return error("Complete your role and region before continuing with Google.", 422)
        services = data.get("services") or []
        try:
            price = int(data.get("price", 0))
        except (TypeError, ValueError):
            price = 0
        if role == "helper" and (not isinstance(services, list) or not services or any(service not in SERVICES for service in services) or price < 1):
            return error("Choose your services and add a valid daily price before continuing with Google.", 422)
        try:
            g.db.execute("INSERT INTO house_assist.users(id,username,email,password_hash,role,location,created_at) VALUES(?,?,?,?,?,?,?)",
                         (user_id, username, email, None, role, location, int(time.time())))
            g.db.execute("INSERT INTO house_assist.preferences(user_id) VALUES(?)", (user_id,))
            if role == "helper":
                g.db.execute("INSERT INTO house_assist.helpers(user_id,name,location,services,price) VALUES(?,?,?,?,?)",
                             (user_id, username, location, json.dumps(services), price))
            g.db.commit()
        except pg_errors.UniqueViolation as exc:
            g.db.rollback()
            return unique_conflict(exc)
        row = g.db.execute("SELECT * FROM house_assist.users WHERE id=?", (user_id,)).fetchone()
    elif not row["email"]:
        g.db.execute("UPDATE house_assist.users SET email=? WHERE id=?", (email, user_id))
        g.db.commit()
    if requested_role in ("customer", "helper") and requested_role != row["role"]:
        account_type = "customer" if row["role"] == "customer" else "house help"
        return error(f"This Google account is registered as a {account_type}. Choose that account type to continue, or select a different Google account.", 409)
    token = token_for(row["role"], row["id"])
    return jsonify({"token": token, "user": {"id": row["id"], "name": row["username"], "role": row["role"], "loc": row["location"]}})


@app.post("/api/auth/logout")
def logout():
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if token:
        g.db.execute("DELETE FROM house_assist.sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        g.db.commit()
    return jsonify({"ok": True})


@app.post("/api/auth/password-reset-complete")
def password_reset_complete():
    auth = request.headers.get("Authorization", "")
    access_token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if not access_token:
        return error("The password reset session is missing.", 401)
    try:
        auth_user = supabase_user(access_token)
    except (ValueError, RuntimeError) as exc:
        return error(str(exc), 401)
    user_id = auth_user.get("id")
    if not user_id:
        return error("The password reset session is invalid.", 401)
    g.db.execute("DELETE FROM house_assist.sessions WHERE user_id=?", (user_id,))
    g.db.commit()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    user, problem = auth_required()
    if problem:
        return problem
    pref = g.db.execute("SELECT * FROM house_assist.preferences WHERE user_id=?", (user["id"],)).fetchone()
    profile = {"id": user["id"], "name": user["username"], "role": user["role"], "loc": user["location"],
               "bio": user["bio"], "theme": pref["theme"], "layout": pref["layout"],
               "compact": bool(pref["compact"]), "colors": json.loads(pref["colors"])}
    if user["role"] == "helper":
        helper = g.db.execute("SELECT phone,bio,experience,availability,languages,price FROM house_assist.helpers WHERE user_id=?", (user["id"],)).fetchone()
        if helper:
            profile.update({"phone": helper["phone"], "bio": helper["bio"], "experience": helper["experience"],
                            "availability": helper["availability"], "languages": helper["languages"], "price": helper["price"]})
    return jsonify(profile)


@app.patch("/api/me")
def update_me():
    user, problem = auth_required()
    if problem:
        return problem
    data = body()
    username = str(data.get("username", user["username"])).strip()
    location = str(data.get("location", user["location"])).strip()
    bio = str(data.get("bio", user["bio"] or "")).strip()
    if len(username) < 2 or len(username) > 40:
        return error("Username must be between 2 and 40 characters.")
    if not location or len(location) > 80:
        return error("Enter a region up to 80 characters.")
    if len(bio) > 400:
        return error("Your profile introduction must be 400 characters or fewer.")
    pref = g.db.execute("SELECT * FROM house_assist.preferences WHERE user_id=?", (user["id"],)).fetchone()
    if not pref:
        return error("Your profile preferences are missing. Contact House Assist support.", 409)
    theme = str(data.get("theme", pref["theme"]))
    layout = str(data.get("layout", pref["layout"]))
    compact = data.get("compact", bool(pref["compact"]))
    colors = data.get("colors", json.loads(pref["colors"]))
    if theme not in {"Ocean", "Emerald", "Night", "Sunset", "Violet", "Mono", "Custom"}:
        return error("Choose a valid profile theme.")
    if layout not in {"grid", "list"}:
        return error("Choose a valid listing layout.")
    if not isinstance(compact, bool):
        return error("Choose a valid compact layout setting.")
    if not isinstance(colors, list) or len(colors) not in (0, 4) or any(not isinstance(c, str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", c) for c in colors):
        return error("Choose valid profile colours.")
    helper = None
    helper_values = None
    if user["role"] == "helper":
        helper = g.db.execute("SELECT * FROM house_assist.helpers WHERE user_id=?", (user["id"],)).fetchone()
        if not helper:
            return error("Your house-help listing is missing. Contact House Assist support.", 409)
        phone = str(data.get("phone", helper["phone"] or "")).strip()[:40]
        experience = str(data.get("experience", helper["experience"] or "")).strip()[:80]
        availability = str(data.get("availability", helper["availability"] or "")).strip()[:120]
        languages = str(data.get("languages", helper["languages"] or "")).strip()[:120]
        price = data.get("price", helper["price"])
        if isinstance(price, bool) or not isinstance(price, int) or price < 1:
            return error("Daily price must be a positive whole number.")
        helper_values = (username, location, bio, phone, experience, availability, languages, price, user["id"])
    try:
        g.db.execute("UPDATE house_assist.users SET username=?,location=?,bio=? WHERE id=?",
                     (username, location, bio, user["id"]))
        if user["role"] == "helper":
            g.db.execute("UPDATE house_assist.helpers SET name=?,location=?,bio=?,phone=?,experience=?,availability=?,languages=?,price=? WHERE user_id=?", helper_values)
        if data.get("password"):
            if len(str(data["password"])) < 10 or len(str(data["password"])) > 128:
                return error("Password must contain 10 to 128 characters.")
            update_supabase_user(user["id"], {"password": str(data["password"])})
            current_token = request.headers.get("Authorization", "")[7:]
            current_hash = hashlib.sha256(current_token.encode()).hexdigest()
            g.db.execute("DELETE FROM house_assist.sessions WHERE user_id=? AND token_hash<>?", (user["id"], current_hash))
        g.db.execute("UPDATE house_assist.preferences SET theme=?,layout=?,compact=?,colors=? WHERE user_id=?",
                     (theme, layout, compact, json.dumps(colors), user["id"]))
        g.db.commit()
    except pg_errors.UniqueViolation as exc:
        g.db.rollback()
        return unique_conflict(exc)
    return me()


@app.get("/api/helpers")
def list_helpers():
    query = str(request.args.get("q", "")).strip()
    service = str(request.args.get("service", "")).strip()
    sort = request.args.get("sort", "rating")
    order = "price ASC" if sort == "low" else "price DESC" if sort == "high" else "rating DESC, rating_count DESC"
    rows = g.db.execute(f"SELECT * FROM house_assist.helpers WHERE (name ILIKE ? OR location ILIKE ?) ORDER BY {order}",
                        (f"%{query}%", f"%{query}%")).fetchall()
    viewer = current_user(required=False)
    reveal_contact = bool(viewer and viewer["session_role"] == "customer")
    items = [helper_json(row, reveal_contact=reveal_contact) for row in rows]
    if service:
        items = [item for item in items if service in item["s"]]
    return jsonify(items)


@app.route("/api/threads", methods=["GET", "POST"])
def threads():
    user, problem = auth_required()
    if problem:
        return problem
    role = user["session_role"]
    if request.method == "POST":
        if role != "customer":
            return error("Only customers can start a conversation.", 403)
        helper_id = body().get("helper_id")
        if isinstance(helper_id, bool):
            return error("Choose a valid house help.")
        try:
            helper_id = int(helper_id)
        except (TypeError, ValueError):
            return error("Choose a valid house help.")
        helper = g.db.execute("SELECT id,user_id FROM house_assist.helpers WHERE id=?", (helper_id,)).fetchone()
        if not helper or not helper["user_id"]:
            return error("This house help is not available for messages yet.", 404)
        now = int(time.time())
        row = g.db.execute("""INSERT INTO house_assist.threads(customer_id,helper_id,created_at,last_message_at)
                              VALUES(?,?,?,?) ON CONFLICT(customer_id,helper_id)
                              DO UPDATE SET helper_id=excluded.helper_id RETURNING id""",
                           (user["id"], helper_id, now, now)).fetchone()
        g.db.commit()
        return jsonify({"id": row["id"]}), 201
    if role == "customer":
        rows = g.db.execute("""SELECT t.id,t.last_message_at,h.id helper_id,h.name peer_name,
                                     (SELECT m.body FROM house_assist.messages m WHERE m.thread_id=t.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) last_message
                              FROM house_assist.threads t JOIN house_assist.helpers h ON h.id=t.helper_id
                              WHERE t.customer_id=? ORDER BY t.last_message_at DESC LIMIT 100""", (user["id"],)).fetchall()
    elif role == "helper":
        rows = g.db.execute("""SELECT t.id,t.last_message_at,t.helper_id,c.username peer_name,
                                     (SELECT m.body FROM house_assist.messages m WHERE m.thread_id=t.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) last_message
                              FROM house_assist.threads t JOIN house_assist.helpers h ON h.id=t.helper_id
                              JOIN house_assist.users c ON c.id=t.customer_id
                              WHERE h.user_id=? ORDER BY t.last_message_at DESC LIMIT 100""", (user["id"],)).fetchall()
    else:
        return error("Messages are not available for this account.", 403)
    return jsonify([{"id": row["id"], "helper_id": row["helper_id"], "peer_name": row["peer_name"],
                     "last_message": row["last_message"] or "No messages yet", "last_message_at": row["last_message_at"]}
                    for row in rows])


@app.route("/api/threads/<int:thread_id>/messages", methods=["GET", "POST"])
def thread_messages(thread_id: int):
    user, problem = auth_required()
    if problem:
        return problem
    thread = g.db.execute("""SELECT t.id FROM house_assist.threads t
                            JOIN house_assist.helpers h ON h.id=t.helper_id
                            WHERE t.id=? AND (t.customer_id=? OR h.user_id=?)""",
                          (thread_id, user["id"], user["id"])).fetchone()
    if not thread:
        return error("Conversation was not found.", 404)
    if request.method == "GET":
        rows = g.db.execute("""SELECT id,sender_id,body,created_at FROM house_assist.messages
                              WHERE thread_id=? ORDER BY created_at DESC,id DESC LIMIT 100""", (thread_id,)).fetchall()
        messages = [{"id": row["id"], "body": row["body"], "created_at": row["created_at"],
                     "mine": str(row["sender_id"]) == str(user["id"])} for row in reversed(rows)]
        return jsonify(messages)
    message = body().get("body")
    if not isinstance(message, str):
        return error("Enter a message before sending.")
    message = message.strip()
    if not message or len(message) > 2000:
        return error("Messages must contain between 1 and 2,000 characters.")
    now = int(time.time())
    row = g.db.execute("INSERT INTO house_assist.messages(thread_id,sender_id,body,created_at) VALUES(?,?,?,?) RETURNING id",
                       (thread_id, user["id"], message, now)).fetchone()
    g.db.execute("UPDATE house_assist.threads SET last_message_at=? WHERE id=?", (now, thread_id))
    g.db.commit()
    return jsonify({"id": row["id"], "body": message, "created_at": now,
                    "mine": True}), 201


@app.get("/api/guide")
def price_guide():
    return jsonify([dict(row) for row in g.db.execute("SELECT CAST(ROUND(rating) AS INTEGER) stars,MIN(price) low,MAX(price) high,COUNT(*) count FROM house_assist.helpers GROUP BY stars ORDER BY stars DESC")])


@app.post("/api/hires")
def create_hire():
    user, problem = auth_required("customer")
    if problem:
        return problem
    data = body()
    method = data.get("payment_method")
    if method not in ("cash", "bank", "momo"):
        return error("Choose a payment method.")
    helper = g.db.execute("SELECT id FROM house_assist.helpers WHERE id=?", (data.get("helper_id"),)).fetchone()
    if not helper:
        return error("This house help listing is no longer available.", 404)
    cur = g.db.execute("INSERT INTO house_assist.hires(customer_id,helper_id,payment_method,payment_detail,created_at) VALUES(?,?,?,?,?) RETURNING id",
                       (user["id"], helper["id"], method, str(data.get("payment_detail", "")), int(time.time())))
    g.db.commit()
    return jsonify({"id": cur.fetchone()["id"], "helper_id": helper["id"], "customer_paid": False, "helper_received": False}), 201


@app.get("/api/hires")
def list_hires():
    user, problem = auth_required("customer")
    if problem:
        return problem
    rows = g.db.execute("""SELECT h.*,p.name helper_name,p.location,p.services,p.price,p.phone,p.rating,p.rating_count
                          FROM house_assist.hires h JOIN house_assist.helpers p ON p.id=h.helper_id WHERE h.customer_id=? ORDER BY h.created_at DESC""", (user["id"],)).fetchall()
    return jsonify([{"id": r["id"], "helper": {"id": r["helper_id"], "n": r["helper_name"], "l": r["location"], "s": json.loads(r["services"]), "p": r["price"], "r": round(r["rating"]), "ph": r["phone"]}, "payment_method": r["payment_method"], "customer_paid": bool(r["customer_paid"]), "helper_received": bool(r["helper_received"])} for r in rows])


@app.get("/api/helper/hires")
def helper_hires():
    user, problem = auth_required("helper")
    if problem:
        return problem
    rows = g.db.execute("""SELECT h.*,u.username customer,p.location,p.price FROM house_assist.hires h
                          JOIN house_assist.users u ON u.id=h.customer_id JOIN house_assist.helpers p ON p.id=h.helper_id
                          WHERE p.user_id=? ORDER BY h.created_at DESC""", (user["id"],)).fetchall()
    return jsonify([{"id": r["id"], "customer": r["customer"], "location": r["location"], "price": r["price"],
                     "payment_method": r["payment_method"], "customer_paid": bool(r["customer_paid"]),
                     "helper_received": bool(r["helper_received"])} for r in rows])


@app.patch("/api/hires/<int:hire_id>/payment")
def confirm_payment(hire_id: int):
    user, problem = auth_required("customer")
    if problem:
        return problem
    cur = g.db.execute("UPDATE house_assist.hires SET customer_paid=TRUE WHERE id=? AND customer_id=?", (hire_id, user["id"]))
    if not cur.rowcount:
        return error("Hire was not found.", 404)
    g.db.commit()
    return jsonify({"ok": True})


@app.patch("/api/hires/<int:hire_id>/received")
def confirm_received(hire_id: int):
    user, problem = auth_required("helper")
    if problem:
        return problem
    cur = g.db.execute("""UPDATE house_assist.hires SET helper_received=TRUE WHERE id=? AND customer_paid=TRUE
                          AND helper_id IN (SELECT id FROM house_assist.helpers WHERE user_id=?)""", (hire_id, user["id"]))
    if not cur.rowcount:
        return error("Hire was not found or payment has not been marked.", 404)
    g.db.commit()
    return jsonify({"ok": True})


@app.post("/api/hires/<int:hire_id>/rating")
def add_rating(hire_id: int):
    user, problem = auth_required("customer")
    if problem:
        return problem
    data = body()
    stars = data.get("stars")
    recommendation = str(data.get("recommendation", "")).strip()[:1000]
    hire = g.db.execute("SELECT * FROM house_assist.hires WHERE id=? AND customer_id=? AND customer_paid=TRUE", (hire_id, user["id"])).fetchone()
    if not hire or not hire["helper_received"]:
        return error("The hire must be confirmed by both people before feedback.", 409)
    if not stars and not recommendation:
        return error("Add a rating or a recommendation first.")
    if stars is not None and (not isinstance(stars, int) or stars < 1 or stars > 5):
        return error("Choose a rating from 1 to 5.")
    try:
        g.db.execute("INSERT INTO house_assist.ratings(hire_id,customer_id,helper_id,stars,recommendation,created_at) VALUES(?,?,?,?,?,?)",
                     (hire_id, user["id"], hire["helper_id"], stars, recommendation, int(time.time())))
    except pg_errors.UniqueViolation:
        g.db.rollback()
        return error("Feedback was already submitted for this hire.", 409)
    if stars:
        g.db.execute("UPDATE house_assist.helpers SET rating=((rating*rating_count)+?)/(rating_count+1),rating_count=rating_count+1 WHERE id=?", (stars, hire["helper_id"]))
    g.db.commit()
    return jsonify({"ok": True})


@app.post("/api/admin/session")
def admin_login():
    limited = auth_rate_limit("admin", 5)
    if limited:
        return limited
    pin = str(body().get("pin", ""))
    expected = os.environ.get("HOUSE_ASSIST_ADMIN_PIN", "")
    if not expected:
        return error("Admin access is not configured. Set HOUSE_ASSIST_ADMIN_PIN on the server.", 503)
    if not hmac.compare_digest(pin, expected):
        return error("Access code not recognised.", 401)
    clear_auth_rate_limit("admin")
    return jsonify({"token": token_for("admin", ttl=60 * 60)})


@app.get("/api/admin/summary")
def admin_summary():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    users = [dict(row) for row in g.db.execute("SELECT username,role,location,created_at FROM house_assist.users ORDER BY created_at DESC LIMIT 8")]
    brand_row = g.db.execute("SELECT value FROM house_assist.settings WHERE key='branding'").fetchone()
    brand = json.loads(brand_row["value"]) if brand_row else {"name": "House Assist", "mark": "⌂", "favicon": "🏠"}
    hires = g.db.execute("SELECT COUNT(*) AS count FROM house_assist.hires").fetchone()["count"]
    pending = g.db.execute("SELECT COUNT(*) AS count FROM house_assist.hires WHERE NOT helper_received").fetchone()["count"]
    completed = g.db.execute("SELECT COUNT(*) AS count FROM house_assist.hires WHERE helper_received").fetchone()["count"]
    ratings = g.db.execute("SELECT COUNT(*) AS count,COALESCE(AVG(stars),0) AS average FROM house_assist.ratings WHERE stars IS NOT NULL").fetchone()
    return jsonify({"hires": hires, "pending_hires": pending, "completed_hires": completed,
                    "helpers": g.db.execute("SELECT COUNT(*) AS count FROM house_assist.helpers").fetchone()["count"],
                    "customers": g.db.execute("SELECT COUNT(*) AS count FROM house_assist.users WHERE role='customer'").fetchone()["count"],
                    "ratings": ratings["count"], "average_rating": round(float(ratings["average"]), 2),
                    "users": users, "branding": brand})


@app.get("/api/admin/users")
def admin_list_users():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    query = str(request.args.get("q", "")).strip()[:100]
    like = f"%{query}%"
    rows = g.db.execute("""SELECT id,username,email,role,location,created_at
                          FROM house_assist.users
                          WHERE username ILIKE ? OR COALESCE(email,'') ILIKE ? OR location ILIKE ?
                          ORDER BY created_at DESC LIMIT 200""", (like, like, like)).fetchall()
    return jsonify([dict(row) for row in rows])


@app.get("/api/admin/helpers")
def admin_list_helpers():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    query = str(request.args.get("q", "")).strip()[:100]
    like = f"%{query}%"
    rows = g.db.execute("""SELECT h.id,h.user_id,h.name,h.location,h.services,h.price,h.phone,h.rating,h.rating_count,
                                 u.email,u.created_at
                          FROM house_assist.helpers h
                          LEFT JOIN house_assist.users u ON u.id=h.user_id
                          WHERE h.name ILIKE ? OR h.location ILIKE ? OR COALESCE(u.email,'') ILIKE ?
                          ORDER BY h.name LIMIT 200""", (like, like, like)).fetchall()
    return jsonify([{**dict(row), "services": json.loads(row["services"])} for row in rows])


@app.patch("/api/admin/helpers/<int:helper_id>")
def admin_update_helper(helper_id: int):
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    data = body()
    current = g.db.execute("SELECT * FROM house_assist.helpers WHERE id=?", (helper_id,)).fetchone()
    if not current:
        return error("House help listing was not found.", 404)
    name = str(data.get("name", current["name"])).strip()[:80]
    location = str(data.get("location", current["location"])).strip()[:120]
    phone = str(data.get("phone", current["phone"])).strip()[:40]
    price = data.get("price", current["price"])
    services = data.get("services", json.loads(current["services"]))
    if len(name) < 2 or not location:
        return error("Enter a name and location for this listing.")
    if isinstance(price, bool) or not isinstance(price, int) or price < 1:
        return error("Daily price must be a positive whole number.")
    if not isinstance(services, list) or not services or any(not isinstance(service, str) or service not in SERVICES for service in services):
        return error("Choose at least one valid service.")
    try:
        g.db.execute("UPDATE house_assist.helpers SET name=?,location=?,phone=?,price=?,services=? WHERE id=?",
                     (name, location, phone, price, json.dumps(list(dict.fromkeys(services))), helper_id))
        if current["user_id"]:
            g.db.execute("UPDATE house_assist.users SET username=?,location=? WHERE id=?",
                         (name, location, current["user_id"]))
        g.db.commit()
    except pg_errors.UniqueViolation as exc:
        g.db.rollback()
        return unique_conflict(exc)
    return jsonify({"ok": True})


@app.get("/api/admin/hires")
def admin_list_hires():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    query = str(request.args.get("q", "")).strip()[:100]
    like = f"%{query}%"
    rows = g.db.execute("""SELECT h.id,h.payment_method,h.payment_detail,h.customer_paid,h.helper_received,h.created_at,
                                 c.username AS customer_name,c.email AS customer_email,
                                 p.name AS helper_name,p.location AS helper_location,p.price,
                                 r.stars,r.recommendation
                          FROM house_assist.hires h
                          JOIN house_assist.users c ON c.id=h.customer_id
                          JOIN house_assist.helpers p ON p.id=h.helper_id
                          LEFT JOIN house_assist.ratings r ON r.hire_id=h.id
                          WHERE c.username ILIKE ? OR COALESCE(c.email,'') ILIKE ? OR p.name ILIKE ?
                          ORDER BY h.created_at DESC LIMIT 200""", (like, like, like)).fetchall()
    return jsonify([dict(row) for row in rows])


@app.get("/api/admin/ratings")
def admin_list_ratings():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    rows = g.db.execute("""SELECT r.id,r.hire_id,r.stars,r.recommendation,r.created_at,
                                 c.username AS customer_name,p.name AS helper_name
                          FROM house_assist.ratings r
                          JOIN house_assist.users c ON c.id=r.customer_id
                          JOIN house_assist.helpers p ON p.id=r.helper_id
                          ORDER BY r.created_at DESC LIMIT 200""").fetchall()
    return jsonify([dict(row) for row in rows])


@app.get("/api/admin/contact")
def admin_list_contact_messages():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    rows = g.db.execute("""SELECT id,name,email,body,created_at,read_at
                          FROM house_assist.contact_messages
                          ORDER BY (read_at IS NOT NULL),created_at DESC LIMIT 200""").fetchall()
    return jsonify([dict(row) for row in rows])


@app.patch("/api/admin/contact/<int:message_id>")
def admin_mark_contact_message(message_id: int):
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    row = g.db.execute("UPDATE house_assist.contact_messages SET read_at=? WHERE id=? RETURNING id",
                       (int(time.time()), message_id)).fetchone()
    if not row:
        return error("Contact message was not found.", 404)
    g.db.commit()
    return jsonify({"ok": True})


@app.post("/api/admin/users")
def admin_add_user():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    data = body()
    name = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if len(name) < 2 or len(name) > 40:
        return error("Enter a username between 2 and 40 characters.")
    if not valid_email(email):
        return error("Enter a valid email address for this customer.")
    if len(password) < 10 or len(password) > 128:
        return error("Set a temporary password with 10 to 128 characters.")
    user_id = None
    try:
        auth_user = supabase_request("admin/users", {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"username": name, "role": "customer", "location": "Accra"},
        }, admin=True)
        user_id = auth_user["id"]
        g.db.execute("INSERT INTO house_assist.users(id,username,email,password_hash,role,location,created_at) VALUES(?,?,?,?,?,?,?)",
                     (user_id, name, email, None, "customer", "Accra", int(time.time())))
        g.db.execute("INSERT INTO house_assist.preferences(user_id) VALUES(?)", (user_id,))
        g.db.commit()
    except (ValueError, RuntimeError) as exc:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        return error(str(exc), 409 if isinstance(exc, ValueError) else 503)
    except pg_errors.UniqueViolation as exc:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        return unique_conflict(exc)
    except Exception:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        app.logger.exception("Administrator account creation failed")
        return error("The account could not be completed. Please try again.", 503)
    return jsonify({"ok": True}), 201


@app.patch("/api/admin/branding")
def update_branding():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    data = body()
    brand = {"name": str(data.get("name", "House Assist"))[:60], "mark": str(data.get("mark", "⌂"))[:2], "favicon": str(data.get("favicon", "🏠"))[:2]}
    g.db.execute("INSERT INTO house_assist.settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("branding", json.dumps(brand)))
    g.db.commit()
    return jsonify(brand)


@app.get("/api/branding")
def get_branding():
    brand = g.db.execute("SELECT value FROM house_assist.settings WHERE key='branding'").fetchone()
    return jsonify(json.loads(brand["value"]) if brand else {"name": "House Assist", "mark": "⌂", "favicon": "🏠"})

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")), debug=False)
