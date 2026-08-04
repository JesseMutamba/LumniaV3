"""The one place the platform talks to a model.

The house rule holds everywhere it is used: the model reads menus and picks
from them, or turns computed facts into sentences. It never computes a
figure, and every answer it gives is validated against what the caller
already knows to be true before anything reaches a reader.
"""
from __future__ import annotations

import json
import os

MODEL_ENV = "LUMNIA_NARRATE_MODEL"
DEFAULT_MODEL = "claude-opus-5"


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def choose(system: str, user: str, max_tokens: int = 512) -> dict | None:
    """Ask for a JSON object. Returns None on any failure — no key, no
    network, a refusal, or a reply that is not the object we asked for.
    Every caller must be able to do its job without this returning."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import httpx

        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": os.environ.get(MODEL_ENV, DEFAULT_MODEL),
                "max_tokens": max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": user}],
            },
            timeout=25.0,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        if data.get("stop_reason") == "refusal":
            return None
        text = "".join(
            p.get("text", "") for p in data.get("content", [])
            if p.get("type") == "text"
        ).strip()
        if text.startswith("```"):
            text = text.strip("`").removeprefix("json").strip()
        out = json.loads(text)
        return out if isinstance(out, dict) else None
    except Exception:
        return None
