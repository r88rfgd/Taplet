"""
db.py — SQLite-backed user-data store for TAPLET.

Replaces the previous JSON-file approach (load_user_json / save_user_json)
which was prone to race conditions under concurrent Flask requests. SQLite
gives us atomic, serialized writes.

Design (coordinated DB access, similar to a master-worker setup):
  * A single writer connection guarded by a threading.Lock serializes all
    mutating transactions, so concurrent POST/DELETE requests cannot
    interleave and corrupt the data.
  * Reads open their own short-lived connections (no lock needed for
    isolation in WAL mode), keeping GET endpoints responsive.
  * The DB file lives at DB_PATH (from env, default user_data/taplet.db).
  * On first init we auto-migrate any existing user_data/*.json files into
    the tables so no prior data is lost.
"""

import os
import json
import sqlite3
import threading
from typing import Optional, List, Dict, Any

# ---------------------------------------------------------------------------
# Configuration / connection management
# ---------------------------------------------------------------------------
DB_PATH = os.getenv("DB_PATH", "user_data/taplet.db")

# Serialize all writes so concurrent Flask threads cannot interleave
# transactions and corrupt the data. Each operation opens its own
# connection (created AND closed in the same thread) to stay thread-safe —
# a sqlite3 connection created in one thread cannot be reused in another.
_write_lock = threading.Lock()


def _connect() -> sqlite3.Connection:
    """Open a fresh connection (WAL mode, dict-like row access).

    A new connection is created per operation and closed immediately
    afterwards, so it is always used in the thread that created it.
    """
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def init_db() -> None:
    """Create tables if they do not exist and migrate legacy JSON files."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = _connect()
    with _write_lock:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS medicines (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                expiry TEXT DEFAULT '',
                added TEXT
            );
            CREATE TABLE IF NOT EXISTS allergies (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                added TEXT
            );
            CREATE TABLE IF NOT EXISTS health_data (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                metrics TEXT
            );
            CREATE TABLE IF NOT EXISTS food_log (
                id TEXT PRIMARY KEY,
                timestamp TEXT,
                image TEXT,
                calories INTEGER DEFAULT 0,
                risks TEXT,
                description TEXT
            );
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                name TEXT,
                file TEXT,
                url TEXT,
                type TEXT,
                added TEXT
            );
            """
        )
        conn.commit()
    _migrate_legacy_json()


def _migrate_legacy_json() -> None:
    """Import existing user_data/*.json into the DB on first run only."""
    legacy = {
        "medicines.json": ("medicines", ["id", "name", "expiry", "added"]),
        "allergies.json": ("allergies", ["id", "name", "added"]),
        "health_data.json": ("health_data", ["id", "timestamp", "metrics"]),
        "food_log.json": ("food_log", ["id", "timestamp", "image", "calories", "risks", "description"]),
        "documents.json": ("documents", ["id", "name", "file", "url", "type", "added"]),
    }
    base = os.path.dirname(DB_PATH) or "."
    for fname, (table, cols) in legacy.items():
        path = os.path.join(base, fname)
        if not os.path.exists(path):
            continue
        try:
            with open(path, "r") as f:
                rows = json.load(f)
        except Exception:
            continue
        if not isinstance(rows, list) or not rows:
            continue
        # Skip if table already has data (avoid double import)
        existing = _read(f"SELECT COUNT(*) AS c FROM {table}")
        if existing and existing[0]["c"] > 0:
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            vals = []
            for c in cols:
                v = row.get(c, "" if c not in ("metrics", "risks") else "{}" if c == "metrics" else "[]")
                if c in ("metrics", "risks") and not isinstance(v, str):
                    v = json.dumps(v)
                vals.append(v)
            placeholders = ",".join("?" for _ in cols)
            with _write_lock:
                mconn = _connect()
                try:
                    mconn.execute(
                        f"INSERT OR IGNORE INTO {table} ({','.join(cols)}) VALUES ({placeholders})",
                        vals,
                    )
                    mconn.commit()
                finally:
                    mconn.close()


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------
def _write(sql: str, params: tuple) -> None:
    """Execute a write (INSERT/UPDATE/DELETE), serialized across threads.

    Opens its own connection inside the lock so the connection is always
    used in the thread that created it (sqlite3 thread-safety rule).
    """
    with _write_lock:
        conn = _connect()
        try:
            conn.execute(sql, params)
            conn.commit()
        finally:
            conn.close()


