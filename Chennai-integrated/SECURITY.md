# Security Hardening

Four layers: TLS at the edge, security headers, default-deny authentication,
and a 2 MB request-body cap. The first is Nginx; the rest are enforced in the
application too, so the protections hold even when the API is run directly in
development.

---

## 1. TLS termination (Nginx)

`deploy/` contains a TLS-terminated deployment. Only Nginx publishes ports —
the API and PostgreSQL stay on a private Docker network and are never reachable
from outside.

```
browser ──HTTPS/443──▶ nginx ──HTTP──▶ backend:8000 ──▶ postgres:5432
                         │                (no published ports)
                         └── serves the built React app
```

```bash
cd deploy
cp .env.example .env          # set POSTGRES_PASSWORD and JWT_SECRET_KEY
./make-certs.sh               # self-signed cert for local testing
cd ../frontend && npm run build
cd ../deploy
docker compose -f docker-compose.tls.yml up -d --build
```

Open `https://localhost`. For production, replace `deploy/certs/*.pem` with a
CA-issued certificate (certbot's HTTP-01 challenge path is already routed) and
uncomment the OCSP stapling lines in `nginx/nginx.conf`.

TLS settings: TLS 1.2 and 1.3 only, ECDHE cipher suites, session tickets off,
`server_tokens off`, and a permanent redirect from port 80. The login endpoint
is rate-limited to 10 requests per minute per IP with a burst of 5.

When Nginx fronts the API, set `VITE_API_URL=/api` in `frontend/.env` so the
browser talks to the same origin and no CORS exemption is needed.

---

## 2. Security headers

Set by Nginx on the app, and by `SecurityHeadersMiddleware` on every API
response including errors.

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | app: `default-src 'self'` …`frame-ancestors 'none'`; API: `default-src 'none'` | blocks injected scripts and framing |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | the browser refuses plain HTTP for a year |
| `X-Content-Type-Options` | `nosniff` | no MIME-type guessing |
| `X-Frame-Options` | `DENY` | clickjacking |
| `Referrer-Policy` | `no-referrer` | ticket hashes never leak in referrers |
| `Permissions-Policy` | geolocation, camera, microphone off | unused browser capabilities |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` | cross-origin isolation |
| `Cache-Control` | `no-store` (API) | ticket data is not cached |

HSTS is only meaningful over TLS; set `ENABLE_HSTS=false` if you run the API
plain-HTTP behind something else.

---

## 3. Authentication on every endpoint

Two independent layers:

**Route level** — every route already declares `Depends(get_current_user)` or
`require_roles(...)`, which also enforces the role rules.

**Middleware level** — `JWTAuthMiddleware` denies by default. Any request
without a valid, unexpired, correctly signed bearer token gets `401` before it
reaches routing, so a route added later without a dependency still cannot be
public by accident. Verified: an unknown path with no token returns 401 rather
than 404.

The allowlist is deliberately short and lives in `app/core/middleware.py`:

| Path | Why |
|---|---|
| `POST /auth/login` | issues the token |
| `GET /health`, `GET /` | liveness probes |
| `GET /departments/public` | the complaint form needs department names before the user is verified; returns nothing but id and name |
| `/docs`, `/redoc`, `/openapi.json` | API documentation — remove these entries in production |

Also enforced: tokens expire after 60 minutes, passwords are bcrypt-hashed,
end users can read only their own tickets (`403` otherwise), and an expired
token logs the UI out rather than leaving a half-working session.

---

## 4. Upload size limit — 2 MB

Enforced three times, so no single layer is load-bearing:

1. **Nginx** — `client_max_body_size 2m`, rejected at the edge with a JSON 413.
2. **`BodySizeLimitMiddleware`** — checks `Content-Length` before routing.
3. **Handlers** — `_enforce_size()` re-checks the bytes actually read, covering
   clients that stream without a `Content-Length` header.

The limit is `MAX_UPLOAD_MB` in `.env` (default 2). Both upload screens also
check `file.size` before sending, so the user gets an immediate message instead
of a failed request. Applies to knowledge-base article files, dataset CSVs and
any optional attachment.

---

## 5. Other controls already in place

- Role checks are server-side on every route, never only hidden in the UI.
- Self-service signup is removed; account creation needs an admin token.
- Articles on the exclusion list can never be executed automatically — the
  attempt is rejected and recorded as `SELF_HEAL_BLOCKED`.
- Every ticket action writes an audit row with a SHA-256 of the ticket state at
  that moment, so tampering is detectable.
- The backend container runs as a non-root user.

## Before going to production

- [ ] Replace the self-signed certificate.
- [ ] Set a strong `JWT_SECRET_KEY` (`openssl rand -hex 32`) and a real database password.
- [ ] Remove `/docs`, `/redoc` and `/openapi.json` from the middleware allowlist.
- [ ] Set `CORS_ORIGINS` to the exact public origin.
- [ ] Put the `.env` files under a secret manager rather than in the repo.
