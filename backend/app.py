"""House Assist backend API.

Run with: python -m pip install -r requirements.txt && python backend/app.py
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
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
TOKEN_TTL = 60 * 60 * 24 * 14
SERVICES = {
    "House Cleaning", "Plumbing", "Electrical", "Mason", "Painting", "Repairs",
    "Gardening", "Lawn Care", "Laundry", "Ironing", "Cooking", "Kitchen Assist",
    "Moving", "Packing", "Elderly Care", "Child Care",
}
app = Flask(__name__, static_folder=None)


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


def body() -> dict[str, Any]:
    return request.get_json(silent=True) or {}


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


def auth_email(username: str) -> str:
    return f"{username.lower()}@accounts.house-assist.local"


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
    except urllib.error.HTTPError:
        pass


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


def token_for(role: str, user_id: Any | None = None) -> str:
    token = secrets.token_urlsafe(32)
    g.db.execute("INSERT INTO house_assist.sessions(token_hash,user_id,role,expires_at) VALUES(?,?,?,?)",
                 (hashlib.sha256(token.encode()).hexdigest(), user_id, role, int(time.time()) + TOKEN_TTL))
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


def helper_json(row):
    return {"id": row["id"], "n": row["name"], "l": row["location"],
            "s": json.loads(row["services"]), "p": row["price"], "r": round(row["rating"]),
            "ph": row["phone"] or "Contact after connecting", "h": 1 if row["user_id"] else 0}


@app.get("/")
def index():
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
    return jsonify({"ok": True})


@app.post("/api/auth/register")
def register():
    data = body()
    username, password = str(data.get("username", "")).strip(), str(data.get("password", ""))
    role, location = data.get("role"), str(data.get("location", "")).strip()
    if len(username) < 2 or len(username) > 40:
        return error("Username must be between 2 and 40 characters.")
    if len(password) < 6:
        return error("Password needs at least 6 characters.")
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
    try:
        auth_user = supabase_request("admin/users", {
            "email": auth_email(username),
            "password": password,
            "email_confirm": True,
            "user_metadata": {"username": username, "role": role, "location": location},
        }, admin=True)
        user_id = auth_user["id"]
        g.db.execute("INSERT INTO house_assist.users(id,username,password_hash,role,location,created_at) VALUES(?,?,?,?,?,?)",
                     (user_id, username, None, role, location, int(time.time())))
        g.db.execute("INSERT INTO house_assist.preferences(user_id) VALUES(?)", (user_id,))
    except ValueError as exc:
        g.db.rollback()
        return error(str(exc), 409)
    except pg_errors.UniqueViolation:
        g.db.rollback()
        if "user_id" in locals():
            delete_supabase_user(user_id)
        return error("That username is already in use.", 409)
    except (KeyError, RuntimeError) as exc:
        g.db.rollback()
        return error(str(exc), 503)
    if role == "helper":
        g.db.execute("INSERT INTO house_assist.helpers(user_id,name,location,services,price) VALUES(?,?,?,?,?)",
                     (user_id, username, location, json.dumps(services), price))
    g.db.commit()
    token = token_for(role, user_id)
    return jsonify({"token": token, "user": {"id": user_id, "name": username, "role": role, "loc": location}}), 201


@app.post("/api/auth/login")
def login():
    data = body()
    username, password, role = str(data.get("username", "")).strip(), str(data.get("password", "")), data.get("role")
    try:
        supabase_request("token?grant_type=password", {
            "email": auth_email(username), "password": password,
        })
    except (ValueError, RuntimeError):
        return error("Username or password is incorrect.", 401)
    row = g.db.execute("SELECT * FROM house_assist.users WHERE lower(username)=lower(?)", (username,)).fetchone()
    if not row:
        return error("This account is not fully configured. Please contact support.", 409)
    if role != row["role"]:
        return error("That account uses a different sign-in option.", 403)
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


@app.get("/api/me")
def me():
    user, problem = auth_required()
    if problem:
        return problem
    pref = g.db.execute("SELECT * FROM house_assist.preferences WHERE user_id=?", (user["id"],)).fetchone()
    return jsonify({"id": user["id"], "name": user["username"], "role": user["role"], "loc": user["location"],
                    "theme": pref["theme"], "layout": pref["layout"], "compact": bool(pref["compact"]),
                    "colors": json.loads(pref["colors"])})


@app.patch("/api/me")
def update_me():
    user, problem = auth_required()
    if problem:
        return problem
    data = body()
    username = str(data.get("username", user["username"])).strip()
    if len(username) < 2 or len(username) > 40:
        return error("Username must be between 2 and 40 characters.")
    try:
        g.db.execute("UPDATE house_assist.users SET username=?,location=? WHERE id=?",
                     (username, str(data.get("location", user["location"])).strip(), user["id"]))
        if user["role"] == "helper":
            g.db.execute("UPDATE house_assist.helpers SET name=?,location=? WHERE user_id=?", (username, str(data.get("location", user["location"])).strip(), user["id"]))
        if data.get("password"):
            if len(str(data["password"])) < 6:
                return error("Password needs at least 6 characters.")
            update_supabase_user(user["id"], {"password": str(data["password"])})
        pref = g.db.execute("SELECT colors FROM house_assist.preferences WHERE user_id=?", (user["id"],)).fetchone()
        colors = data.get("colors", json.loads(pref["colors"]))
        if not isinstance(colors, list) or len(colors) not in (0, 4) or any(not isinstance(c, str) or len(c) != 7 or not c.startswith("#") for c in colors):
            return error("Choose valid profile colours.")
        g.db.execute("UPDATE house_assist.preferences SET theme=?,layout=?,compact=?,colors=? WHERE user_id=?",
                     (str(data.get("theme", "Ocean")), str(data.get("layout", "grid")), bool(data.get("compact", False)), json.dumps(colors), user["id"]))
        g.db.commit()
    except pg_errors.UniqueViolation:
        g.db.rollback()
        return error("That username is already in use.", 409)
    return me()


@app.get("/api/helpers")
def list_helpers():
    query = str(request.args.get("q", "")).strip()
    service = str(request.args.get("service", "")).strip()
    sort = request.args.get("sort", "rating")
    order = "price ASC" if sort == "low" else "price DESC" if sort == "high" else "rating DESC, rating_count DESC"
    rows = g.db.execute(f"SELECT * FROM house_assist.helpers WHERE (name ILIKE ? OR location ILIKE ?) ORDER BY {order}",
                        (f"%{query}%", f"%{query}%")).fetchall()
    items = [helper_json(row) for row in rows]
    if service:
        items = [item for item in items if service in item["s"]]
    return jsonify(items)


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
    pin = str(body().get("pin", ""))
    expected = os.environ.get("HOUSE_ASSIST_ADMIN_PIN", "")
    if not expected:
        return error("Admin access is not configured. Set HOUSE_ASSIST_ADMIN_PIN on the server.", 503)
    if not hmac.compare_digest(pin, expected):
        return error("Access code not recognised.", 401)
    return jsonify({"token": token_for("admin")})


@app.get("/api/admin/summary")
def admin_summary():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    users = [dict(row) for row in g.db.execute("SELECT username,role,created_at FROM house_assist.users ORDER BY created_at DESC LIMIT 100")]
    brand_row = g.db.execute("SELECT value FROM house_assist.settings WHERE key='branding'").fetchone()
    brand = json.loads(brand_row["value"]) if brand_row else {"name": "House Assist", "mark": "⌂", "favicon": "🏠"}
    hires = g.db.execute("SELECT COUNT(*) AS count FROM house_assist.hires").fetchone()["count"]
    return jsonify({"hires": hires, "helpers": g.db.execute("SELECT COUNT(*) AS count FROM house_assist.helpers").fetchone()["count"],
                    "customers": g.db.execute("SELECT COUNT(*) AS count FROM house_assist.users WHERE role='customer'").fetchone()["count"],
                    "users": users, "branding": brand})


@app.post("/api/admin/users")
def admin_add_user():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    data = body()
    name = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if len(name) < 2:
        return error("Enter a username to add.")
    if len(password) < 6:
        return error("Set a temporary password with at least 6 characters.")
    user_id = None
    try:
        auth_user = supabase_request("admin/users", {
            "email": auth_email(name),
            "password": password,
            "email_confirm": True,
            "user_metadata": {"username": name, "role": "customer", "location": "Accra"},
        }, admin=True)
        user_id = auth_user["id"]
        g.db.execute("INSERT INTO house_assist.users(id,username,password_hash,role,location,created_at) VALUES(?,?,?,?,?,?)",
                     (user_id, name, None, "customer", "Accra", int(time.time())))
        g.db.execute("INSERT INTO house_assist.preferences(user_id) VALUES(?)", (user_id,))
        g.db.commit()
    except (ValueError, RuntimeError) as exc:
        g.db.rollback()
        return error(str(exc), 409 if isinstance(exc, ValueError) else 503)
    except pg_errors.UniqueViolation:
        g.db.rollback()
        if user_id:
            delete_supabase_user(user_id)
        return error("That username is already in use.", 409)
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
