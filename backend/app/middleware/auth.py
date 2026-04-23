"""Optional API key + Supabase JWT authentication middleware."""

from __future__ import annotations

import hmac
import logging
import jwt  # PyJWT
from jwt import PyJWKClient
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import settings

logger = logging.getLogger("auth")


def _cors_response(status_code: int, detail: str, request: Request) -> JSONResponse:
    """Return a JSON error response with CORS headers so the browser doesn't
    swallow the status code as an opaque NetworkError."""
    origin = request.headers.get("origin", "")
    headers = {}
    if origin and origin in settings.cors_origins:
        headers["access-control-allow-origin"] = origin
        headers["access-control-allow-credentials"] = "true"
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers=headers,
    )

# Cache the JWKS client (fetches keys lazily and caches them)
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient | None:
    """Get or create the JWKS client for Supabase JWT verification."""
    global _jwks_client
    if _jwks_client is not None:
        return _jwks_client

    supabase_url = settings.supabase_url.strip().rstrip("/")
    if not supabase_url:
        return None

    jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
    _jwks_client = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
    return _jwks_client


def _verify_supabase_jwt(token: str) -> dict | None:
    """Verify a Supabase JWT and return the payload, or None if invalid.

    Tries JWKS (ES256) first - the modern Supabase default.
    Falls back to HS256 with the JWT secret for older projects.
    """
    # Try JWKS verification first (ES256)
    jwks_client = _get_jwks_client()
    if jwks_client:
        try:
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                options={"verify_aud": False},
            )
            return payload
        except (jwt.InvalidTokenError, Exception) as e:
            logger.debug(f"JWKS verification failed: {e}")

    # Fall back to HS256 with JWT secret (older Supabase projects)
    jwt_secret = settings.supabase_jwt_secret.strip()
    if jwt_secret:
        try:
            payload = jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )
            return payload
        except jwt.InvalidTokenError as e:
            logger.debug(f"HS256 verification failed: {e}")

    return None


def _is_auth_configured() -> bool:
    """Check if any form of authentication is configured."""
    return bool(
        settings.api_key.strip()
        or settings.supabase_jwt_secret.strip()
        or settings.supabase_url.strip()
    )


class APIKeyMiddleware(BaseHTTPMiddleware):
    """Authenticate requests via Supabase JWT or API key.

    Auth is checked in this order:

    1. If **no** auth is configured (no ``api_key``, no ``supabase_jwt_secret``,
       no ``supabase_url``), all requests pass through (backward-compatible).
    2. ``GET /api/health`` is always allowed without auth.
    3. ``Authorization: Bearer <token>`` header:
       - Try to decode as a Supabase JWT (JWKS/ES256 then HS256).
       - If that fails, check if the token matches ``api_key``.
    4. ``X-API-Key`` header checked against ``api_key``.
    5. If nothing matches, return **401**.
    """

    async def dispatch(self, request: Request, call_next):
        api_key = settings.api_key.strip()

        # No auth configured at all -- allow everything (backward compatible)
        if not _is_auth_configured():
            request.state.user = None
            return await call_next(request)

        # Always allow CORS preflight requests without auth
        if request.method == "OPTIONS":
            request.state.user = None
            return await call_next(request)

        # Always allow the health endpoint without auth
        if request.method == "GET" and request.url.path == "/api/health":
            request.state.user = None
            return await call_next(request)

        # Check Authorization: Bearer <token>
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()

            # Try Supabase JWT verification
            payload = _verify_supabase_jwt(token)
            if payload is not None:
                # Check email domain restriction
                allowed_domains = settings.allowed_email_domains
                if allowed_domains:
                    email = payload.get("email", "")
                    domain = email.split("@")[-1].lower() if "@" in email else ""
                    if domain not in [d.lower() for d in allowed_domains]:
                        return _cors_response(403, "Access restricted to authorized domains", request)
                request.state.user = payload
                return await call_next(request)

            # Fall back to API key match
            if api_key and hmac.compare_digest(token, api_key):
                request.state.user = None
                return await call_next(request)

        # Check X-API-Key header
        if api_key:
            x_api_key = request.headers.get("x-api-key", "")
            if hmac.compare_digest(x_api_key.strip(), api_key):
                request.state.user = None
                return await call_next(request)

        return _cors_response(401, "Invalid or missing API key", request)
