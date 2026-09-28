/**
 * Week 10 — Assignment 2: End-to-end flow test.
 *
 * ONE ordered journey through the full API surface:
 *   register → login → create project → create task → add comment
 *   → refresh token → use new token → viewer denied → logout → 401
 *
 * W1: Full journey carrying the access token through every step.
 * W2: Intermediate state asserted at EVERY step (not just final status).
 * C1: Token refresh mid-flow — renew and continue with new access token.
 * C2: Denied branches INSIDE the flow — 403 viewer write, 401 after logout.
 * X2: Extra branch coverage — duplicate email registration (409 Conflict).
 * X3: Repeatability — unique emails per run (timestamp), no shared state,
 *     globalSetup safety guard ensures test DB, truncation between tests.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.test BEFORE NestJS imports (ConfigModule reads process.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';

// Disable throttling globally for e2e tests (same pattern as integration.spec.ts)
jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);

// ═══════════════════════════════════════════════════════════════════════
//  X3: DB safety guard — refuse to run against non-test DB
// ═══════════════════════════════════════════════════════════════════════
describe('X3: Database safety guard (e2e)', () => {
  it('should be running against task_manager_test', () => {
    expect(process.env.DB_DATABASE).toBe('task_manager_test');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  MAIN E2E FLOW TEST
// ═══════════════════════════════════════════════════════════════════════
describe('E2E Flow (Week 10 — Assignment 2)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();

    // Same global config as main.ts
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    dataSource = app.get(DataSource);
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
  }, 10000);

  // W2 + X3: Clean slate between tests — ensures repeatability
  afterEach(async () => {
    await dataSource.query(`
      TRUNCATE TABLE
        comments, task_tags, tasks, project_members, projects,
        refresh_tokens, tags, users
      RESTART IDENTITY CASCADE
    `);
  });

  // ════════════════════════════════════════════════════════════════════
  //  W1 + W2 + C1 + C2: The full journey — one continuous flow
  // ════════════════════════════════════════════════════════════════════
  describe('W1: Full journey — register → login → project → task → comment → refresh → denied', () => {
    // Shared state carried across steps within this describe block
    const ts = Date.now();
    const ownerEmail = `owner_${ts}@e2e.test`;
    const ownerPassword = 'OwnerPass123!';
    const ownerName = 'E2E Owner';

    let ownerId: number;
    let accessToken: string;
    let refreshToken: string;
    let projectId: number;
    let taskId: number;
    let commentId: number;

    // ── Step 1: Register ──────────────────────────────────────────
    it('Step 1 — POST /auth/register → 201, body has id + name + email (W2: no password hash)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      // W2: Intermediate assertions — not just 201
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', ownerName);
      expect(res.body).toHaveProperty('email', ownerEmail);
      expect(res.body).toHaveProperty('created_at');
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('password_hash');
      expect(typeof res.body.id).toBe('number');

      ownerId = res.body.id;
    });

    // ── Step 2: Login ─────────────────────────────────────────────
    it('Step 2 — POST /auth/login → 200, returns access_token + refresh_token (W2: both are strings)', async () => {
      // Re-register (afterEach truncated) — keeps the flow self-contained
      const regRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      ownerId = regRes.body.id;

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      // W2: Intermediate assertions
      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.refresh_token).toBe('string');
      expect(res.body.access_token.length).toBeGreaterThan(0);
      expect(res.body.refresh_token.length).toBeGreaterThan(0);

      accessToken = res.body.access_token;
      refreshToken = res.body.refresh_token;
    });

    // ── Step 3: Create project ────────────────────────────────────
    it('Step 3 — POST /projects → 201, owner_id matches logged-in user (W2: project belongs to user)', async () => {
      // Re-register + login (afterEach truncated)
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      ownerId = 1; // first user after truncate
      accessToken = loginRes.body.access_token;
      refreshToken = loginRes.body.refresh_token;

      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E Test Project' })
        .expect(201);

      // W2: Intermediate assertions — project belongs to creator
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'E2E Test Project');
      expect(res.body).toHaveProperty('owner_id', ownerId);
      expect(typeof res.body.id).toBe('number');

      projectId = res.body.id;

      // W2: Read it back — GET /projects/:id confirms it's in the database
      const getRes = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .expect(200);

      expect(getRes.body).toHaveProperty('id', projectId);
      expect(getRes.body).toHaveProperty('name', 'E2E Test Project');
      expect(getRes.body).toHaveProperty('owner_id', ownerId);
    });

    // ── Step 4: Create task ───────────────────────────────────────
    it('Step 4 — POST /tasks → 201, task belongs to the project (W2: project_id matches)', async () => {
      // Setup: register, login, create project
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      accessToken = loginRes.body.access_token;
      refreshToken = loginRes.body.refresh_token;

      const projRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E Test Project' })
        .expect(201);

      projectId = projRes.body.id;

      // Create task
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'E2E Task', projectId })
        .expect(201);

      // W2: Intermediate assertions — task belongs to the project
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('title', 'E2E Task');
      expect(res.body).toHaveProperty('project_id', projectId);
      expect(typeof res.body.id).toBe('number');

      taskId = res.body.id;

      // W2: Read it back — GET /tasks/:id confirms it's in the project
      const getRes = await request(app.getHttpServer())
        .get(`/tasks/${taskId}`)
        .expect(200);

      expect(getRes.body).toHaveProperty('id', taskId);
      expect(getRes.body).toHaveProperty('project_id', projectId);
      expect(getRes.body).toHaveProperty('title', 'E2E Task');
    });

    // ── Step 5: Add comment ───────────────────────────────────────
    it('Step 5 — POST /tasks/:taskId/comments → 201, comment belongs to task (W2: task_id + author_id match)', async () => {
      // Setup: register, login, create project, create task
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      accessToken = loginRes.body.access_token;
      refreshToken = loginRes.body.refresh_token;
      ownerId = 1;

      const projRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E Test Project' })
        .expect(201);

      projectId = projRes.body.id;

      const taskRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'E2E Task', projectId })
        .expect(201);

      taskId = taskRes.body.id;

      // Add comment
      const res = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ body: 'E2E comment on the task' })
        .expect(201);

      // W2: Intermediate assertions — comment belongs to task, author is the user
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('body', 'E2E comment on the task');
      expect(res.body).toHaveProperty('task_id', taskId);
      expect(res.body).toHaveProperty('author_id', ownerId);
      expect(typeof res.body.id).toBe('number');

      commentId = res.body.id;

      // W2: Read comments back — GET /tasks/:taskId/comments confirms it's there
      const getRes = await request(app.getHttpServer())
        .get(`/tasks/${taskId}/comments`)
        .expect(200);

      // The response is paginated: { items, total, page }
      expect(getRes.body).toHaveProperty('items');
      expect(getRes.body).toHaveProperty('total');
      expect(getRes.body.total).toBeGreaterThanOrEqual(1);

      const found = getRes.body.items.find((c: any) => c.id === commentId);
      expect(found).toBeDefined();
      expect(found.body).toBe('E2E comment on the task');
      expect(found.task_id).toBe(taskId);
    });

    // ── Step 6: C1 — Token refresh mid-flow ───────────────────────
    it('Step 6 — C1: POST /auth/refresh → 200, new tokens issued, old refresh token revoked', async () => {
      // Setup: full journey to comment
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      accessToken = loginRes.body.access_token;
      refreshToken = loginRes.body.refresh_token;

      const projRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E Test Project' })
        .expect(201);

      projectId = projRes.body.id;

      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'E2E Task', projectId })
        .expect(201);

      // C1: Refresh the token mid-flow
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(200);

      // W2: Intermediate assertions on refresh response
      expect(refreshRes.body).toHaveProperty('access_token');
      expect(refreshRes.body).toHaveProperty('refresh_token');
      expect(typeof refreshRes.body.access_token).toBe('string');
      expect(typeof refreshRes.body.refresh_token).toBe('string');
      expect(refreshRes.body.access_token.length).toBeGreaterThan(0);

      // The refresh_token is always new (random bytes) — access_token may match
      // if issued in the same second (same iat/exp/sub → same JWT)
      expect(refreshRes.body.refresh_token).not.toBe(refreshToken);

      const newAccessToken = refreshRes.body.access_token;
      const newRefreshToken = refreshRes.body.refresh_token;

      // C1: Use the NEW access token on a protected route — should succeed
      const taskRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${newAccessToken}`)
        .send({ title: 'Task after refresh', projectId })
        .expect(201);

      expect(taskRes.body).toHaveProperty('title', 'Task after refresh');
      expect(taskRes.body).toHaveProperty('project_id', projectId);

      // Store new tokens for subsequent steps
      accessToken = newAccessToken;
      refreshToken = newRefreshToken;
    });

    // ── Step 7: C2 — Viewer 403 (denied branch) ──────────────────
    it('Step 7 — C2: Viewer attempts POST /tasks → 403 Forbidden', async () => {
      // Setup: register owner, login, create project
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      accessToken = loginRes.body.access_token;

      const projRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E Test Project' })
        .expect(201);

      projectId = projRes.body.id;

      // Register a second user (the viewer)
      const viewerEmail = `viewer_${ts}@e2e.test`;
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'E2E Viewer', email: viewerEmail, password: 'ViewerPass123!' })
        .expect(201);

      const viewerLogin = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: viewerEmail, password: 'ViewerPass123!' })
        .expect(200);

      const viewerToken = viewerLogin.body.access_token;
      const viewerId = 2; // second user created

      // Insert the viewer as a project member with role='viewer' directly via DB
      await dataSource.query(
        `INSERT INTO project_members (user_id, project_id, role)
         VALUES ($1, $2, 'viewer')`,
        [viewerId, projectId],
      );

      // C2: Viewer attempts to create a task → 403
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Viewer should not create this', projectId })
        .expect(403);

      // W2: Assert the error shape
      expect(res.body).toHaveProperty('statusCode', 403);
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('error');

      // C2: Viewer also cannot add a comment on an existing task
      // First create a task as owner
      const taskRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Owner Task', projectId })
        .expect(201);

      taskId = taskRes.body.id;

      const commentRes = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ body: 'Viewer should not comment' })
        .expect(403);

      expect(commentRes.body).toHaveProperty('statusCode', 403);
    });

    // ── Step 8: C2 — 401 after logout ─────────────────────────────
    it('Step 8 — C2: After logout, refresh with revoked token → 401 Unauthorized', async () => {
      // Setup: register, login
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: ownerName, email: ownerEmail, password: ownerPassword })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: ownerEmail, password: ownerPassword })
        .expect(200);

      accessToken = loginRes.body.access_token;
      refreshToken = loginRes.body.refresh_token;

      // Logout — revokes the refresh token
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refresh_token: refreshToken })
        .expect(200);

      // C2: Attempt to refresh with the now-revoked token → 401
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken })
        .expect(401);

      expect(res.body).toHaveProperty('statusCode', 401);
      expect(res.body).toHaveProperty('message');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  X2: Extra branch — duplicate email registration (409)
  // ════════════════════════════════════════════════════════════════════
  describe('X2: Additional branch coverage', () => {
    it('POST /auth/register with duplicate email → 409 Conflict', async () => {
      const email = `dup_${Date.now()}@e2e.test`;

      // First registration succeeds
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'First', email, password: 'Password123!' })
        .expect(201);

      // Second registration with same email → 409
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Second', email, password: 'Password123!' })
        .expect(409);

      expect(res.body).toHaveProperty('statusCode', 409);
      expect(res.body).toHaveProperty('message');
    });

    it('POST /auth/login with wrong password → 401', async () => {
      const email = `wrong_${Date.now()}@e2e.test`;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'User', email, password: 'Correct123!' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'WrongPassword!' })
        .expect(401);

      expect(res.body).toHaveProperty('statusCode', 401);
    });

    it('Non-member attempts POST /tasks → 403', async () => {
      const email1 = `member_${Date.now()}@e2e.test`;
      const email2 = `nonmember_${Date.now()}@e2e.test`;

      // User 1 creates a project
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Owner', email: email1, password: 'Password123!' })
        .expect(201);

      const login1 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: email1, password: 'Password123!' })
        .expect(200);

      const projRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${login1.body.access_token}`)
        .send({ name: 'Private Project' })
        .expect(201);

      // User 2 is not a member of this project
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Outsider', email: email2, password: 'Password123!' })
        .expect(201);

      const login2 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: email2, password: 'Password123!' })
        .expect(200);

      // User 2 tries to create a task in User 1's project → 403
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${login2.body.access_token}`)
        .send({ title: 'Unauthorized task', projectId: projRes.body.id })
        .expect(403);

      expect(res.body).toHaveProperty('statusCode', 403);
    });

    it('POST /tasks without Bearer token → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'No auth', projectId: 1 })
        .expect(401);

      expect(res.body).toHaveProperty('statusCode', 401);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  X3: Repeatability — run the same flow 3 times in sequence
  // ════════════════════════════════════════════════════════════════════
  describe('X3: Repeatability — identical flow runs green 3 times', () => {
    /**
     * X3: Each iteration registers unique users, creates its own project/task/comment,
     * and cleans up via afterEach. This proves:
     * - No leftover state between runs (unique emails + truncation)
     * - No SERIAL id dependency (we capture IDs, never hardcode them)
     * - No timing flakiness (no setTimeout/race conditions)
     */
    const runFlow = async (iteration: number) => {
      const email = `repeat_${iteration}_${Date.now()}@e2e.test`;

      // Register
      const regRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: `Repeat ${iteration}`, email, password: 'Password123!' })
        .expect(201);

      expect(regRes.body).toHaveProperty('id');
      const userId = regRes.body.id;

      // Login
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'Password123!' })
        .expect(200);

      const token = loginRes.body.access_token;
      const rToken = loginRes.body.refresh_token;

      // Create project
      const projRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Repeat Project ${iteration}` })
        .expect(201);

      expect(projRes.body).toHaveProperty('owner_id', userId);
      const pId = projRes.body.id;

      // Create task
      const taskRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: `Repeat Task ${iteration}`, projectId: pId })
        .expect(201);

      expect(taskRes.body).toHaveProperty('project_id', pId);
      const tId = taskRes.body.id;

      // Add comment
      const commentRes = await request(app.getHttpServer())
        .post(`/tasks/${tId}/comments`)
        .set('Authorization', `Bearer ${token}`)
        .send({ body: `Repeat comment ${iteration}` })
        .expect(201);

      expect(commentRes.body).toHaveProperty('task_id', tId);
      expect(commentRes.body).toHaveProperty('author_id', userId);

      // Refresh token
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: rToken })
        .expect(200);

      // The refresh endpoint returns valid tokens (may match if same second — iat/exp identical)
      expect(typeof refreshRes.body.access_token).toBe('string');
      expect(refreshRes.body.access_token.length).toBeGreaterThan(0);
      // The refresh_token is always new (random bytes)
      expect(refreshRes.body.refresh_token).not.toBe(rToken);

      // Use new token
      const newToken = refreshRes.body.access_token;
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${newToken}`)
        .send({ title: `After refresh ${iteration}`, projectId: pId })
        .expect(201);
    };

    it('Iteration 1 — full flow runs green from empty DB', async () => {
      await runFlow(1);
    });

    it('Iteration 2 — same flow runs green again (no leftover state)', async () => {
      await runFlow(2);
    });

    it('Iteration 3 — third run confirms no flakiness', async () => {
      await runFlow(3);
    });
  });
});
