import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import * as Joi from 'joi';

// Entities
import { User } from './entities/user.entity';
import { Project } from './entities/project.entity';
import { ProjectMember } from './entities/project-member.entity';
import { Task } from './entities/task.entity';
import { Tag } from './entities/tag.entity';
import { Comment } from './entities/comment.entity';
import { RefreshToken } from './entities/refresh-token.entity';

// Feature modules
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { HealthModule } from './health/health.module';
import { NotificationModule } from './notification/notification.module';
import { CommentsModule } from './comments/comments.module';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // ── W1 + X1 (Asgn1): ConfigModule with Joi validation ──────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validationSchema: Joi.object({
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(5432),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_DATABASE: Joi.string().required(),
        PORT: Joi.number().default(3000),
        // Auth — Week 9
        JWT_SECRET: Joi.string().required(),
        JWT_EXPIRES_IN: Joi.string().default('15m'),
        REFRESH_EXPIRES_IN: Joi.string().default('7d'),
        ARGON2_TIME_COST: Joi.number().default(3),
        ARGON2_MEMORY_COST: Joi.number().default(65536),
        // Assignment 3 — Security
        CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
        THROTTLE_TTL: Joi.number().default(60000),
        THROTTLE_LIMIT: Joi.number().default(60),
      }),
      validationOptions: {
        abortEarly: true,
      },
    }),

    // ── W1 (Asgn3): Global rate-limiter ─────────────────────────────
    // Default: 60 requests per 60 seconds per IP.
    // Auth controller overrides with a tighter limit via @Throttle().
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL', 60000),
            limit: config.get<number>('THROTTLE_LIMIT', 60),
          },
        ],
      }),
    }),

    // ── TypeOrmModule.forRoot from .env ─────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_DATABASE'),
        entities: [User, Project, ProjectMember, Task, Tag, Comment, RefreshToken],
        synchronize: false, // reuse Phase 3 migrations
      }),
    }),

    // ── Assignment 2 + 3: Resource modules ───────────────────────────
    UsersModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,

    // ── Week 9: Auth module ──────────────────────────────────────────
    AuthModule,

    // ── Assignment 1 modules ────────────────────────────────────────
    HealthModule,
    NotificationModule,
    SharedModule,
  ],
  providers: [
    // W1 (Asgn3): ThrottlerGuard applied globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
