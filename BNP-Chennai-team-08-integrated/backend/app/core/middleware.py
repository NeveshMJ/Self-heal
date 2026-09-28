"""
Security middleware.

Three layers, applied to every request before it reaches a route:

1. BodySizeLimitMiddleware - rejects any request body over the configured
   limit (2 MB by default) with 413, so an oversized upload never reaches
   the handler or fills memory.
2. JWTAuthMiddleware      - default-deny authentication. Every path needs a
   valid bearer token except a short, explicit allowlist (login, health,
   the API docs, and the public department list the complaint form needs).
   The per-route `Depends(get_current_user)` / `require_roles(...)` checks
   still run; this is defence in depth, so a route added without a
   dependency cannot accidentally be public.
3. SecurityHeadersMiddleware - CSP, HSTS, X-Content-Type-Options and friends
   on every response, including error responses.
"""
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.config import settings

# Paths that must work without a token. Everything else is denied by default.
PUBLIC_PATHS = {
    "/",
    "/health",
    "/auth/login",
    "/departments/public",   # the public complaint form needs the list
    "/docs",
    "/redoc",
    "/openapi.json",
    "/docs/oauth2-redirect",
}

PUBLIC_PREFIXES = ("/static",)


def _is_public(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject oversized uploads (attachments, datasets, article files)."""

    async def dispatch(self, request, call_next):
        # Ticket attachments and ordinary uploads stay at 2 MB. The dedicated
        # Knowledge Base endpoint gets a larger envelope so a ZIP can contain
        # many small articles; the route performs its own per-file/extraction
        # limits before anything is written to the database.
        configured_mb = (settings.knowledge_base_max_upload_mb
                         if request.url.path == "/admin/articles/upload"
                         else settings.max_upload_mb)
        max_bytes = int(configured_mb * 1024 * 1024)
        declared = request.headers.get("content-length")

        if declared:
            try:
                if int(declared) > max_bytes:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": f"Upload too large. The limit is "
                                           f"{configured_mb} MB."},
                    )
            except ValueError:
                return JSONResponse(status_code=400,
                                    content={"detail": "Invalid Content-Length"})

        return await call_next(request)


class JWTAuthMiddleware(BaseHTTPMiddleware):
    """Require a valid JWT on every endpoint outside the allowlist."""

    async def dispatch(self, request, call_next):
        # CORS preflight carries no credentials by design
        if request.method == "OPTIONS" or _is_public(request.url.path):
            return await call_next(request)

        header = request.headers.get("authorization", "")
        if not header.lower().startswith("bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Authentication required"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = header.split(" ", 1)[1].strip()
        try:
            payload = jwt.decode(token, settings.jwt_secret_key,
                                 algorithms=[settings.jwt_algorithm])
        except JWTError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired authentication token"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # hand the claims to the route layer (it still re-validates the user)
        request.state.jwt_claims = payload
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Standard hardening headers on every response."""

    def __init__(self, app, hsts: bool = True):
        super().__init__(app)
        self.hsts = hsts

    async def dispatch(self, request, call_next):
        response = await call_next(request)

        # the API serves JSON only, so the policy can be very tight.
        # Swagger UI needs its CDN assets, hence the exception.
        if request.url.path in ("/docs", "/redoc"):
            csp = ("default-src 'self'; img-src 'self' data: https://fastapi.tiangolo.com; "
                   "script-src 'self' https://cdn.jsdelivr.net; "
                   "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
                   "frame-ancestors 'none'")
        else:
            csp = ("default-src 'none'; frame-ancestors 'none'; "
                   "base-uri 'none'; form-action 'none'")

        response.headers["Content-Security-Policy"] = csp
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        response.headers["Cache-Control"] = "no-store"

        # HSTS is only meaningful over TLS; Nginx terminates it in front
        if self.hsts:
            response.headers["Strict-Transport-Security"] = \
                "max-age=31536000; includeSubDomains"

        return response
