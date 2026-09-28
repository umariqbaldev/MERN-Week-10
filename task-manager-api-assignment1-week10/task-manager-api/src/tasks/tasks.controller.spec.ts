import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';
import { TaskStatus } from '../entities/task.entity';

/**
 * C6: Integration test — drives the HTTP layer with supertest.
 *     Happy-path create+read (201), validation failure (400).
 * X3: Error-path tests — unknown id→404, unknown field→400, delete→204.
 *
 * Assignment 2: A middleware injects a mock user so @CurrentUser() resolves.
 */
describe('TasksController (integration)', () => {
  let app: INestApplication;

  // Mock authenticated user
  const mockUser = { userId: 1, email: 'test@test.com' };

  // ── Mock TasksService — no database needed ─────────────────────────
  const mockTasksService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: mockTasksService },
      ],
    }).compile();

    app = module.createNestApplication();

    // Inject mock user so @CurrentUser() works in tests
    app.use((req: any, _res: any, next: any) => {
      req.user = mockUser;
      next();
    });

    // X2: Same global filter as main.ts
    app.useGlobalFilters(new AllExceptionsFilter());

    // Same global pipe as main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  // ══════════════════════════════════════════════════════════════════
  //  C6: Happy-path — POST /tasks → 201, then GET /tasks/:id → 200
  // ══════════════════════════════════════════════════════════════════
  describe('C6: happy-path create + read', () => {
    const fakeTask = {
      id: 1,
      title: 'Implement login page',
      description: 'Build the login UI',
      status: TaskStatus.TODO,
      priority: 3,
      project_id: 1,
      assignee_id: 2,
      creator_id: 1,
      created_at: '2026-01-15T00:00:00.000Z',
      project: { id: 1, name: 'Project A' },
      assignee: { id: 2, name: 'Alice' },
      tags: [],
    };

    it('POST /tasks → 201 with valid body (W2: creator from @CurrentUser)', async () => {
      mockTasksService.create.mockResolvedValue(fakeTask);

      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({
          title: 'Implement login page',
          description: 'Build the login UI',
          projectId: 1,
          assigneeId: 2,
        })
        .expect(201);

      expect(res.body).toEqual(fakeTask);
      expect(mockTasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Implement login page',
          projectId: 1,
        }),
        mockUser.userId, // W2: userId from @CurrentUser
      );
    });

    it('GET /tasks/:id → 200 with relations', async () => {
      mockTasksService.findOne.mockResolvedValue(fakeTask);

      const res = await request(app.getHttpServer())
        .get('/tasks/1')
        .expect(200);

      expect(res.body).toEqual(fakeTask);
      expect(res.body.project).toBeDefined();
      expect(res.body.assignee).toBeDefined();
      expect(res.body.tags).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  C6: Validation failure — 400
  // ══════════════════════════════════════════════════════════════════
  describe('C6: validation failure → 400', () => {
    it('POST /tasks with missing required field → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({ description: 'no title, no projectId' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it('POST /tasks with title too short → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'AB', projectId: 1 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('POST /tasks with invalid status enum → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Valid Title', projectId: 1, status: 'invalid_status' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('POST /tasks with priority out of range → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'Valid Title', projectId: 1, priority: 10 })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  X3: Error-path tests
  // ══════════════════════════════════════════════════════════════════
  describe('X3: error-path tests', () => {
    it('GET /tasks/:id with unknown id → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockTasksService.findOne.mockRejectedValue(
        new NotFoundException('Task with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .get('/tasks/999')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('PATCH /tasks/:id with unknown id → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockTasksService.update.mockRejectedValue(
        new NotFoundException('Task with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .patch('/tasks/999')
        .send({ title: 'Will not work' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
    });

    it('POST /tasks with unknown field → 400 (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({
          title: 'Valid Task',
          projectId: 1,
          unknownField: 'should be rejected',
        })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it('DELETE /tasks/:id → 204 No Content', async () => {
      mockTasksService.remove.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .delete('/tasks/1')
        .expect(204);

      expect(mockTasksService.remove).toHaveBeenCalledWith(1);
    });

    it('DELETE /tasks/:id with unknown id → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockTasksService.remove.mockRejectedValue(
        new NotFoundException('Task with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .delete('/tasks/999')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
    });

    it('GET /tasks/:id with non-numeric id → 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/tasks/abc')
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  X2: Exception filter — uniform error shape
  // ══════════════════════════════════════════════════════════════════
  describe('X2: exception filter error shape', () => {
    it('error response has { statusCode, message, error, path, timestamp } (5-field shape)', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .send({})
        .expect(400);

      expect(res.body).toHaveProperty('statusCode');
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('path');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body.error).toBe('Bad Request');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  GET /tasks with filters + pagination
  // ══════════════════════════════════════════════════════════════════
  describe('GET /tasks (list with filters)', () => {
    it('returns paginated results', async () => {
      mockTasksService.findAll.mockResolvedValue({
        items: [{ id: 1, title: 'Task A' }],
        total: 1,
        page: 1,
      });

      const res = await request(app.getHttpServer())
        .get('/tasks?status=todo&page=1&pageSize=10')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
    });
  });
});
