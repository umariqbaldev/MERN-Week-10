import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';

/**
 * C6 + X3: Integration tests for CommentsController.
 * Nested under /tasks/:taskId/comments — drives with supertest.
 *
 * Assignment 2: A middleware injects a mock user so @CurrentUser() resolves.
 */
describe('CommentsController (integration)', () => {
  let app: INestApplication;

  // Mock authenticated user
  const mockUser = { userId: 1, email: 'test@test.com' };

  // ── Mock CommentsService ──────────────────────────────────────────
  const mockCommentsService = {
    create: jest.fn(),
    findByTask: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentsController],
      providers: [
        { provide: CommentsService, useValue: mockCommentsService },
      ],
    }).compile();

    app = module.createNestApplication();

    // Inject mock user so @CurrentUser() works in tests
    app.use((req: any, _res: any, next: any) => {
      req.user = mockUser;
      next();
    });

    app.useGlobalFilters(new AllExceptionsFilter());
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
  //  Happy-path: POST → 201, GET paginated
  // ══════════════════════════════════════════════════════════════════
  describe('happy-path CRUD', () => {
    const fakeComment = {
      id: 1,
      task_id: 1,
      author_id: 1,
      body: 'Looks good!',
      created_at: '2026-01-15T00:00:00.000Z',
      author: { id: 1, name: 'TestUser' },
    };

    it('POST /tasks/:taskId/comments → 201 (W2: author from @CurrentUser)', async () => {
      mockCommentsService.create.mockResolvedValue(fakeComment);

      const res = await request(app.getHttpServer())
        .post('/tasks/1/comments')
        .send({ body: 'Looks good!' }) // authorId no longer required
        .expect(201);

      expect(res.body).toEqual(fakeComment);
      expect(mockCommentsService.create).toHaveBeenCalledWith(
        1, // taskId parsed from URL
        expect.objectContaining({ body: 'Looks good!' }),
        mockUser.userId, // W2: userId from @CurrentUser
      );
    });

    it('GET /tasks/:taskId/comments → 200 with paginated list', async () => {
      mockCommentsService.findByTask.mockResolvedValue({
        items: [fakeComment],
        total: 1,
        page: 1,
      });

      const res = await request(app.getHttpServer())
        .get('/tasks/1/comments?page=1&pageSize=10')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Validation failures → 400
  // ══════════════════════════════════════════════════════════════════
  describe('validation failure → 400', () => {
    it('POST with missing body → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks/1/comments')
        .send({})
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('POST with empty body → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks/1/comments')
        .send({ body: '' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('POST with unknown field → 400 (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks/1/comments')
        .send({ body: 'Hello', unknownField: 'x' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Error-path → 404 for missing task
  // ══════════════════════════════════════════════════════════════════
  describe('error-path → 404', () => {
    it('POST /tasks/:taskId/comments with missing task → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockCommentsService.create.mockRejectedValue(
        new NotFoundException('Task with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .post('/tasks/999/comments')
        .send({ body: 'Hello' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('GET /tasks/:taskId/comments with missing task → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockCommentsService.findByTask.mockRejectedValue(
        new NotFoundException('Task with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .get('/tasks/999/comments')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
    });

    it('POST /tasks/:taskId/comments with non-numeric taskId → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks/abc/comments')
        .send({ body: 'Hello' })
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
        .post('/tasks/1/comments')
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
});
