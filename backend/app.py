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
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_from_directory
import psycopg
from psycopg import errors as pg_errors
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
SUPABASE_DB_URL = os.environ.get("SUPABASE_DB_URL", "")
TOKEN_TTL = 60 * 60 * 24 * 14
SERVICES = {
    "House Cleaning", "Plumbing & Electrical", "Painting & Repairs",
    "Gardening & Lawn Care", "Laundry & Ironing", "Cooking & Kitchen Assist",
    "Moving & Packing", "Elderly & Child Care",
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
    connection = psycopg.connect(SUPABASE_DB_URL, row_factory=dict_row)
    connection.execute("SET search_path TO house_assist, public")
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


def token_for(role: str, user_id: Any | None = None) -> str:
    token = secrets.token_urlsafe(32)
    g.db.execute("INSERT INTO sessions(token_hash,user_id,role,expires_at) VALUES(?,?,?,?)",
                 (hashlib.sha256(token.encode()).hexdigest(), user_id, role, int(time.time()) + TOKEN_TTL))
    g.db.commit()
    return token


@app.before_request
def open_db():
    g.db = connect()


@app.teardown_request
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def current_user(required: bool = True):
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    row = g.db.execute("""SELECT s.role session_role,s.expires_at,u.* FROM sessions s
                          LEFT JOIN users u ON u.id=s.user_id WHERE s.token_hash=?""",
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
    return send_from_directory(ROOT, "house-assist.html")


@app.get("/app.js")
def frontend_script():
    return send_from_directory(ROOT, "app.js")


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
    try:
        cur = g.db.execute("INSERT INTO users(username,password_hash,role,location,created_at) VALUES(?,?,?,?,?) RETURNING id",
                           (username, password_hash(password), role, location, int(time.time())))
    except pg_errors.UniqueViolation:
        g.db.rollback()
        return error("That username is already in use.", 409)
    user_id = cur.fetchone()["id"]
    g.db.execute("INSERT INTO preferences(user_id) VALUES(?)", (user_id,))
    if role == "helper":
        service = data.get("service")
        try:
            price = int(data.get("price", 0))
        except (TypeError, ValueError):
            price = 0
        if service not in SERVICES or price < 1:
            g.db.rollback()
            return error("Choose a service and add a valid daily price.")
        g.db.execute("INSERT INTO helpers(user_id,name,location,services,price) VALUES(?,?,?,?,?)",
                     (user_id, username, location, json.dumps([service]), price))
    g.db.commit()
    token = token_for(role, user_id)
    return jsonify({"token": token, "user": {"id": user_id, "name": username, "role": role, "loc": location}}), 201


@app.post("/api/auth/login")
def login():
    data = body()
    username, password, role = str(data.get("username", "")).strip(), str(data.get("password", "")), data.get("role")
    row = g.db.execute("SELECT * FROM users WHERE lower(username)=lower(?)", (username,)).fetchone()
    if not row or not password_ok(password, row["password_hash"]):
        return error("Username or password is incorrect.", 401)
    if role != row["role"]:
        return error("That account uses a different sign-in option.", 403)
    token = token_for(row["role"], row["id"])
    return jsonify({"token": token, "user": {"id": row["id"], "name": row["username"], "role": row["role"], "loc": row["location"]}})


@app.post("/api/auth/logout")
def logout():
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else ""
    if token:
        g.db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
        g.db.commit()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    user, problem = auth_required()
    if problem:
        return problem
    pref = g.db.execute("SELECT * FROM preferences WHERE user_id=?", (user["id"],)).fetchone()
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
        g.db.execute("UPDATE users SET username=?,location=? WHERE id=?",
                     (username, str(data.get("location", user["location"])).strip(), user["id"]))
        if user["role"] == "helper":
            g.db.execute("UPDATE helpers SET name=?,location=? WHERE user_id=?", (username, str(data.get("location", user["location"])).strip(), user["id"]))
        if data.get("password"):
            if len(str(data["password"])) < 6:
                return error("Password needs at least 6 characters.")
            g.db.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hash(str(data["password"])), user["id"]))
        pref = g.db.execute("SELECT colors FROM preferences WHERE user_id=?", (user["id"],)).fetchone()
        colors = data.get("colors", json.loads(pref["colors"]))
        if not isinstance(colors, list) or len(colors) not in (0, 4) or any(not isinstance(c, str) or len(c) != 7 or not c.startswith("#") for c in colors):
            return error("Choose valid profile colours.")
        g.db.execute("UPDATE preferences SET theme=?,layout=?,compact=?,colors=? WHERE user_id=?",
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
    rows = g.db.execute(f"SELECT * FROM helpers WHERE (name ILIKE ? OR location ILIKE ?) ORDER BY {order}",
                        (f"%{query}%", f"%{query}%")).fetchall()
    items = [helper_json(row) for row in rows]
    if service:
        items = [item for item in items if service in item["s"]]
    return jsonify(items)


@app.get("/api/guide")
def price_guide():
    return jsonify([dict(row) for row in g.db.execute("SELECT CAST(ROUND(rating) AS INTEGER) stars,MIN(price) low,MAX(price) high,COUNT(*) count FROM helpers GROUP BY stars ORDER BY stars DESC")])


@app.post("/api/hires")
def create_hire():
    user, problem = auth_required("customer")
    if problem:
        return problem
    data = body()
    method = data.get("payment_method")
    if method not in ("cash", "bank", "momo"):
        return error("Choose a payment method.")
    helper = g.db.execute("SELECT id FROM helpers WHERE id=?", (data.get("helper_id"),)).fetchone()
    if not helper:
        return error("This house help listing is no longer available.", 404)
    cur = g.db.execute("INSERT INTO hires(customer_id,helper_id,payment_method,payment_detail,created_at) VALUES(?,?,?,?,?) RETURNING id",
                       (user["id"], helper["id"], method, str(data.get("payment_detail", "")), int(time.time())))
    g.db.commit()
    return jsonify({"id": cur.fetchone()["id"], "helper_id": helper["id"], "customer_paid": False, "helper_received": False}), 201


@app.get("/api/hires")
def list_hires():
    user, problem = auth_required("customer")
    if problem:
        return problem
    rows = g.db.execute("""SELECT h.*,p.name helper_name,p.location,p.services,p.price,p.phone,p.rating,p.rating_count
                          FROM hires h JOIN helpers p ON p.id=h.helper_id WHERE h.customer_id=? ORDER BY h.created_at DESC""", (user["id"],)).fetchall()
    return jsonify([{"id": r["id"], "helper": {"id": r["helper_id"], "n": r["helper_name"], "l": r["location"], "s": json.loads(r["services"]), "p": r["price"], "r": round(r["rating"]), "ph": r["phone"]}, "payment_method": r["payment_method"], "customer_paid": bool(r["customer_paid"]), "helper_received": bool(r["helper_received"])} for r in rows])


@app.get("/api/helper/hires")
def helper_hires():
    user, problem = auth_required("helper")
    if problem:
        return problem
    rows = g.db.execute("""SELECT h.*,u.username customer,p.location,p.price FROM hires h
                          JOIN users u ON u.id=h.customer_id JOIN helpers p ON p.id=h.helper_id
                          WHERE p.user_id=? ORDER BY h.created_at DESC""", (user["id"],)).fetchall()
    return jsonify([{"id": r["id"], "customer": r["customer"], "location": r["location"], "price": r["price"],
                     "payment_method": r["payment_method"], "customer_paid": bool(r["customer_paid"]),
                     "helper_received": bool(r["helper_received"])} for r in rows])


@app.patch("/api/hires/<int:hire_id>/payment")
def confirm_payment(hire_id: int):
    user, problem = auth_required("customer")
    if problem:
        return problem
    cur = g.db.execute("UPDATE hires SET customer_paid=TRUE WHERE id=? AND customer_id=?", (hire_id, user["id"]))
    if not cur.rowcount:
        return error("Hire was not found.", 404)
    g.db.commit()
    return jsonify({"ok": True})


@app.patch("/api/hires/<int:hire_id>/received")
def confirm_received(hire_id: int):
    user, problem = auth_required("helper")
    if problem:
        return problem
    cur = g.db.execute("""UPDATE hires SET helper_received=TRUE WHERE id=? AND customer_paid=TRUE
                          AND helper_id IN (SELECT id FROM helpers WHERE user_id=?)""", (hire_id, user["id"]))
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
    hire = g.db.execute("SELECT * FROM hires WHERE id=? AND customer_id=? AND customer_paid=TRUE", (hire_id, user["id"])).fetchone()
    if not hire or not hire["helper_received"]:
        return error("The hire must be confirmed by both people before feedback.", 409)
    if not stars and not recommendation:
        return error("Add a rating or a recommendation first.")
    if stars is not None and (not isinstance(stars, int) or stars < 1 or stars > 5):
        return error("Choose a rating from 1 to 5.")
    try:
        g.db.execute("INSERT INTO ratings(hire_id,customer_id,helper_id,stars,recommendation,created_at) VALUES(?,?,?,?,?,?)",
                     (hire_id, user["id"], hire["helper_id"], stars, recommendation, int(time.time())))
    except pg_errors.UniqueViolation:
        g.db.rollback()
        return error("Feedback was already submitted for this hire.", 409)
    if stars:
        g.db.execute("UPDATE helpers SET rating=((rating*rating_count)+?)/(rating_count+1),rating_count=rating_count+1 WHERE id=?", (stars, hire["helper_id"]))
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
    users = [dict(row) for row in g.db.execute("SELECT username,role,created_at FROM users ORDER BY created_at DESC LIMIT 100")]
    brand_row = g.db.execute("SELECT value FROM settings WHERE key='branding'").fetchone()
    brand = json.loads(brand_row["value"]) if brand_row else {"name": "House Assist", "mark": "⌂", "favicon": "🏠"}
    hires = g.db.execute("SELECT COUNT(*) AS count FROM hires").fetchone()["count"]
    return jsonify({"hires": hires, "helpers": g.db.execute("SELECT COUNT(*) AS count FROM helpers").fetchone()["count"],
                    "customers": g.db.execute("SELECT COUNT(*) AS count FROM users WHERE role='customer'").fetchone()["count"],
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
    try:
        cur = g.db.execute("INSERT INTO users(username,password_hash,role,location,created_at) VALUES(?,?,?,?,?) RETURNING id",
                           (name, password_hash(password), "customer", "Accra", int(time.time())))
        g.db.execute("INSERT INTO preferences(user_id) VALUES(?)", (cur.fetchone()["id"],))
        g.db.commit()
    except pg_errors.UniqueViolation:
        g.db.rollback()
        return error("That username is already in use.", 409)
    return jsonify({"ok": True}), 201


@app.patch("/api/admin/branding")
def update_branding():
    _admin, problem = auth_required("admin")
    if problem:
        return problem
    data = body()
    brand = {"name": str(data.get("name", "House Assist"))[:60], "mark": str(data.get("mark", "⌂"))[:2], "favicon": str(data.get("favicon", "🏠"))[:2]}
    g.db.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("branding", json.dumps(brand)))
    g.db.commit()
    return jsonify(brand)


@app.get("/api/branding")
def get_branding():
    brand = g.db.execute("SELECT value FROM settings WHERE key='branding'").fetchone()
    return jsonify(json.loads(brand["value"]) if brand else {"name": "House Assist", "mark": "⌂", "favicon": "🏠"})

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5000")), debug=False)
