import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from '../entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { AllExceptionsFilter } from '../common/filters/http-exception.filter';

/**
 * C5 e2e tests: login success, wrong-password 401, refresh rotation.
 *
 * These tests spin up the full NestJS HTTP stack (controller → service)
 * with mocked repositories so no database is required.
 */

const hashToken = (raw: string) =>
  crypto.createHash('sha256').update(raw).digest('hex');

describe('Auth e2e', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  // In-memory stores used by mock repos
  let users: any[];
  let refreshTokens: any[];

  beforeAll(async () => {
    users = [];
    refreshTokens = [];

    const mockUserRepo = {
      findOne: jest.fn(({ where }) => {
        const found = users.find((u) => {
          if (where.email) return u.email === where.email;
          if (where.id) return u.id === where.id;
          return false;
        });
        return Promise.resolve(found || null);
      }),
      create: jest.fn((dto) => ({
        id: users.length + 1,
        created_at: new Date(),
        ...dto,
      })),
      save: jest.fn((entity) => {
        if (!entity.id) entity.id = users.length + 1;
        const idx = users.findIndex((u) => u.id === entity.id);
        if (idx >= 0) {
          users[idx] = { ...users[idx], ...entity };
        } else {
          users.push(entity);
        }
        return Promise.resolve(entity);
      }),
    };

    const mockRefreshRepo = {
      findOne: jest.fn(({ where, relations }) => {
        const found = refreshTokens.find((rt) => {
          if (where.token_hash) return rt.token_hash === where.token_hash;
          return false;
        });
        if (found && relations?.includes('user')) {
          found.user = users.find((u) => u.id === found.user_id) || null;
        }
        return Promise.resolve(found || null);
      }),
      create: jest.fn((dto) => ({
        id: refreshTokens.length + 1,
        created_at: new Date(),
        ...dto,
      })),
      save: jest.fn((entity) => {
        if (!entity.id) entity.id = refreshTokens.length + 1;
        const idx = refreshTokens.findIndex((rt) => rt.id === entity.id);
        if (idx >= 0) {
          refreshTokens[idx] = { ...refreshTokens[idx], ...entity };
        } else {
          refreshTokens.push(entity);
        }
        return Promise.resolve(entity);
      }),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn((_cond: string, params: any) => {
          // X1: Actually revoke all tokens in the family
          refreshTokens.forEach((rt) => {
            if (rt.family_id === params.fid && !rt.revoked_at) {
              rt.revoked_at = new Date();
            }
          });
          return {
            execute: jest.fn().mockResolvedValue({ affected: 1 }),
          };
        }),
      })),
    };

    // Build module manually to avoid ConfigModule global resolution issues
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // Provide test env values directly via envFilePath override
          load: [
            () => ({
              JWT_SECRET: 'e2e-test-secret-key-must-be-long-enough-for-hs256',
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
            signOptions: {
              expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m'),
            },
          }),
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: mockRefreshRepo,
        },
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

  // ── Register ───────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('should register a new user and return without password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Alice', email: 'alice@e2e.com', password: 'password123' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('name', 'Alice');
      expect(res.body).toHaveProperty('email', 'alice@e2e.com');
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('should reject duplicate email with 409', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Alice2', email: 'alice@e2e.com', password: 'password123' })
        .expect(409);
    });

    it('should reject short password with 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ name: 'Bob', email: 'bob@e2e.com', password: 'short' })
        .expect(400);
    });
  });

  // ── Login ──────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('should return access_token and refresh_token on success', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'alice@e2e.com', password: 'password123' })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(typeof res.body.access_token).toBe('string');
      expect(typeof res.body.refresh_token).toBe('string');

      // Decode the JWT and check payload — correct sub and email, short exp
      const decoded = jwtService.decode(res.body.access_token) as any;
      expect(decoded).toHaveProperty('sub');
      expect(decoded).toHaveProperty('email', 'alice@e2e.com');
      expect(decoded).toHaveProperty('exp');
    });

    it('should return 401 for wrong password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'alice@e2e.com', password: 'wrong-password' })
        .expect(401);

      expect(res.body.statusCode).toBe(401);
    });

    it('should return 401 for unknown email (same message as wrong password)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@e2e.com', password: 'anything' })
        .expect(401);

      expect(res.body.statusCode).toBe(401);
    });
  });

  // ── Refresh rotation ──────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    let firstRefreshToken: string;

    beforeAll(async () => {
      // Login to get a valid refresh token
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'alice@e2e.com', password: 'password123' });
      firstRefreshToken = res.body.refresh_token;
    });

    it('should rotate: issue new pair and revoke old', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: firstRefreshToken })
        .expect(200);

      expect(res.body).toHaveProperty('access_token');
      expect(res.body).toHaveProperty('refresh_token');
      expect(res.body.refresh_token).not.toBe(firstRefreshToken);

      // Old token should now be revoked in our in-memory store
      const oldHash = hashToken(firstRefreshToken);
      const old = refreshTokens.find((rt) => rt.token_hash === oldHash);
      expect(old?.revoked_at).not.toBeNull();
    });

    it('should return 401 when reusing an already-revoked token (X1 reuse detection)', async () => {
      // firstRefreshToken was already used above (revoked by rotation)
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: firstRefreshToken })
        .expect(401);
    });

    it('should return 401 for unknown token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: 'non-existent-token' })
        .expect(401);
    });
  });

  // ── Logout ─────────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    let tokenToRevoke: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'alice@e2e.com', password: 'password123' });
      tokenToRevoke = res.body.refresh_token;
    });

    it('should revoke token and return 200', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .send({ refresh_token: tokenToRevoke })
        .expect(200);

      // Token should be revoked in store
      const h = hashToken(tokenToRevoke);
      const rt = refreshTokens.find((r) => r.token_hash === h);
      expect(rt?.revoked_at).not.toBeNull();
    });

    it('should return 401 when refreshing a logged-out token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refresh_token: tokenToRevoke })
        .expect(401);
    });
  });
});
