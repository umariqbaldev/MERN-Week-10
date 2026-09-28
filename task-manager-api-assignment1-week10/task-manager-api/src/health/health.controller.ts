import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * C1: Thin controller — delegates all logic to HealthService.
 * No Repository or DataSource imported in this file.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /health/db
   * Returns row counts from the database to prove connectivity.
   */
  @Public()
  @Get('db')
  async checkDatabase() {
    return this.healthService.getDatabaseHealth();
  }
}
