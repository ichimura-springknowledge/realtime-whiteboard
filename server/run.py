"""Convenience entry point: `python run.py` (or `npm start` in the old layout).

Reads PORT / HOST from the environment so the port can be chosen to suit the
office firewall without touching any code.
"""

import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("HOST") or "0.0.0.0",
        port=int(os.environ.get("PORT") or 5000),
        log_level=os.environ.get("LOG_LEVEL") or "warning",
    )
