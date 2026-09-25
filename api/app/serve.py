"""Run the single web/API process on Railway's assigned port."""
import os

import uvicorn


def main():
    raw = os.getenv("PORT", "8000")
    try:
        port = int(raw)
    except ValueError:
        raise SystemExit("PORT must be an integer between 1 and 65535.")
    if not 1 <= port <= 65535:
        raise SystemExit("PORT must be an integer between 1 and 65535.")
    # SQLite is local to one attached volume; do not spawn independent replicas.
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, workers=1)


if __name__ == "__main__":
    main()
