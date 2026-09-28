# C4: Proof That Tests Can Actually Fail

> Assignment 2 — Core 4: Break 3 behaviours by hand, confirm the test goes
> red, then undo. Document which 3 and what broke.

## Breakage 1 — Register returns password hash

**File changed:** `src/auth/auth.service.ts`  
**What was broken:** In the `register()` method, changed the return to include
the password hash field:

```diff
 return {
   id: saved.id,
   name: saved.name,
   email: saved.email,
   created_at: saved.created_at,
+  password_hash: saved.password_hash,
 };
```

**Which test went red:**  
`Step 1 — POST /auth/register → 201, body has id + name + email (W2: no password hash)`

The assertion `expect(res.body).not.toHaveProperty('password_hash')` fails
because the response now contains the hash.

**Fix:** Undo the change — remove `password_hash` from the return object.

---

## Breakage 2 — Token refresh returns the SAME access token

**File changed:** `src/auth/auth.service.ts`  
**What was broken:** In the `refresh()` method, returned the old access token
instead of signing a new one:

```diff
- const accessToken = this.signAccessToken(existing.user);
+ const accessToken = 'stale-static-token';
```

**Which test went red:**  
`Step 6 — C1: POST /auth/refresh → 200, new tokens issued, old refresh token revoked`

The assertion `expect(refreshRes.body.access_token).not.toBe(accessToken)`
still passes (different string), but the subsequent protected route call
`POST /tasks` with the new token fails with 401 because `'stale-static-token'`
is not a valid JWT.

**Fix:** Undo the change — restore `this.signAccessToken(existing.user)`.

---

## Breakage 3 — RolesGuard allows all roles (viewer can write)

**File changed:** `src/auth/guards/roles.guard.ts`  
**What was broken:** In the `canActivate()` method, commented out the role
check so every authenticated member passes:

```diff
- if (!requiredRoles.includes(role)) {
-   throw new ForbiddenException(
-     `Role '${role}' is not authorized for this action`,
-   );
- }
+ // Disabled role check — everyone passes
```

**Which test went red:**  
`Step 7 — C2: Viewer attempts POST /tasks → 403 Forbidden`

The test expects a 403 response but now receives 201 because the viewer is no
longer blocked. The assertion `.expect(403)` fails with status 201.

**Fix:** Undo the change — restore the role check.

---

## Summary

| # | Behaviour broken | Test that caught it | Expected | Got |
|---|------------------|---------------------|----------|-----|
| 1 | Password hash leaked in register response | Step 1 (W2) | No `password_hash` field | Field present |
| 2 | Refresh returns invalid token | Step 6 (C1) | Valid JWT for protected route | 401 Unauthorized |
| 3 | Viewer allowed to write | Step 7 (C2) | 403 Forbidden | 201 Created |

All three breakages were undone after confirming the test failure.
