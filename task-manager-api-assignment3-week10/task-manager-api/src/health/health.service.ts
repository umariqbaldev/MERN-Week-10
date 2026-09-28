import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * C1 (Asgn3): Health service — reports application AND database status.
 * X1 (Asgn3): Distinguishes "app up, db down" from "all healthy".
 *             Short timeout (2 s) on DB check so it never hangs.
 */

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  uptime: number;
  checks: {
    application: { status: 'up' };
    database: { status: 'up' | 'down'; message?: string };
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * C1: Run SELECT 1 to prove a live database connection.
   * X1: Wrap in a timeout — if the query takes longer than 2 s
   *     the check returns "down" instead of hanging indefinitely.
   */
  async check(): Promise<HealthCheckResult> {
    const uptime = process.uptime();

    // X1: Database check with timeout
    let dbStatus: 'up' | 'down' = 'down';
    let dbMessage: string | undefined;

    try {
      // Race the query against a 2-second timeout
      await Promise.race([
        this.dataSource.query('SELECT 1'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database health check timed out')), 2000),
        ),
      ]);
      dbStatus = 'up';
    } catch (err: any) {
      dbStatus = 'down';
      dbMessage = err.message || 'Database unreachable';
      this.logger.error(`Database health check failed: ${dbMessage}`);
    }

    const status = dbStatus === 'up' ? 'healthy' : 'unhealthy';

    return {
      status,
      uptime: Math.round(uptime),
      checks: {
        application: { status: 'up' },
        database: {
          status: dbStatus,
          ...(dbMessage && { message: dbMessage }),
        },
      },
    };
  }
}
