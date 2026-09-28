/**
 * C4: Test helper / factory functions for integration tests.
 *
 * Each helper is a single function call — tests never depend on leftover rows.
 * W2: truncateAll() resets data between tests (afterEach).
 */
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

// ─── Counter to ensure unique emails across tests ───────────────────
let counter = 0;

/** Reset counter — call in beforeAll or beforeEach if needed */
export function resetCounter(): void {
  counter = 0;
}

// ═══════════════════════════════════════════════════════════════════════
//  C4: Factory — createUser (register via HTTP)
// ═══════════════════════════════════════════════════════════════════════

export interface CreatedUser {
  id: number;
  name: string;
  email: string;
  password: string; // raw password (useful for login)
}

/**
 * Register a new user via POST /auth/register.
 * Returns the user data + the raw password for later login.
 */
export async function createUser(
  app: INestApplication,
  overrides: { name?: string; email?: string; password?: string } = {},
): Promise<CreatedUser> {
  counter++;
  const name = overrides.name || `TestUser${counter}`;
  const email = overrides.email || `testuser${counter}_${Date.now()}@test.com`;
  const password = overrides.password || 'Password123!';

  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ name, email, password })
    .expect(201);

  return {
    id: res.body.id,
    name: res.body.name,
    email: res.body.email,
    password,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  C4: Factory — loginAndGetToken
// ═══════════════════════════════════════════════════════════════════════

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

/**
 * Login via POST /auth/login and return { access_token, refresh_token }.
 */
export async function loginAndGetToken(
  app: INestApplication,
  email: string,
  password: string,
): Promise<AuthTokens> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);

  return {
    access_token: res.body.access_token,
    refresh_token: res.body.refresh_token,
  };
}

/**
 * Convenience: register + login in one call.
 * Returns user data + tokens.
 */
export async function createUserAndLogin(
  app: INestApplication,
  overrides: { name?: string; email?: string; password?: string } = {},
): Promise<CreatedUser & AuthTokens> {
  const user = await createUser(app, overrides);
  const tokens = await loginAndGetToken(app, user.email, user.password);
  return { ...user, ...tokens };
}

// ═══════════════════════════════════════════════════════════════════════
//  C4: Factory — createProject
// ═══════════════════════════════════════════════════════════════════════

export interface CreatedProject {
  id: number;
  name: string;
  owner_id: number;
}

/**
 * Create a project via POST /projects.
 * Requires a valid Bearer token (the user becomes the owner automatically).
 */
export async function createProject(
  app: INestApplication,
  token: string,
  overrides: { name?: string } = {},
): Promise<CreatedProject> {
  counter++;
  const name = overrides.name || `Test Project ${counter}`;

  const res = await request(app.getHttpServer())
    .post('/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name })
    .expect(201);

  return {
    id: res.body.id,
    name: res.body.name,
    owner_id: res.body.owner_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  C4: Factory — createTask
// ═══════════════════════════════════════════════════════════════════════

export interface CreatedTask {
  id: number;
  title: string;
  status: string;
  priority: number;
  project_id: number;
}

/**
 * Create a task via POST /tasks.
 * Requires a valid Bearer token and the user must be a project member.
 */
export async function createTask(
  app: INestApplication,
  token: string,
  projectId: number,
  overrides: {
    title?: string;
    description?: string;
    status?: string;
    priority?: number;
    assigneeId?: number;
  } = {},
): Promise<CreatedTask> {
  counter++;
  const title = overrides.title || `Test Task ${counter}`;

  const body: any = { title, projectId };
  if (overrides.description) body.description = overrides.description;
  if (overrides.status) body.status = overrides.status;
  if (overrides.priority) body.priority = overrides.priority;
  if (overrides.assigneeId) body.assigneeId = overrides.assigneeId;

  const res = await request(app.getHttpServer())
    .post('/tasks')
    .set('Authorization', `Bearer ${token}`)
    .send(body)
    .expect(201);

  return {
    id: res.body.id,
    title: res.body.title,
    status: res.body.status,
    priority: res.body.priority,
    project_id: res.body.project_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  C4: Factory — createComment
// ═══════════════════════════════════════════════════════════════════════

export interface CreatedComment {
  id: number;
  body: string;
  task_id: number;
  author_id: number;
}

/**
 * Create a comment via POST /tasks/:taskId/comments.
 */
export async function createComment(
  app: INestApplication,
  token: string,
  taskId: number,
  overrides: { body?: string } = {},
): Promise<CreatedComment> {
  counter++;
  const body = overrides.body || `Test comment ${counter}`;

  const res = await request(app.getHttpServer())
    .post(`/tasks/${taskId}/comments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ body })
    .expect(201);

  return {
    id: res.body.id,
    body: res.body.body,
    task_id: res.body.task_id,
    author_id: res.body.author_id,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  W2: Truncation helper — reset data between tests
// ═══════════════════════════════════════════════════════════════════════

/**
 * Truncate ALL tables and restart identity sequences.
 * Call in afterEach() to ensure test isolation (W2).
 */
export async function truncateAll(app: INestApplication): Promise<void> {
  const dataSource = app.get('DataSource') as any;
  // If the DataSource is not available via that token, try the connection
  // through the TypeORM module.
  if (dataSource && typeof dataSource.query === 'function') {
    await dataSource.query(`
      TRUNCATE TABLE
        comments, task_tags, tasks, project_members, projects,
        refresh_tokens, tags, users
      RESTART IDENTITY CASCADE
    `);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  Assertion helpers
// ═══════════════════════════════════════════════════════════════════════

/**
 * Assert the 5-field error shape from AllExceptionsFilter.
 */
export function assertErrorShape(
  body: any,
  expectedStatus: number,
): void {
  expect(body).toHaveProperty('statusCode', expectedStatus);
  expect(body).toHaveProperty('message');
  expect(body).toHaveProperty('error');
  expect(body).toHaveProperty('path');
  expect(body).toHaveProperty('timestamp');
  expect(typeof body.statusCode).toBe('number');
  expect(typeof body.error).toBe('string');
  expect(typeof body.path).toBe('string');
  expect(typeof body.timestamp).toBe('string');
}
