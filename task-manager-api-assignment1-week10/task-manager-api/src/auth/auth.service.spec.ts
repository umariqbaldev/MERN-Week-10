import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';

import { AuthService } from './auth.service';
import { User } from '../entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';

// ── Helpers ──────────────────────────────────────────────────────────

const hashToken = (raw: string) =>
  crypto.createHash('sha256').update(raw).digest('hex');

const mockUser = (): User => ({
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  password_hash: 'argon2-hash',
  created_at: new Date('2024-01-01'),
  owned_projects: [],
  memberships: [],
  comments: [],
});

// ── Mock factories ───────────────────────────────────────────────────

const mockUserRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((dto) => ({ ...dto, id: 1, created_at: new Date('2024-01-01') })),
  save: jest.fn((entity) => Promise.resolve(entity)),
});

const mockRefreshRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn((dto) => ({ ...dto, id: 1 })),
  save: jest.fn((entity) => Promise.resolve(entity)),
  createQueryBuilder: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 2 }),
  })),
});

const mockJwtService = () => ({
  sign: jest.fn(() => 'signed-jwt-token'),
});

const mockConfigService = () => ({
  get: jest.fn((key: string, defaultValue?: unknown) => {
    const map: Record<string, unknown> = {
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '15m',
      REFRESH_EXPIRES_IN: '7d',
      ARGON2_TIME_COST: 1,       // X3: low cost for tests
      ARGON2_MEMORY_COST: 1024,  // X3: low memory for tests
    };
    return map[key] ?? defaultValue;
  }),
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof mockUserRepo>;
  let refreshRepo: ReturnType<typeof mockRefreshRepo>;
  let jwtService: ReturnType<typeof mockJwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepo },
        { provide: getRepositoryToken(RefreshToken), useFactory: mockRefreshRepo },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: ConfigService, useFactory: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepo = module.get(getRepositoryToken(User));
    refreshRepo = module.get(getRepositoryToken(RefreshToken));
    jwtService = module.get(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── W2: Register ──────────────────────────────────────────────────

  describe('register', () => {
    it('should hash password with argon2 and return user without password', async () => {
      userRepo.findOne.mockResolvedValue(null); // no duplicate

      const result = await service.register({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'securepass123',
      });

      // Should have called create with an argon2 hash, not plaintext
      const createArg = userRepo.create.mock.calls[0][0];
      expect(createArg.password_hash).toBeDefined();
      expect(createArg.password_hash).not.toBe('securepass123');
      expect(createArg.password_hash).toMatch(/^\$argon2/); // argon2 hash prefix

      // Return value should NOT contain password or hash
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name', 'Alice');
      expect(result).toHaveProperty('email', 'alice@example.com');
      expect(result).not.toHaveProperty('password');
      expect(result).not.toHaveProperty('password_hash');
    });

    it('should throw ConflictException for duplicate email', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());

      await expect(
        service.register({
          name: 'Alice',
          email: 'alice@example.com',
          password: 'securepass123',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── C1: Login — password verification ─────────────────────────────

  describe('login', () => {
    it('should accept correct password and return tokens', async () => {
      // Hash a real password so argon2.verify works
      const hash = await argon2.hash('correct-password', {
        type: argon2.argon2id,
        timeCost: 1,
        memoryCost: 1024,
      });
      userRepo.findOne.mockResolvedValue({ ...mockUser(), password_hash: hash });

      const result = await service.login({
        email: 'alice@example.com',
        password: 'correct-password',
      });

      expect(result).toHaveProperty('access_token', 'signed-jwt-token');
      expect(result).toHaveProperty('refresh_token');
      expect(typeof result.refresh_token).toBe('string');
      expect(result.refresh_token.length).toBeGreaterThan(0);
    });

    it('should reject wrong password with 401', async () => {
      const hash = await argon2.hash('correct-password', {
        type: argon2.argon2id,
        timeCost: 1,
        memoryCost: 1024,
      });
      userRepo.findOne.mockResolvedValue({ ...mockUser(), password_hash: hash });

      await expect(
        service.login({ email: 'alice@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject unknown email with 401 (same message as wrong password)', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'unknown@example.com', password: 'anything' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── C3: Refresh — rotation revokes old token ──────────────────────

  describe('refresh', () => {
    it('should rotate: revoke old token and issue new pair', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const existingToken: Partial<RefreshToken> = {
        id: 10,
        user_id: 1,
        token_hash: tokenHash,
        family_id: 'family-uuid-1',
        expires_at: new Date(Date.now() + 86400000), // 1 day from now
        revoked_at: null,
        user: mockUser(),
      };

      refreshRepo.findOne.mockResolvedValue(existingToken);

      const result = await service.refresh(rawToken);

      // Old token should be marked revoked
      expect(refreshRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 10, revoked_at: expect.any(Date) }),
      );

      // New pair issued
      expect(result).toHaveProperty('access_token', 'signed-jwt-token');
      expect(result).toHaveProperty('refresh_token');

      // New refresh token stored in DB with same family_id
      expect(refreshRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ family_id: 'family-uuid-1' }),
      );
    });

    // X1: Reuse detection
    it('should revoke entire family when a revoked token is reused', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const revokedToken: Partial<RefreshToken> = {
        id: 10,
        user_id: 1,
        token_hash: tokenHash,
        family_id: 'family-uuid-1',
        expires_at: new Date(Date.now() + 86400000),
        revoked_at: new Date(), // already revoked!
        user: mockUser(),
      };

      refreshRepo.findOne.mockResolvedValue(revokedToken);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );

      // Should have called query builder to revoke all tokens in family
      expect(refreshRepo.createQueryBuilder).toHaveBeenCalled();
    });

    // X2: Reject expired refresh token
    it('should reject expired refresh token with 401', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expiredToken: Partial<RefreshToken> = {
        id: 10,
        user_id: 1,
        token_hash: tokenHash,
        family_id: 'family-uuid-1',
        expires_at: new Date(Date.now() - 1000), // expired
        revoked_at: null,
        user: mockUser(),
      };

      refreshRepo.findOne.mockResolvedValue(expiredToken);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject unknown refresh token', async () => {
      refreshRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('non-existent-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── C4: Logout ────────────────────────────────────────────────────

  describe('logout', () => {
    it('should revoke the refresh token (set revoked_at)', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const existing: Partial<RefreshToken> = {
        id: 10,
        token_hash: tokenHash,
        revoked_at: null,
      };

      refreshRepo.findOne.mockResolvedValue(existing);

      await service.logout(rawToken);

      expect(refreshRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 10, revoked_at: expect.any(Date) }),
      );
    });

    it('should throw 401 for unknown token', async () => {
      refreshRepo.findOne.mockResolvedValue(null);

      await expect(service.logout('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
