import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';

/**
 * C6 + X3: Integration tests for ProjectsController.
 * Drives the HTTP layer with supertest — no database needed.
 *
 * Assignment 2: A middleware injects a mock user so @CurrentUser() resolves.
 * Guards are NOT imported here — we test the controller, not guard logic.
 */
describe('ProjectsController (integration)', () => {
  let app: INestApplication;

  // Mock authenticated user — @CurrentUser() reads from req.user
  const mockUser = { userId: 1, email: 'test@test.com' };

  // ── Mock ProjectsService ──────────────────────────────────────────
  const mockProjectsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: mockProjectsService },
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
  //  Happy-path: POST → 201, GET list, GET :id, PATCH, DELETE 204
  // ══════════════════════════════════════════════════════════════════
  describe('happy-path CRUD', () => {
    const fakeProject = {
      id: 1,
      name: 'Project Alpha',
      owner_id: 1,
      created_at: '2026-01-15T00:00:00.000Z',
      owner: { id: 1, name: 'Alice' },
    };

    it('POST /projects → 201 with valid body (W2: userId from @CurrentUser)', async () => {
      mockProjectsService.create.mockResolvedValue(fakeProject);

      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'Project Alpha' }) // ownerId no longer required
        .expect(201);

      expect(res.body).toEqual(fakeProject);
      expect(mockProjectsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Project Alpha' }),
        mockUser.userId, // W2: userId from @CurrentUser
      );
    });

    it('GET /projects → 200 with paginated list', async () => {
      mockProjectsService.findAll.mockResolvedValue({
        items: [fakeProject],
        total: 1,
        page: 1,
      });

      const res = await request(app.getHttpServer())
        .get('/projects?page=1&pageSize=10')
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
    });

    it('GET /projects/:id → 200 with owner', async () => {
      mockProjectsService.findOne.mockResolvedValue(fakeProject);

      const res = await request(app.getHttpServer())
        .get('/projects/1')
        .expect(200);

      expect(res.body).toEqual(fakeProject);
      expect(res.body.owner).toBeDefined();
    });

    it('PATCH /projects/:id → 200 with updated data', async () => {
      const updated = { ...fakeProject, name: 'Updated' };
      mockProjectsService.update.mockResolvedValue(updated);

      const res = await request(app.getHttpServer())
        .patch('/projects/1')
        .send({ name: 'Updated' })
        .expect(200);

      expect(res.body.name).toBe('Updated');
    });

    it('DELETE /projects/:id → 204 No Content', async () => {
      mockProjectsService.remove.mockResolvedValue(undefined);

      await request(app.getHttpServer())
        .delete('/projects/1')
        .expect(204);

      expect(mockProjectsService.remove).toHaveBeenCalledWith(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Validation failures → 400
  // ══════════════════════════════════════════════════════════════════
  describe('validation failure → 400', () => {
    it('POST /projects with missing name → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({})
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('POST /projects with name too short → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'AB' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });

    it('POST /projects with unknown field → 400 (forbidNonWhitelisted)', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'Valid Project', unknownField: 'x' })
        .expect(400);

      expect(res.body.statusCode).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Error-path tests → 404
  // ══════════════════════════════════════════════════════════════════
  describe('error-path → 404', () => {
    it('GET /projects/:id with unknown id → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockProjectsService.findOne.mockRejectedValue(
        new NotFoundException('Project with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .get('/projects/999')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.message).toContain('not found');
    });

    it('PATCH /projects/:id with unknown id → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockProjectsService.update.mockRejectedValue(
        new NotFoundException('Project with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .patch('/projects/999')
        .send({ name: 'Will not work' })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
    });

    it('DELETE /projects/:id with unknown id → 404', async () => {
      const { NotFoundException } = require('@nestjs/common');
      mockProjectsService.remove.mockRejectedValue(
        new NotFoundException('Project with id 999 not found'),
      );

      const res = await request(app.getHttpServer())
        .delete('/projects/999')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
    });

    it('GET /projects/:id with non-numeric id → 400', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects/abc')
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
        .post('/projects')
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
