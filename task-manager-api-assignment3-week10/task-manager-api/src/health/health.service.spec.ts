import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

/**
 * C4 (Asgn3): Unit tests for the health service.
 * Proves /health reports correctly when DB is up and when DB is down.
 */
describe('HealthService', () => {
  let service: HealthService;

  const mockDataSource = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('check()', () => {
    it('returns healthy when DB responds', async () => {
      mockDataSource.query.mockResolvedValue([{ '?column?': 1 }]);

      const result = await service.check();

      expect(result.status).toBe('healthy');
      expect(result.checks.application.status).toBe('up');
      expect(result.checks.database.status).toBe('up');
      expect(typeof result.uptime).toBe('number');
      expect(mockDataSource.query).toHaveBeenCalledWith('SELECT 1');
    });

    it('returns unhealthy when DB is down', async () => {
      mockDataSource.query.mockRejectedValue(new Error('Connection refused'));

      const result = await service.check();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.application.status).toBe('up');
      expect(result.checks.database.status).toBe('down');
      expect(result.checks.database.message).toContain('Connection refused');
    });

    it('returns unhealthy when DB check times out', async () => {
      // Simulate a query that never resolves (within the 2s timeout)
      let timer: ReturnType<typeof setTimeout>;
      mockDataSource.query.mockImplementation(
        () =>
          new Promise((resolve) => {
            timer = setTimeout(resolve, 5000);
          }),
      );

      const result = await service.check();

      // Clean up the dangling timer so Jest doesn't warn about open handles
      clearTimeout(timer!);

      expect(result.status).toBe('unhealthy');
      expect(result.checks.database.status).toBe('down');
      expect(result.checks.database.message).toContain('timed out');
    }, 10000);
  });
});
