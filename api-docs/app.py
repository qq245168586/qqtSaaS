from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from route_scanner import build_openapi


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = Path(os.getenv("TMY_API_SOURCE", ROOT / "server" / "src"))
SERVER_URL = os.getenv("TMY_API_SERVER", "https://114.215.185.184/api")
OPENAPI = build_openapi(SOURCE_DIR, SERVER_URL)

app = FastAPI(
    title="意趣订单管理 API",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)
app.openapi = lambda: OPENAPI


@app.get("/", include_in_schema=False)
def index() -> RedirectResponse:
    return RedirectResponse("/docs")


@app.get("/meta", include_in_schema=False)
def meta() -> dict[str, object]:
    return {
        "route_count": OPENAPI["x-route-count"],
        "source": str(SOURCE_DIR),
        "server": SERVER_URL,
    }
