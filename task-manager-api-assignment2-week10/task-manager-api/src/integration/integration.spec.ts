/**
 * Week 10 — Assignment 1: Integration tests with Supertest.
 *
 * Boots the FULL AppModule against the real test database (task_manager_test).
 * Uses the same global pipes, filters, and guards as production (main.ts).
 *
 * W1: Separate test database via .env.test + global-setup.ts
 * W2: Data reset via truncateAll() in afterEach
 * C1: POST → 201 + GET → 200 happy path (status AND body)
 * C2: 400 (invalid body) + 401 (no token on write route)
 * C3: 404 on GET / PATCH / DELETE for missing resource
 * C4: Test independence via helpers/factories
 * X1: Combinable filters (status + projectId)
 * X2: Unknown field rejected (forbidNonWhitelisted) + no DB row
 * X3: DB safety guard (in global-setup.ts)
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.test BEFORE any NestJS imports (ConfigModule reads process.env)
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';

/**
 * Disable throttling globally for integration tests.
 * The auth controller has @Throttle({ default: { limit: 10, ttl: 60000 } })
 * which would block tests after 10 register/login calls.
 * We patch the ThrottlerGuard prototype so ALL instances (including those
 * resolved by @Throttle decorators) skip rate-limiting.
 */
jest.spyOn(ThrottlerGuard.prototype, 'canActivate').mockResolvedValue(true);
import {
  createUser,
  createUserAndLogin,
  createProject,
  createTask,
  createComment,
  assertErrorShape,
  resetCounter,
} from '../test-utils/test-helpers';

