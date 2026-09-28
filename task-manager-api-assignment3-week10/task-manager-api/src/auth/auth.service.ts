import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';

import { User } from '../entities/user.entity';
import { RefreshToken } from '../entities/refresh-token.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── helpers ────────────────────────────────────────────────────────

  /** X3: argon2 cost from configuration — strong in prod, low in tests */
  private argon2HashOptions(): argon2.HashOptions {
    return {
      type: argon2.argon2id,
      timeCost: this.config.get<number>('ARGON2_TIME_COST', 3),
      memoryCost: this.config.get<number>('ARGON2_MEMORY_COST', 65536),
    };
  }

  /** SHA-256 hash of a raw refresh token (stored in DB, never the raw token) */
  private hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /** Parse REFRESH_EXPIRES_IN (e.g. "7d") into milliseconds */
  private refreshTtlMs(): number {
    const raw = this.config.get<string>('REFRESH_EXPIRES_IN', '7d');
    const match = raw.match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days
    const num = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return num * (multipliers[unit] || 24 * 60 * 60 * 1000);
  }

  /** Issue an access JWT with sub + email and configured expiry */
  private signAccessToken(user: User): string {
    return this.jwtService.sign(
      { sub: user.id, email: user.email },
      { expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '15m') },
    );
  }

  /**
   * Create a random refresh token, store its SHA-256 hash in the DB,
   * and return the raw token to the caller.
   */
  private async createRefreshToken(
    userId: number,
    familyId?: string,
  ): Promise<string> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const family = familyId ?? crypto.randomUUID();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs());

    const entity = this.refreshRepo.create({
      user_id: userId,
      token_hash: tokenHash,
      family_id: family,
      expires_at: expiresAt,
    });
    await this.refreshRepo.save(entity);

    return rawToken;
  }

  // ── W2: Register ──────────────────────────────────────────────────

  async register(
    dto: RegisterDto,
  ): Promise<{ id: number; name: string; email: string; created_at: Date }> {
    // Check for duplicate email
    const existing = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // Hash password with argon2 (X3: cost from config)
    const passwordHash = await argon2.hash(dto.password, this.argon2HashOptions());

    const user = this.userRepo.create({
      name: dto.name,
      email: dto.email,
      password_hash: passwordHash,
    } as Partial<User>);
    const saved: User = await this.userRepo.save(user);

    // Return without password or hash — never expose
    return {
      id: saved.id,
      name: saved.name,
      email: saved.email,
      created_at: saved.created_at,
    };
  }

  // ── C1 + C2: Login ───────────────────────────────────────────────

  async login(
    dto: LoginDto,
  ): Promise<{ access_token: string; refresh_token: string }> {
    // C1: Same 401 message for unknown email AND wrong password
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user || !user.password_hash) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await argon2.verify(user.password_hash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    // C2: Issue short-lived access JWT + refresh token (hash stored in DB)
    const accessToken = this.signAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  // ── C3 + X1 + X2: Refresh (rotation + reuse detection) ───────────

  async refresh(
    rawToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const tokenHash = this.hashToken(rawToken);

    const existing = await this.refreshRepo.findOne({
      where: { token_hash: tokenHash },
      relations: ['user'],
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // X2: Reject expired refresh token even when never revoked
    if (existing.expires_at < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // X1: Reuse detection — if token is already revoked, revoke ALL in family
    if (existing.revoked_at) {
      await this.refreshRepo
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revoked_at: new Date() })
        .where('family_id = :fid AND revoked_at IS NULL', {
          fid: existing.family_id,
        })
        .execute();

      throw new UnauthorizedException(
        'Refresh token reuse detected — family revoked',
      );
    }

    // C3: Mark old token as revoked
    existing.revoked_at = new Date();
    await this.refreshRepo.save(existing);

    // Issue new access + refresh pair (same family — rotation)
    const accessToken = this.signAccessToken(existing.user);
    const refreshToken = await this.createRefreshToken(
      existing.user_id,
      existing.family_id,
    );

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  // ── C4: Logout ────────────────────────────────────────────────────

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.refreshRepo.findOne({
      where: { token_hash: tokenHash },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Set revoked_at, keep row in DB
    existing.revoked_at = new Date();
    await this.refreshRepo.save(existing);
  }
}
