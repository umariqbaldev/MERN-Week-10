import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;

  const mockHealthService = {
    getDatabaseHealth: jest.fn(),
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

  describe('checkDatabase', () => {
    it('should return health data from the service', async () => {
      const expected = { status: 'ok', taskCount: 42, projectCount: 7 };
      mockHealthService.getDatabaseHealth.mockResolvedValue(expected);

      const result = await controller.checkDatabase();

      expect(result).toEqual(expected);
      expect(mockHealthService.getDatabaseHealth).toHaveBeenCalledTimes(1);
    });
  });
});