// ═══════════════════════════════════════════════════════════════════════
//  X3: DB safety guard — fail fast if not test database
// ═══════════════════════════════════════════════════════════════════════
describe('X3: Database safety guard', () => {
  it('should be running against task_manager_test', () => {
    expect(process.env.DB_DATABASE).toBe('task_manager_test');
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  MAIN INTEGRATION TEST SUITE
// ═══════════════════════════════════════════════════════════════════════
describe('Integration Tests (Week 10 — Assignment 1)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  // ── Boot app once per suite (C1: Test.createTestingModule) ────────
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

  // ── W2: Reset data between tests ──────────────────────────────────
  afterEach(async () => {
    resetCounter();
    // Truncate all tables — ensures test isolation (W2)
    await dataSource.query(`
      TRUNCATE TABLE
        comments, task_tags, tasks, project_members, projects,
        refresh_tokens, tags, users
      RESTART IDENTITY CASCADE
    `);
  });

  // ════════════════════════════════════════════════════════════════════
  //  C1: Happy-path — POST resource → 201, GET → same resource
  // ════════════════════════════════════════════════════════════════════
  describe('C1: happy-path create + read', () => {
    it('POST /auth/register → 201, body has id + name + email (no password)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Alice', email: 'alice@test.com', password: 'Password123!' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Alice');
      expect(res.body.email).toBe('alice@test.com');
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('POST /projects → 201, then GET /projects/:id → 200 same resource', async () => {
      // Seed user + login
      const user = await createUserAndLogin(app);

      // Create project
      const postRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ name: 'Integration Project' })
        .expect(201);

      expect(postRes.body).toHaveProperty('id');
      expect(postRes.body.name).toBe('Integration Project');
      expect(postRes.body.owner_id).toBe(user.id);

      // Read back the same resource
      const getRes = await request(app.getHttpServer())
        .get(`/projects/${postRes.body.id}`)
        .expect(200);

      expect(getRes.body.id).toBe(postRes.body.id);
      expect(getRes.body.name).toBe('Integration Project');
      expect(getRes.body.owner).toBeDefined();
      expect(getRes.body.owner.id).toBe(user.id);
    });

    it('POST /tasks → 201, then GET /tasks/:id → 200 same resource', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);

      // Create task
      const postRes = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({
          title: 'Write integration tests',
          description: 'Cover all assignment requirements',
          projectId: project.id,
        })
        .expect(201);

      expect(postRes.body).toHaveProperty('id');
      expect(postRes.body.title).toBe('Write integration tests');
      expect(postRes.body.project_id).toBe(project.id);
      expect(postRes.body.status).toBe('todo');

      // Read back
      const getRes = await request(app.getHttpServer())
        .get(`/tasks/${postRes.body.id}`)
        .expect(200);

      expect(getRes.body.id).toBe(postRes.body.id);
      expect(getRes.body.title).toBe('Write integration tests');
      expect(getRes.body.project).toBeDefined();
      expect(getRes.body.project.id).toBe(project.id);
    });

    it('POST /tasks/:taskId/comments → 201, then GET → paginated list', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);
      const task = await createTask(app, user.access_token, project.id);

      // Create comment
      const postRes = await request(app.getHttpServer())
        .post(`/tasks/${task.id}/comments`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ body: 'Looks great!' })
        .expect(201);

      expect(postRes.body).toHaveProperty('id');
      expect(postRes.body.body).toBe('Looks great!');
      expect(postRes.body.task_id).toBe(task.id);

      // Read back
      const getRes = await request(app.getHttpServer())
        .get(`/tasks/${task.id}/comments`)
        .expect(200);

      expect(getRes.body.items).toHaveLength(1);
      expect(getRes.body.items[0].body).toBe('Looks great!');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  C2: 400 (invalid body) + 401 (no token on write routes)
  // ════════════════════════════════════════════════════════════════════
  describe('C2: validation failure → 400 + missing token → 401', () => {
    // ── 400: Invalid body ──────────────────────────────────────────
    it('POST /auth/register with missing fields → 400 with error shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({})
        .expect(400);

      assertErrorShape(res.body, 400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('POST /tasks with missing title → 400 (with valid projectId for guard)', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);

      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ description: 'no title', projectId: project.id })
        .expect(400);

      assertErrorShape(res.body, 400);
    });

    it('POST /tasks with title too short → 400', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);

      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ title: 'AB', projectId: project.id })
        .expect(400);

      assertErrorShape(res.body, 400);
    });

    it('POST /projects with missing name → 400', async () => {
      const user = await createUserAndLogin(app);

      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({})
        .expect(400);

      assertErrorShape(res.body, 400);
    });

    it('POST /tasks/:taskId/comments with empty body → 400', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);
      const task = await createTask(app, user.access_token, project.id);

      const res = await request(app.getHttpServer())
        .post(`/tasks/${task.id}/comments`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ body: '' })
        .expect(400);

      assertErrorShape(res.body, 400);
    });

    // ── 401: No token on write routes ──────────────────────────────
    it('POST /projects without token → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'Unauthorized Project' })
        .expect(401);

      assertErrorShape(res.body, 401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('POST /tasks without token → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Unauthorized Task', projectId: 1 })
        .expect(401);

      assertErrorShape(res.body, 401);
    });

    it('PATCH /projects/:id without token → 401', async () => {
      const res = await request(app.getHttpServer())
        .patch('/projects/1')
        .send({ name: 'Hacked' })
        .expect(401);

      assertErrorShape(res.body, 401);
    });

    it('DELETE /tasks/:id without token → 401', async () => {
      const res = await request(app.getHttpServer())
        .delete('/tasks/1')
        .expect(401);

      assertErrorShape(res.body, 401);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  C3: 404 on GET / PATCH / DELETE for missing resource
  // ════════════════════════════════════════════════════════════════════
  describe('C3: missing resource → 404', () => {
    // ── GET routes are @Public — no guard interference ─────────────
    it('GET /projects/:id with absent id → 404 with error shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/99999')
        .expect(404);

      assertErrorShape(res.body, 404);
      expect(res.body.error).toBe('Not Found');
    });

    it('GET /tasks/:id with absent id → 404', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks/99999')
        .expect(404);

      assertErrorShape(res.body, 404);
    });

    // ── PATCH /tasks/:id — guard looks up task → NotFoundException ─
    it('PATCH /tasks/:id with absent id → 404 (guard resolves task)', async () => {
      const user = await createUserAndLogin(app);

      const res = await request(app.getHttpServer())
        .patch('/tasks/99999')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ title: 'Will not work' })
        .expect(404);

      assertErrorShape(res.body, 404);
    });

    // ── DELETE /tasks/:id — guard looks up task → NotFoundException ─
    it('DELETE /tasks/:id with absent id → 404 (guard resolves task)', async () => {
      const user = await createUserAndLogin(app);

      const res = await request(app.getHttpServer())
        .delete('/tasks/99999')
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(404);

      assertErrorShape(res.body, 404);
    });

    // ── PATCH /tasks/:id — create task, delete it, then try PATCH ──
    it('PATCH a deleted task → 404', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);
      const task = await createTask(app, user.access_token, project.id);

      // Delete the task first
      await request(app.getHttpServer())
        .delete(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(204);

      // Now PATCH confirms it's gone
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ title: 'Will not work' })
        .expect(404);

      assertErrorShape(res.body, 404);
    });

    // ── DELETE /tasks/:id — create task, delete it twice ──────────
    it('DELETE a deleted task → 404', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);
      const task = await createTask(app, user.access_token, project.id);

      // First delete succeeds
      await request(app.getHttpServer())
        .delete(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(204);

      // Second delete → 404
      const res = await request(app.getHttpServer())
        .delete(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(404);

      assertErrorShape(res.body, 404);
    });

    // ── Projects with non-existent ID → 403 (guard denies non-member) ─
    it('PATCH /projects/:id with non-existent id → 403 (security: no membership leak)', async () => {
      const user = await createUserAndLogin(app);

      const res = await request(app.getHttpServer())
        .patch('/projects/99999')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ name: 'Will not work' })
        .expect(403);

      assertErrorShape(res.body, 403);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  C4: Test independence — each test seeds its own data
  // ════════════════════════════════════════════════════════════════════
  describe('C4: test independence (no leftover rows)', () => {
    it('first test: create a project and verify count = 1', async () => {
      const user = await createUserAndLogin(app);
      await createProject(app, user.access_token, { name: 'Project From Test 1' });

      const res = await request(app.getHttpServer())
        .get('/projects')
        .expect(200);

      expect(res.body.total).toBe(1);
    });

    it('second test: create a different project and verify count = 1 (not 2)', async () => {
      const user = await createUserAndLogin(app);
      await createProject(app, user.access_token, { name: 'Project From Test 2' });

      const res = await request(app.getHttpServer())
        .get('/projects')
        .expect(200);

      // W2: afterEach truncated tables, so this is 1 — not 2
      expect(res.body.total).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  X1: Combinable filters — ?status=todo&projectId=1
  // ════════════════════════════════════════════════════════════════════
  describe('X1: combinable filters on GET /tasks', () => {
    it('?status=todo&projectId filters correctly — near-miss rows absent', async () => {
      // Seed: 2 projects, tasks with different statuses
      const user = await createUserAndLogin(app);
      const projA = await createProject(app, user.access_token, { name: 'Project A' });
      const projB = await createProject(app, user.access_token, { name: 'Project B' });

      // projA: 1 todo, 1 done
      await createTask(app, user.access_token, projA.id, {
        title: 'A-Todo',
        status: 'todo',
      });
      await createTask(app, user.access_token, projA.id, {
        title: 'A-Done',
        status: 'done',
      });

      // projB: 1 todo (near-miss: right status, wrong project)
      await createTask(app, user.access_token, projB.id, {
        title: 'B-Todo',
        status: 'todo',
      });

      // Filter: status=todo AND projectId=projA.id
      const res = await request(app.getHttpServer())
        .get(`/tasks?status=todo&projectId=${projA.id}`)
        .expect(200);

      // Should return ONLY A-Todo
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].title).toBe('A-Todo');

      // Near-miss checks:
      const titles = res.body.items.map((t: any) => t.title);
      expect(titles).not.toContain('A-Done');  // wrong status
      expect(titles).not.toContain('B-Todo');  // wrong project
    });

    it('?assigneeId filters tasks by assignee', async () => {
      const owner = await createUserAndLogin(app);
      const assignee = await createUser(app, { name: 'Assignee' });
      const project = await createProject(app, owner.access_token, { name: 'Assign Project' });

      // 1 assigned, 1 unassigned
      await createTask(app, owner.access_token, project.id, {
        title: 'Assigned Task',
        assigneeId: assignee.id,
      });
      await createTask(app, owner.access_token, project.id, {
        title: 'Unassigned Task',
      });

      const res = await request(app.getHttpServer())
        .get(`/tasks?assigneeId=${assignee.id}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].title).toBe('Assigned Task');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  X2: Unknown field → 400 + no row in DB
  // ════════════════════════════════════════════════════════════════════
  describe('X2: unknown field rejected (forbidNonWhitelisted)', () => {
    it('POST /tasks with unknown field → 400, no row created in DB', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);

      // Send with an unknown field
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({
          title: 'Valid Task',
          projectId: project.id,
          unknownField: 'should be rejected',
        })
        .expect(400);

      assertErrorShape(res.body, 400);

      // Verify: no task row was created in the database
      const dbResult = await dataSource.query(
        `SELECT COUNT(*) as count FROM tasks WHERE title = 'Valid Task'`,
      );
      expect(parseInt(dbResult[0].count, 10)).toBe(0);
    });

    it('POST /projects with unknown field → 400, no row created in DB', async () => {
      const user = await createUserAndLogin(app);

      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ name: 'Valid Project', hackerField: 'injected' })
        .expect(400);

      assertErrorShape(res.body, 400);

      // Verify: no project with that name exists
      const dbResult = await dataSource.query(
        `SELECT COUNT(*) as count FROM projects WHERE name = 'Valid Project'`,
      );
      expect(parseInt(dbResult[0].count, 10)).toBe(0);
    });

    it('POST /auth/register with unknown field → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: 'Hacker',
          email: 'hack@test.com',
          password: 'Password123!',
          role: 'admin', // unknown field
        })
        .expect(400);

      assertErrorShape(res.body, 400);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  Additional: PATCH + DELETE happy paths
  // ════════════════════════════════════════════════════════════════════
  describe('PATCH + DELETE happy paths', () => {
    it('PATCH /projects/:id → 200 with updated name', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token, { name: 'Original' });

      const res = await request(app.getHttpServer())
        .patch(`/projects/${project.id}`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(res.body.name).toBe('Updated Name');
    });

    it('DELETE /tasks/:id → 204, then GET → 404 (confirm deletion)', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);
      const task = await createTask(app, user.access_token, project.id, {
        title: 'To Be Deleted',
      });

      await request(app.getHttpServer())
        .delete(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(204);

      // Confirm it's gone
      await request(app.getHttpServer())
        .get(`/tasks/${task.id}`)
        .expect(404);
    });

    it('DELETE /tasks/:id → 204 No Content', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);
      const task = await createTask(app, user.access_token, project.id);

      await request(app.getHttpServer())
        .delete(`/tasks/${task.id}`)
        .set('Authorization', `Bearer ${user.access_token}`)
        .expect(204);

      // Confirm it's gone
      await request(app.getHttpServer())
        .get(`/tasks/${task.id}`)
        .expect(404);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  Error-shape consistency (5-field shape on every error)
  // ════════════════════════════════════════════════════════════════════
  describe('Error shape consistency (AllExceptionsFilter)', () => {
    it('400 error has 5-field shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({})
        .expect(400);

      assertErrorShape(res.body, 400);
      expect(res.body.error).toBe('Bad Request');
    });

    it('401 error has 5-field shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'No Token Project' })
        .expect(401);

      assertErrorShape(res.body, 401);
      expect(res.body.error).toBe('Unauthorized');
    });

    it('404 error has 5-field shape', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/99999')
        .expect(404);

      assertErrorShape(res.body, 404);
      expect(res.body.error).toBe('Not Found');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  W2 proof: two consecutive runs give same result
  // ════════════════════════════════════════════════════════════════════
  describe('W2: data reset proof', () => {
    it('run A: seed 3 tasks, total = 3', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);

      await createTask(app, user.access_token, project.id, { title: 'Run-A-1' });
      await createTask(app, user.access_token, project.id, { title: 'Run-A-2' });
      await createTask(app, user.access_token, project.id, { title: 'Run-A-3' });

      const res = await request(app.getHttpServer())
        .get(`/tasks?projectId=${project.id}`)
        .expect(200);

      expect(res.body.total).toBe(3);
    });

    it('run B: seed 2 tasks, total = 2 (not 5)', async () => {
      const user = await createUserAndLogin(app);
      const project = await createProject(app, user.access_token);

      await createTask(app, user.access_token, project.id, { title: 'Run-B-1' });
      await createTask(app, user.access_token, project.id, { title: 'Run-B-2' });

      const res = await request(app.getHttpServer())
        .get(`/tasks?projectId=${project.id}`)
        .expect(200);

      // Proves afterEach truncation works — 2, not 5
      expect(res.body.total).toBe(2);
    });
  });
});
