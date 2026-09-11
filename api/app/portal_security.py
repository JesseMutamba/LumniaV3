"""The production portal password format and an in-process login throttle."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from collections import deque

ITERATIONS = int(os.getenv("LUMNIA_PBKDF2_ITERS", "260000"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_hex, dk_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, TypeError, AttributeError, OverflowError):
        return False


class Throttle:
    """Fixed attempts per window, with a lock for FastAPI's worker threads.

    This is a single-process throttle, matching the production runtime. Bound
    tracked keys so unauthenticated requests cannot grow this map indefinitely.
    """

    def __init__(self, limit: int = 8, window: float = 300.0, max_keys: int = 10000) -> None:
        self.limit, self.window, self.max_keys = limit, window, max_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            if key not in self._hits and len(self._hits) >= self.max_keys:
                expired = [k for k, hits in self._hits.items() if not hits or now - hits[-1] > self.window]
                for old_key in expired:
                    del self._hits[old_key]
                if len(self._hits) >= self.max_keys:
                    return False
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def clear(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)
