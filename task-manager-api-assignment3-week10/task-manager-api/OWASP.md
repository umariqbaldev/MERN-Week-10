# OWASP Top 10 (2021) — Mitigation Map

This document maps each item from the OWASP Top 10 (2021 edition) to the
concrete mitigation in this codebase, or to a justified "N/A".

---

## A01:2021 — Broken Access Control

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| JwtAuthGuard applied globally via APP_GUARD — every route requires a valid Bearer token unless explicitly marked `@Public()`. | `src/auth/guards/jwt-auth.guard.ts`, `src/auth/auth.module.ts` |
| RolesGuard reads the caller's role from `project_members` on the **relevant** project — not "any project the user belongs to" (confused-deputy protection, C3 Asgn2). | `src/auth/guards/roles.guard.ts` |
| `@Roles()` decorator on every write route restricts to owner/admin/member as appropriate. Viewer → 403. | All controllers: `tasks.controller.ts`, `projects.controller.ts`, `comments.controller.ts` |
| Resource-ownership guard (X1 Asgn2): only a task's creator, assignee, or project owner may edit it. | `src/tasks/tasks.service.ts` (update method) |
| Only owner/admin may delete a project (C2 Asgn2). | `projects.controller.ts` — `@Roles('owner', 'admin')` on DELETE |
| E2e tests prove both the 403 path and the allowed path (C5 Asgn2). | `src/auth/rbac.e2e.spec.ts` |

---

## A02:2021 — Cryptographic Failures

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| Passwords hashed with argon2 (time-cost and memory-cost from env config) — never stored in plaintext. | `src/auth/auth.service.ts` |
| JWT secret loaded from environment via ConfigModule, never hard-coded. | `src/auth/auth.module.ts`, `.env` |
| Refresh tokens stored as SHA-256 hashes; the raw token is never persisted. | `src/auth/auth.service.ts` |
| The password hash is excluded from every user-facing response. | `src/auth/auth.service.ts` — `register()` deletes `password_hash` from the returned object |
| helmet enables Strict-Transport-Security (HSTS) by default. | `src/main.ts` — `app.use(helmet())` |

---

## A03:2021 — Injection

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| TypeORM parameterised queries — no raw string concatenation with user input. | All `.service.ts` files use `Repository` methods (`.findOne`, `.save`, `.createQueryBuilder` with parameters). |
| Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true` strips or rejects unexpected fields before they reach service code. | `src/main.ts` |
| `class-validator` decorators on every DTO enforce type, length, and enum constraints. | `src/tasks/dto/create-task.dto.ts`, `src/projects/dto/create-project.dto.ts`, etc. |
| `ParsePositiveIntPipe` on every `:id` / `:taskId` route parameter — non-numeric input never reaches the database. | `src/common/pipes/parse-positive-int.pipe.ts`, all controllers |

---

## A04:2021 — Insecure Design

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| Refresh-token rotation with family-based reuse detection — a stolen token is detected and the entire family is revoked (X1 Asgn1). | `src/auth/auth.service.ts` — `refresh()` method |
| Expiry checked on every refresh — expired tokens rejected even if the hash matches (X2 Asgn1). | `src/auth/auth.service.ts` — `refresh()` method |
| Rate limiting on auth routes (10 req / 60 s) prevents brute-force (W1 Asgn3). | `src/auth/auth.controller.ts` — `@Throttle()` |
| Role and ownership are separate concepts — "a member may edit tasks" and "a member may edit anyone's task" are not the same rule (X1 Asgn2). | `src/tasks/tasks.service.ts` — ownership check in `update()` |

---

## A05:2021 — Security Misconfiguration

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| `helmet` sets secure defaults: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, CSP with real directives (X1 Asgn3). | `src/main.ts` |
| CORS restricted to `http://localhost:3000` (or env `CORS_ORIGIN`) — no wildcard (W2 Asgn3). | `src/main.ts` |
| `ConfigModule` with Joi validation — missing required env vars crash at startup, not at the first request. | `src/app.module.ts` |
| `synchronize: false` in TypeORM — schema changes only through explicit migrations, not auto-sync. | `src/app.module.ts` |
| Environment-aware error responses: development shows detail for 500s; production returns generic message only (X3 Asgn3). | `src/common/filters/http-exception.filter.ts` |

---

## A06:2021 — Vulnerable and Outdated Components

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| `npm audit` at high severity as a CI audit step — build fails if a known high/critical vulnerability exists in dependencies (X1 Asgn3). | `scripts/audit-ci.sh` |
| Dependencies pinned with a lock file (`package-lock.json`). | Root directory |
| Content-Security-Policy header prevents loading scripts/styles from untrusted CDNs. | `src/main.ts` — helmet CSP directives |

---

## A07:2021 — Identification and Authentication Failures

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| Passwords hashed with argon2 — industry-standard memory-hard algorithm. | `src/auth/auth.service.ts` |
| Short-lived JWT access tokens (default 15 min) — reduces window if token is stolen. | `src/auth/auth.module.ts` |
| Refresh tokens rotated on every use, old token revoked — replay detected via family ID. | `src/auth/auth.service.ts` |
| Rate-limiting on login/register/refresh (10 req / 60 s per IP) — slows credential stuffing. | `src/auth/auth.controller.ts` |
| No user enumeration — login returns the same 401 for bad email or bad password. | `src/auth/auth.service.ts` — `login()` method |

---

## A08:2021 — Software and Data Integrity Failures

**Status: Partially mitigated / N/A for some sub-items**

| Control | File / Evidence |
|---------|----------------|
| JWT tokens are signed with HS256 using a server-side secret — tampered tokens are rejected by passport-jwt. | `src/auth/strategies/jwt.strategy.ts` |
| Refresh token hashed with SHA-256 before storage — a database leak does not yield usable tokens. | `src/auth/auth.service.ts` |
| **N/A — CI/CD pipeline integrity**: This is a development API with no deployed CI/CD pipeline yet. When one is added, signed commits and pipeline integrity checks should be configured. |

---

## A09:2021 — Security Logging and Monitoring Failures

**Status: Mitigated**

| Control | File / Evidence |
|---------|----------------|
| Centralized `RedactLogger` logs every request and error — sensitive keys (`password`, `token`, `authorization`, `secret`, `hash`, `cookie`) are automatically redacted. | `src/common/logger/redact.logger.ts` |
| `AllExceptionsFilter` logs every error server-side (both dev and prod), including the full stack trace for 500s. | `src/common/filters/http-exception.filter.ts` |
| No secret or stack trace ever reaches the client response. | `src/common/filters/http-exception.filter.ts` |

---

## A10:2021 — Server-Side Request Forgery (SSRF)

**Status: N/A**

This API does not make outbound HTTP requests based on user-supplied URLs.
There are no endpoints that fetch remote resources, proxy requests, or
accept a URL parameter that is used to contact another server. Therefore,
SSRF is not applicable to the current surface area.

If a feature like image-upload-by-URL or webhook delivery is added in the
future, an allowlist of permitted domains and a private-IP block should be
implemented.
