import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { APP_GUARD } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

import { ProjectsController } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';
import { TasksController } from '../tasks/tasks.controller';
import { TasksService } from '../tasks/tasks.service';
import { CommentsController } from '../comments/comments.controller';
import { CommentsService } from '../comments/comments.service';

import { User } from '../entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { Project } from '../entities/project.entity';
import { ProjectMember } from '../entities/project-member.entity';
import { Task } from '../entities/task.entity';
import { Tag } from '../entities/tag.entity';
import { Comment } from '../entities/comment.entity';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';

/**
 * C5 + X1 + X2: RBAC e2e tests.
 *
 * Proves BOTH paths on every protected route:
 *   ✓ 401 without a token
 *   ✓ 403 for a role violation (viewer tries to write)
 *   ✓ 200/201 for the allowed role (owner/admin/member)
 *
 * Also tests:
 *   ✓ C4: unauthenticated → 401 (not 403)
 *   ✓ C2: only owner/admin can delete a project
 *   ✓ C3: role on project A doesn't grant access to project B
 *   ✓ X1: resource-ownership — only creator/assignee/owner can edit a task
 *   ✓ X2: @Public() routes work without a token
 */

const JWT_SECRET = 'rbac-e2e-test-secret-key-must-be-long-enough-for-hs256';

