import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Week 9 Assignment 2: Add creator_id column to tasks table.
 * Used by the X1 resource-ownership guard to track who created each task.
 */
export class AddCreatorIdToTasks1700000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tasks
      ADD COLUMN creator_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tasks DROP COLUMN creator_id;
    `);
  }
}
