import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * C1 (Asgn3): Health controller.
 * GET /health — reports application AND database status.
 * X1: Returns 200 when healthy, 503 when any check is down.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * GET /health → 200 (all healthy) or 503 (something down).
   * Body always includes per-check breakdown so a load balancer
   * can decide whether to pull the instance out of rotation.
   */
  @Public()
  @Get()
  async check(@Res() res: Response) {
    const result = await this.healthService.check();

    // X1: 503 when any dependency is down — load balancers use status code
    const httpStatus = result.status === 'healthy' ? 200 : 503;
    return res.status(httpStatus).json(result);
  }
}