def _read(sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    conn = _connect()
    try:
        cur = conn.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Medicines
# ---------------------------------------------------------------------------
def get_medicines() -> List[Dict[str, Any]]:
    return _read("SELECT id, name, expiry, added FROM medicines ORDER BY added DESC")


def insert_medicine(item: Dict[str, Any]) -> None:
    _write(
        "INSERT INTO medicines (id, name, expiry, added) VALUES (?, ?, ?, ?)",
        (item["id"], item["name"], item.get("expiry", ""), item.get("added")),
    )


def delete_medicine(mid: str) -> None:
    _write("DELETE FROM medicines WHERE id = ?", (mid,))


# ---------------------------------------------------------------------------
# Allergies
# ---------------------------------------------------------------------------
def get_allergies() -> List[Dict[str, Any]]:
    return _read("SELECT id, name, added FROM allergies ORDER BY added DESC")


def insert_allergy(item: Dict[str, Any]) -> None:
    _write(
        "INSERT INTO allergies (id, name, added) VALUES (?, ?, ?)",
        (item["id"], item["name"], item.get("added")),
    )


def delete_allergy(aid: str) -> None:
    _write("DELETE FROM allergies WHERE id = ?", (aid,))


def allergy_exists(name: str) -> bool:
    rows = _read("SELECT 1 FROM allergies WHERE lower(name) = lower(?) LIMIT 1", (name,))
    return len(rows) > 0


# ---------------------------------------------------------------------------
# Health data
# ---------------------------------------------------------------------------
def get_health_data() -> List[Dict[str, Any]]:
    rows = _read("SELECT id, timestamp, metrics FROM health_data ORDER BY timestamp DESC")
    for r in rows:
        try:
            r["metrics"] = json.loads(r["metrics"]) if r["metrics"] else {}
        except (ValueError, TypeError):
            r["metrics"] = {}
    return rows


def insert_health_data(item: Dict[str, Any]) -> None:
    _write(
        "INSERT INTO health_data (id, timestamp, metrics) VALUES (?, ?, ?)",
        (item["id"], item.get("timestamp"), json.dumps(item.get("metrics", {}))),
    )


def delete_health_data(hid: str) -> None:
    _write("DELETE FROM health_data WHERE id = ?", (hid,))


# ---------------------------------------------------------------------------
# Food log
# ---------------------------------------------------------------------------
def get_food_log() -> List[Dict[str, Any]]:
    rows = _read("SELECT id, timestamp, image, calories, risks, description FROM food_log ORDER BY timestamp DESC")
    for r in rows:
        try:
            r["risks"] = json.loads(r["risks"]) if r["risks"] else []
        except (ValueError, TypeError):
            r["risks"] = []
    return rows


def insert_food_log(item: Dict[str, Any]) -> None:
    _write(
        "INSERT INTO food_log (id, timestamp, image, calories, risks, description) VALUES (?, ?, ?, ?, ?, ?)",
        (
            item["id"],
            item.get("timestamp"),
            item.get("image", ""),
            item.get("calories", 0),
            json.dumps(item.get("risks", [])),
            item.get("description", ""),
        ),
    )


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------
def get_documents(q: str = "") -> List[Dict[str, Any]]:
    if q:
        return _read("SELECT id, name, file, url, type, added FROM documents WHERE lower(name) LIKE ? ORDER BY added DESC", (f"%{q.lower()}%",))
    return _read("SELECT id, name, file, url, type, added FROM documents ORDER BY added DESC")


def insert_document(item: Dict[str, Any]) -> None:
    _write(
        "INSERT INTO documents (id, name, file, url, type, added) VALUES (?, ?, ?, ?, ?, ?)",
        (item["id"], item.get("name"), item.get("file"), item.get("url"), item.get("type"), item.get("added")),
    )
