"""Security headers and browser CORS for Lumi.

The public site Vercel publishes is frontend/source
(frontend/source/vercel.json). vercel.json at the git root has the same
headers, with rewrites under /frontend/source, and is not read while Root
Directory stays frontend/source. Keep the CSP in sync when changing either
place. CORS is never `*` and is only attached to /api.
"""
import re

from starlette.requests import Request
from starlette.responses import Response

# Inline scripts and style attributes are part of the current UI, so
# 'unsafe-inline' stays. 'unsafe-eval' is intentionally absent.
# 'wasm-unsafe-eval' is only so PDF.js can compile its image decoders.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'self'; "
    "form-action 'self'; "
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https://*.supabase.co; "
    "font-src 'self' data:; "
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://radoxai.com https://raw.githubusercontent.com; "
    "media-src 'self' blob: data: https:; "
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; "
    "worker-src 'self' blob:; "
    "manifest-src 'self'"
)

DOCS_CONTENT_SECURITY_POLICY = (
    "default-src 'self' https://cdn.jsdelivr.net https://cdn.redoc.ly; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'self'; "
    "form-action 'self'; "
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.redoc.ly; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdn.redoc.ly https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' data: https://cdn.jsdelivr.net https://cdn.redoc.ly https://fastapi.tiangolo.com; "
    "worker-src 'self'"
)

PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"

_LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")

_SENSITIVE_PREFIXES = ("/api", "/docs", "/redoc", "/openapi")


def allowed_cors_origin(origin: str | None, *, configured: list[str], production: bool) -> str | None:
    """Return the origin to echo, or None when the browser must be denied."""
    if not origin:
        return None
    if origin in configured:
        return origin
    if production:
        return None
    # Local Android WebView (file://) and laptop dev servers.
    if origin == "null" or _LOCAL_ORIGIN.fullmatch(origin):
        return origin
    return None


def _is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    forwarded = request.headers.get("x-forwarded-proto", "")
    return forwarded.split(",")[0].strip().lower() == "https"


def _is_sensitive_path(path: str, content_type: str) -> bool:
    if path == "/" or path.startswith(_SENSITIVE_PREFIXES) or path.startswith("/app"):
        return True
    return "text/html" in content_type.lower()


def apply_security_headers(response: Response, request: Request) -> None:
    path = request.url.path
    content_type = response.headers.get("content-type", "")
    docs = path.startswith("/docs") or path.startswith("/redoc")

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"

    # API responses must stay readable by an allowed browser origin.
    # Same-origin static files should not be embedded by other sites.
    if not path.startswith("/api"):
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"

    policy = DOCS_CONTENT_SECURITY_POLICY if docs else CONTENT_SECURITY_POLICY
    if _is_https(request) and not docs:
        policy = policy + "; upgrade-insecure-requests"
    response.headers["Content-Security-Policy"] = policy

    if _is_https(request):
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"

    if _is_sensitive_path(path, content_type):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"


def apply_api_cors(response: Response, origin: str) -> None:
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, Accept"
    response.headers["Access-Control-Max-Age"] = "600"
    vary = response.headers.get("vary")
    if not vary:
        response.headers["Vary"] = "Origin"
    elif "origin" not in vary.lower():
        response.headers["Vary"] = vary + ", Origin"
