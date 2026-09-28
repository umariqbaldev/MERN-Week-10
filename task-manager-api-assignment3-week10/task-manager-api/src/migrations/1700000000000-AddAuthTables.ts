import { MigrationInterface, QueryRunner, TableColumn, Table, TableForeignKey } from 'typeorm';

/**
 * W1: Add password_hash to users and create refresh_tokens table.
 * synchronize stays false — schema changes only through migrations.
 */
export class AddAuthTables1700000000000 implements MigrationInterface {
  name = 'AddAuthTables1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add password_hash column to users
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'password_hash',
        type: 'varchar',
        isNullable: true, // existing rows don't have passwords yet
      }),
    );

    // 2. Create refresh_tokens table
    await queryRunner.createTable(
      new Table({
        name: 'refresh_tokens',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'user_id',
            type: 'int',
            isNullable: false,
          },
          {
            name: 'token_hash',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'family_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            isNullable: false,
          },
          {
            name: 'revoked_at',
            type: 'timestamp',
            isNullable: true,
            default: null,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // 3. Foreign key: refresh_tokens.user_id → users.id ON DELETE CASCADE
    await queryRunner.createForeignKey(
      'refresh_tokens',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key first
    const table = await queryRunner.getTable('refresh_tokens');
    if (table) {
      const fk = table.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('user_id') !== -1,
      );
      if (fk) {
        await queryRunner.dropForeignKey('refresh_tokens', fk);
      }
    }

    // Drop refresh_tokens table
    await queryRunner.dropTable('refresh_tokens', true);

    // Remove password_hash column from users
    await queryRunner.dropColumn('users', 'password_hash');
  }
}
