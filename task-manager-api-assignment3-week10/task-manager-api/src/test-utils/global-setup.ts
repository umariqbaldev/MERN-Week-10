/**
 * W1 + X3: Jest global setup for integration tests.
 *
 * 1. Loads .env.test so every test process uses the test database.
 * 2. X3 — Safety guard: reads the DB name and ABORTS if it is not
 *    "task_manager_test". This makes it impossible to accidentally
 *    run the suite against the dev / production database.
 * 3. Runs TypeORM synchronize to ensure the schema is up-to-date
 *    before the first test starts (W1: migrations before suite).
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';

// Entities — import explicitly so TypeORM can build the schema
import { User } from '../entities/user.entity';
import { Project } from '../entities/project.entity';
import { ProjectMember } from '../entities/project-member.entity';
import { Task } from '../entities/task.entity';
import { Tag } from '../entities/tag.entity';
import { Comment } from '../entities/comment.entity';
import { RefreshToken } from '../entities/refresh-token.entity';

const EXPECTED_TEST_DB = 'task_manager_test';

export default async function globalSetup(): Promise<void> {
  // ── 1. Load .env.test ───────────────────────────────────────────
  dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

  // ── 2. X3: Safety guard — abort if DB is NOT the test database ──
  const dbName = process.env.DB_DATABASE;
  if (dbName !== EXPECTED_TEST_DB) {
    throw new Error(
      `\n\n` +
        `╔══════════════════════════════════════════════════════════════╗\n` +
        `║  X3 SAFETY GUARD — WRONG DATABASE DETECTED!                ║\n` +
        `║                                                            ║\n` +
        `║  Expected DB_DATABASE = "${EXPECTED_TEST_DB}"        ║\n` +
        `║  Got      DB_DATABASE = "${dbName || '(not set)'}"${' '.repeat(Math.max(0, 24 - (dbName || '(not set)').length))}║\n` +
        `║                                                            ║\n` +
        `║  The integration test suite REFUSES to run against any     ║\n` +
        `║  database other than the designated test database.         ║\n` +
        `║                                                            ║\n` +
        `║  Fix: set DB_DATABASE in .env.test to "${EXPECTED_TEST_DB}"║\n` +
        `╚══════════════════════════════════════════════════════════════╝\n`,
    );
  }

  // ── 3. Synchronize the schema (W1: run migrations before suite) ─
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE,
    entities: [User, Project, ProjectMember, Task, Tag, Comment, RefreshToken],
    synchronize: true,
    logging: false,
  });

  await dataSource.initialize();

  // Truncate all tables to ensure a clean start
  await dataSource.query(`
    TRUNCATE TABLE
      comments, task_tags, tasks, project_members, projects,
      refresh_tokens, tags, users
    RESTART IDENTITY CASCADE
  `);

  await dataSource.destroy();

  console.log(`✅ Global setup complete — using test database: ${dbName}`);
}
