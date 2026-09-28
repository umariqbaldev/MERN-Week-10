import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * C2 (Asgn3): Typed configuration service — one place to read
 * every environment variable. The rest of the code imports this
 * service, never process.env.
 *
 * Values are coerced and typed here. Joi in AppModule validates
 * the raw strings at boot; this service provides typed getters
 * so no call site has to parseInt or guess defaults.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService) {}

  // ── Database ─────────────────────────────────────────────────────
  get dbHost(): string {
    return this.config.get<string>('DB_HOST', 'localhost');
  }
  get dbPort(): number {
    return this.config.get<number>('DB_PORT', 5432);
  }
  get dbUsername(): string {
    return this.config.get<string>('DB_USERNAME', 'postgres');
  }
  get dbPassword(): string {
    return this.config.get<string>('DB_PASSWORD', 'postgres');
  }
  get dbDatabase(): string {
    return this.config.get<string>('DB_DATABASE', 'task_manager');
  }

  // ── Application ──────────────────────────────────────────────────
  get port(): number {
    return this.config.get<number>('PORT', 3000);
  }
  get nodeEnv(): string {
    return this.config.get<string>('NODE_ENV', 'development');
  }
  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  // ── Auth / JWT ───────────────────────────────────────────────────
  get jwtSecret(): string {
    return this.config.get<string>('JWT_SECRET', '');
  }
  get jwtExpiresIn(): string {
    return this.config.get<string>('JWT_EXPIRES_IN', '15m');
  }
  get refreshExpiresIn(): string {
    return this.config.get<string>('REFRESH_EXPIRES_IN', '7d');
  }
  get argon2TimeCost(): number {
    return this.config.get<number>('ARGON2_TIME_COST', 3);
  }
  get argon2MemoryCost(): number {
    return this.config.get<number>('ARGON2_MEMORY_COST', 65536);
  }

  // ── Security ─────────────────────────────────────────────────────
  get corsOrigin(): string {
    return this.config.get<string>('CORS_ORIGIN', 'http://localhost:3000');
  }
  get throttleTtl(): number {
    return this.config.get<number>('THROTTLE_TTL', 60000);
  }
  get throttleLimit(): number {
    return this.config.get<number>('THROTTLE_LIMIT', 60);
  }
}