describe('RBAC e2e', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  // ── In-memory stores ────────────────────────────────────────────────
  let users: any[];
  let refreshTokens: any[];
  let projects: any[];
  let members: any[];
  let tasks: any[];
  let comments: any[];
  let tags: any[];

  // Monotonic ID counters — never reuse an ID after deletion
  const idCounters = { users: 0, refreshTokens: 0, projects: 0, tasks: 0, comments: 0 };
  const nextId = (entity: keyof typeof idCounters) => ++idCounters[entity];

  // Helpers to mint tokens for specific users
  const mintToken = (userId: number, email: string) =>
    jwtService.sign({ sub: userId, email });

  beforeAll(async () => {
    users = [];
    refreshTokens = [];
    projects = [];
    members = [];
    tasks = [];
    comments = [];
    tags = [];
    // Reset counters
    idCounters.users = 0;
    idCounters.refreshTokens = 0;
    idCounters.projects = 0;
    idCounters.tasks = 0;
    idCounters.comments = 0;

    // ── Mock User repo ─────────────────────────────────────────────
    const mockUserRepo = {
      findOne: jest.fn(({ where }) => {
        const found = users.find((u: any) => {
          if (where.email) return u.email === where.email;
          if (where.id) return u.id === where.id;
          return false;
        });
        return Promise.resolve(found || null);
      }),
      findOneBy: jest.fn(({ id, email }: any) => {
        const found = users.find(
          (u: any) => (id ? u.id === id : false) || (email ? u.email === email : false),
        );
        return Promise.resolve(found || null);
      }),
      create: jest.fn((dto: any) => ({
        id: nextId('users'),
        created_at: new Date(),
        ...dto,
      })),
      save: jest.fn((entity: any) => {
        if (!entity.id) entity.id = nextId('users');
        const idx = users.findIndex((u: any) => u.id === entity.id);
        if (idx >= 0) users[idx] = { ...users[idx], ...entity };
        else users.push(entity);
        return Promise.resolve(entity);
      }),
    };

    // ── Mock RefreshToken repo ─────────────────────────────────────
    const mockRefreshRepo = {
      findOne: jest.fn(({ where, relations }: any) => {
        const found = refreshTokens.find(
          (rt: any) => rt.token_hash === where.token_hash,
        );
        if (found && relations?.includes('user')) {
          found.user = users.find((u: any) => u.id === found.user_id) || null;
        }
        return Promise.resolve(found || null);
      }),
      create: jest.fn((dto: any) => ({
        id: nextId('refreshTokens'),
        created_at: new Date(),
        ...dto,
      })),
      save: jest.fn((entity: any) => {
        if (!entity.id) entity.id = nextId('refreshTokens');
        const idx = refreshTokens.findIndex((rt: any) => rt.id === entity.id);
        if (idx >= 0) refreshTokens[idx] = { ...refreshTokens[idx], ...entity };
        else refreshTokens.push(entity);
        return Promise.resolve(entity);
      }),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn((_cond: string, params: any) => {
          refreshTokens.forEach((rt: any) => {
            if (rt.family_id === params.fid && !rt.revoked_at) {
              rt.revoked_at = new Date();
            }
          });
          return { execute: jest.fn().mockResolvedValue({ affected: 1 }) };
        }),
      })),
    };

    // ── Mock Project repo ──────────────────────────────────────────
    const mockProjectRepo = {
      findOne: jest.fn(({ where }: any) => {
        const p = projects.find((pr: any) => pr.id === where.id);
        if (p) {
          p.owner = users.find((u: any) => u.id === p.owner_id) || null;
        }
        return Promise.resolve(p || null);
      }),
      findOneBy: jest.fn(({ id }: any) =>
        Promise.resolve(projects.find((p: any) => p.id === id) || null),
      ),
      create: jest.fn((dto: any) => ({
        id: nextId('projects'),
        created_at: new Date(),
        ...dto,
      })),
      save: jest.fn((entity: any) => {
        if (!entity.id) entity.id = nextId('projects');
        const idx = projects.findIndex((p: any) => p.id === entity.id);
        if (idx >= 0) projects[idx] = { ...projects[idx], ...entity };
        else projects.push(entity);
        return Promise.resolve(entity);
      }),
      findAndCount: jest.fn(() =>
        Promise.resolve([projects, projects.length]),
      ),
      remove: jest.fn((entity: any) => {
        projects = projects.filter((p: any) => p.id !== entity.id);
        return Promise.resolve(entity);
      }),
    };

    // ── Mock ProjectMember repo ────────────────────────────────────
    const mockMemberRepo = {
      findOne: jest.fn(({ where }: any) => {
        const found = members.find(
          (m: any) => m.user_id === where.user_id && m.project_id === where.project_id,
        );
        return Promise.resolve(found || null);
      }),
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn((entity: any) => {
        const idx = members.findIndex(
          (m: any) =>
            m.user_id === entity.user_id && m.project_id === entity.project_id,
        );
        if (idx >= 0) members[idx] = { ...members[idx], ...entity };
        else members.push(entity);
        return Promise.resolve(entity);
      }),
    };

    // ── Mock Task repo ─────────────────────────────────────────────
    const mockTaskRepo = {
      findOne: jest.fn(({ where, select }: any) => {
        const t = tasks.find((tk: any) => tk.id === where.id);
        return Promise.resolve(t || null);
      }),
      findOneBy: jest.fn(({ id }: any) =>
        Promise.resolve(tasks.find((t: any) => t.id === id) || null),
      ),
      create: jest.fn((dto: any) => ({
        id: nextId('tasks'),
        created_at: new Date(),
        ...dto,
      })),
      save: jest.fn((entity: any) => {
        if (!entity.id) entity.id = nextId('tasks');
        const idx = tasks.findIndex((t: any) => t.id === entity.id);
        if (idx >= 0) tasks[idx] = { ...tasks[idx], ...entity };
        else tasks.push(entity);
        return Promise.resolve(entity);
      }),
      remove: jest.fn((entity: any) => {
        tasks = tasks.filter((t: any) => t.id !== entity.id);
        return Promise.resolve(entity);
      }),
      createQueryBuilder: jest.fn(() => {
        const qb: any = {};
        qb.leftJoinAndSelect = jest.fn().mockReturnValue(qb);
        qb.loadRelationCountAndMap = jest.fn().mockReturnValue(qb);
        qb.where = jest.fn((cond: string, params: any) => {
          qb._taskId = params.id;
          return qb;
        });
        qb.andWhere = jest.fn().mockReturnValue(qb);
        qb.skip = jest.fn().mockReturnValue(qb);
        qb.take = jest.fn().mockReturnValue(qb);
        qb.orderBy = jest.fn().mockReturnValue(qb);
        qb.getOne = jest.fn(() => {
          const t = tasks.find((tk: any) => tk.id === qb._taskId);
          if (t) {
            t.project = projects.find((p: any) => p.id === t.project_id) || null;
            t.assignee = users.find((u: any) => u.id === t.assignee_id) || null;
            t.tags = [];
            t.commentCount = 0;
          }
          return Promise.resolve(t || null);
        });
        qb.getManyAndCount = jest.fn(() =>
          Promise.resolve([tasks, tasks.length]),
        );
        return qb;
      }),
    };

    // ── Mock Tag repo ──────────────────────────────────────────────
    const mockTagRepo = {
      findBy: jest.fn(() => Promise.resolve([])),
    };

    // ── Mock Comment repo ──────────────────────────────────────────
    const mockCommentRepo = {
      findOne: jest.fn(({ where }: any) => {
        const c = comments.find((cm: any) => cm.id === where.id);
        if (c) {
          c.author = users.find((u: any) => u.id === c.author_id) || null;
        }
        return Promise.resolve(c || null);
      }),
      create: jest.fn((dto: any) => ({
        id: nextId('comments'),
        created_at: new Date(),
        ...dto,
      })),
      save: jest.fn((entity: any) => {
        if (!entity.id) entity.id = nextId('comments');
        const idx = comments.findIndex((c: any) => c.id === entity.id);
        if (idx >= 0) comments[idx] = { ...comments[idx], ...entity };
        else comments.push(entity);
        return Promise.resolve(entity);
      }),
      findAndCount: jest.fn(() =>
        Promise.resolve([comments, comments.length]),
      ),
    };

    // ── Build test module with FULL guard chain ────────────────────
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET,
              JWT_EXPIRES_IN: '15m',
              REFRESH_EXPIRES_IN: '7d',
              ARGON2_TIME_COST: 1,
              ARGON2_MEMORY_COST: 1024,
            }),
          ],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.get<string>('JWT_SECRET'),
            signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') },
          }),
        }),
      ],
      controllers: [
        AuthController,
        ProjectsController,
        TasksController,
        CommentsController,
      ],
      providers: [
        AuthService,
        ProjectsService,
        TasksService,
        CommentsService,
        JwtStrategy,
        RolesGuard,

        // C4: JwtAuthGuard runs first
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        // C4: RolesGuard runs second
        { provide: APP_GUARD, useClass: RolesGuard },

        // Repos
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: getRepositoryToken(RefreshToken), useValue: mockRefreshRepo },
        { provide: getRepositoryToken(Project), useValue: mockProjectRepo },
        { provide: getRepositoryToken(ProjectMember), useValue: mockMemberRepo },
        { provide: getRepositoryToken(Task), useValue: mockTaskRepo },
        { provide: getRepositoryToken(Tag), useValue: mockTagRepo },
        { provide: getRepositoryToken(Comment), useValue: mockCommentRepo },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    jwtService = moduleFixture.get(JwtService);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ══════════════════════════════════════════════════════════════════
  //  Seed: register users, get tokens, create project + memberships
  // ══════════════════════════════════════════════════════════════════
  let ownerToken: string;
  let memberToken: string;
  let viewerToken: string;
  let outsiderToken: string;
  let projectId: number;

  describe('Seed data', () => {
    it('should register an owner, member, viewer, and outsider', async () => {
      // Register owner
      const ownerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Owner', email: 'owner@rbac.com', password: 'password123' })
        .expect(201);

      // Register member
      const memberRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Member', email: 'member@rbac.com', password: 'password123' })
        .expect(201);

      // Register viewer
      const viewerRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Viewer', email: 'viewer@rbac.com', password: 'password123' })
        .expect(201);

      // Register outsider (no membership on any project)
      const outsiderRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Outsider', email: 'outsider@rbac.com', password: 'password123' })
        .expect(201);

      // Mint JWTs directly (faster than login for test purposes)
      ownerToken = mintToken(ownerRes.body.id, 'owner@rbac.com');
      memberToken = mintToken(memberRes.body.id, 'member@rbac.com');
      viewerToken = mintToken(viewerRes.body.id, 'viewer@rbac.com');
      outsiderToken = mintToken(outsiderRes.body.id, 'outsider@rbac.com');

      expect(ownerToken).toBeDefined();
      expect(memberToken).toBeDefined();
    });

    it('should create a project and seed memberships', async () => {
      // Owner creates a project (automatically gets 'owner' membership)
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'RBAC Test Project' })
        .expect(201);

      projectId = res.body.id;
      expect(projectId).toBeDefined();

      // Seed member and viewer memberships directly in the store
      const ownerId = users.find((u: any) => u.email === 'owner@rbac.com')!.id;
      const memberId = users.find((u: any) => u.email === 'member@rbac.com')!.id;
      const viewerId = users.find((u: any) => u.email === 'viewer@rbac.com')!.id;

      members.push(
        { user_id: memberId, project_id: projectId, role: 'member' },
        { user_id: viewerId, project_id: projectId, role: 'viewer' },
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  C4: Unauthenticated → 401 (not 403)
  // ══════════════════════════════════════════════════════════════════
  describe('C4: unauthenticated → 401', () => {
    it('POST /projects without token → 401', async () => {
      await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'No Token' })
        .expect(401);
    });

    it('POST /tasks without token → 401', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .send({ title: 'No Token', projectId: 1 })
        .expect(401);
    });

    it('DELETE /projects/:id without token → 401', async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${projectId}`)
        .expect(401);
    });

    it('PATCH /tasks/:id without token → 401', async () => {
      await request(app.getHttpServer())
        .patch('/tasks/1')
        .send({ title: 'Updated' })
        .expect(401);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  X2: @Public() routes work without a token
  // ══════════════════════════════════════════════════════════════════
  describe('X2: public routes work without token', () => {
    it('GET /projects → 200 without token', async () => {
      await request(app.getHttpServer())
        .get('/projects')
        .expect(200);
    });

    it('GET /projects/:id → 200 without token', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .expect(200);
    });

    it('GET /tasks → 200 without token', async () => {
      await request(app.getHttpServer())
        .get('/tasks')
        .expect(200);
    });

    it('POST /auth/register → public', async () => {
      // Just verify it doesn't return 401
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Public', email: 'public@rbac.com', password: 'password123' });
      expect([201, 409]).toContain(res.status);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  C1 + C5: Role checks — viewer gets 403, owner/member get success
  // ══════════════════════════════════════════════════════════════════
  describe('C1 + C5: role-based access on tasks', () => {
    it('member can create a task on the project → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'Member Task', projectId })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe('Member Task');
    });

    it('viewer cannot create a task → 403', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ title: 'Viewer Task', projectId })
        .expect(403);
    });

    it('owner can create a task → 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Owner Task', projectId })
        .expect(201);

      expect(res.body.title).toBe('Owner Task');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  C2: Only owner/admin can delete a project — member gets 403
  // ══════════════════════════════════════════════════════════════════
  describe('C2: delete project restricted to owner/admin', () => {
    let tempProjectId: number;

    beforeAll(async () => {
      // Create a second project for delete testing
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Deletable Project' })
        .expect(201);

      tempProjectId = res.body.id;

      // Give member a 'member' role on this project too
      const memberId = users.find((u: any) => u.email === 'member@rbac.com')!.id;
      members.push({ user_id: memberId, project_id: tempProjectId, role: 'member' });
    });

    it('member cannot delete a project → 403', async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${tempProjectId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });

    it('viewer cannot delete a project → 403', async () => {
      const viewerId = users.find((u: any) => u.email === 'viewer@rbac.com')!.id;
      members.push({ user_id: viewerId, project_id: tempProjectId, role: 'viewer' });

      await request(app.getHttpServer())
        .delete(`/projects/${tempProjectId}`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(403);
    });

    it('owner can delete a project → 204', async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${tempProjectId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(204);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  C3: Cross-project access — role on project A doesn't work on B
  // ══════════════════════════════════════════════════════════════════
  describe('C3: confused deputy — cross-project rejection', () => {
    it('outsider (no membership) cannot create task on project → 403', async () => {
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ title: 'Outsider Task', projectId })
        .expect(403);
    });

    it('member on project A cannot create task on project B', async () => {
      // Create project B owned by outsider
      const bRes = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ name: 'Project B' })
        .expect(201);

      const projectBId = bRes.body.id;

      // Member has role on projectId (A) but NOT on projectBId (B)
      await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'Cross Project Task', projectId: projectBId })
        .expect(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  X1: Resource ownership — only creator/assignee/owner can edit
  // ══════════════════════════════════════════════════════════════════
  describe('X1: resource-ownership guard on task edit', () => {
    let memberTaskId: number;

    beforeAll(async () => {
      // Create a task by "member" user — so member is the creator
      const memberId = users.find((u: any) => u.email === 'member@rbac.com')!.id;
      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'Ownership Test Task', projectId })
        .expect(201);

      memberTaskId = res.body.id;
    });

    it('creator can edit their own task → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${memberTaskId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'Updated by Creator' })
        .expect(200);

      expect(res.body.title).toBe('Updated by Creator');
    });

    it('project owner can edit any task → 200 (owner bypass)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${memberTaskId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ title: 'Updated by Owner' })
        .expect(200);

      expect(res.body.title).toBe('Updated by Owner');
    });

    it('another member (not creator/assignee) cannot edit → 403', async () => {
      // Register a second member
      const mem2Res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Member2', email: 'member2@rbac.com', password: 'password123' })
        .expect(201);

      const member2Id = mem2Res.body.id;
      const member2Token = mintToken(member2Id, 'member2@rbac.com');

      // Give member2 a 'member' role on the same project
      members.push({ user_id: member2Id, project_id: projectId, role: 'member' });

      await request(app.getHttpServer())
        .patch(`/tasks/${memberTaskId}`)
        .set('Authorization', `Bearer ${member2Token}`)
        .send({ title: 'Should fail' })
        .expect(403);
    });

    it('assignee can edit the task → 200', async () => {
      // Assign the task to a user
      const assigneeRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Assignee', email: 'assignee@rbac.com', password: 'password123' })
        .expect(201);

      const assigneeId = assigneeRes.body.id;
      const assigneeToken = mintToken(assigneeId, 'assignee@rbac.com');

      // Give assignee membership on the project
      members.push({ user_id: assigneeId, project_id: projectId, role: 'member' });

      // Update the task to have this assignee
      const task = tasks.find((t: any) => t.id === memberTaskId);
      if (task) task.assignee_id = assigneeId;

      const res = await request(app.getHttpServer())
        .patch(`/tasks/${memberTaskId}`)
        .set('Authorization', `Bearer ${assigneeToken}`)
        .send({ title: 'Updated by Assignee' })
        .expect(200);

      expect(res.body.title).toBe('Updated by Assignee');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  W2: @CurrentUser links resource to token's user
  // ══════════════════════════════════════════════════════════════════
  describe('W2: @CurrentUser resolves the right user', () => {
    it('created project is owned by the token user', async () => {
      const ownerId = users.find((u: any) => u.email === 'owner@rbac.com')!.id;

      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .expect(200);

      expect(res.body.owner_id).toBe(ownerId);
    });

    it('created task has creator_id matching token user', async () => {
      const memberId = users.find((u: any) => u.email === 'member@rbac.com')!.id;

      const res = await request(app.getHttpServer())
        .post('/tasks')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ title: 'Creator Check', projectId })
        .expect(201);

      expect(res.body.creator_id).toBe(memberId);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Comments: role check on nested route
  // ══════════════════════════════════════════════════════════════════
  describe('Comments: role check on nested route', () => {
    let taskId: number;

    beforeAll(async () => {
      // Find a task to comment on
      taskId = tasks[0]?.id || 1;
    });

    it('member can create a comment → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ body: 'LGTM!' })
        .expect(201);

      expect(res.body.body).toBe('LGTM!');
    });

    it('viewer cannot create a comment → 403', async () => {
      await request(app.getHttpServer())
        .post(`/tasks/${taskId}/comments`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .send({ body: 'Viewer comment' })
        .expect(403);
    });

    it('unauthenticated user cannot create a comment → 401', async () => {
      await request(app.getHttpServer())
        .post(`/tasks/${taskId}/comments`)
        .send({ body: 'No token comment' })
        .expect(401);
    });

    it('GET comments is public → 200 without token', async () => {
      await request(app.getHttpServer())
        .get(`/tasks/${taskId}/comments`)
        .expect(200);
    });
  });
});
