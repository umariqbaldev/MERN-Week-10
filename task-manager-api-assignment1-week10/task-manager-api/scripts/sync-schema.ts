/**
 * One-time script to synchronize the TypeORM schema on a database.
 * Usage: DB_DATABASE=task_manager npx ts-node scripts/sync-schema.ts
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../src/entities/user.entity';
import { Project } from '../src/entities/project.entity';
import { ProjectMember } from '../src/entities/project-member.entity';
import { Task } from '../src/entities/task.entity';
import { Tag } from '../src/entities/tag.entity';
import { Comment } from '../src/entities/comment.entity';
import { RefreshToken } from '../src/entities/refresh-token.entity';

async function main() {
  const dbName = process.env.DB_DATABASE || 'task_manager';
  console.log(`Synchronizing schema on database: ${dbName}`);

  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: dbName,
    entities: [User, Project, ProjectMember, Task, Tag, Comment, RefreshToken],
    synchronize: true, // create/update tables to match entities
    logging: true,
  });

  await ds.initialize();
  console.log(`Schema synchronized on ${dbName}`);
  await ds.destroy();
}

main().catch((err) => {
  console.error('Schema sync failed:', err);
  process.exit(1);
});
