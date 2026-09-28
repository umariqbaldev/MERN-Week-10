import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * C1 + X1 (Asgn3): Unit tests for the health controller.
 * Verifies correct HTTP status codes (200 vs 503) based on health result.
 */
describe('HealthController', () => {
  let controller: HealthController;

  const mockHealthService = {
    check: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: mockHealthService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check()', () => {
    it('returns 200 with healthy result when DB is up', async () => {
      const healthyResult = {
        status: 'healthy',
        uptime: 42,
        checks: {
          application: { status: 'up' },
          database: { status: 'up' },
        },
      };
      mockHealthService.check.mockResolvedValue(healthyResult);

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await controller.check(mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(healthyResult);
      expect(mockHealthService.check).toHaveBeenCalledTimes(1);
    });

    it('returns 503 with unhealthy result when DB is down', async () => {
      const unhealthyResult = {
        status: 'unhealthy',
        uptime: 42,
        checks: {
          application: { status: 'up' },
          database: { status: 'down', message: 'Connection refused' },
        },
      };
      mockHealthService.check.mockResolvedValue(unhealthyResult);

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await controller.check(mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(unhealthyResult);
    });
  });
});
