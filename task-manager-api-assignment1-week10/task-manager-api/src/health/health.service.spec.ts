import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HealthService } from './health.service';
import { Task } from '../entities/task.entity';
import { Project } from '../entities/project.entity';
import { LoggerService } from '../shared/logger.service';

describe('HealthService', () => {
  let service: HealthService;

  // ── C2: Mock repository — jest.fn() for each method ───────────────
  const mockTaskRepository = {
    count: jest.fn(),
  };

  // ── C3: Second mock provider — Project repository ─────────────────
  const mockProjectRepository = {
    count: jest.fn(),
  };

  // ── X3: Mock the cross-module LoggerService ───────────────────────
  const mockLoggerService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        // C2: provide Task repository token → mock
        {
          provide: getRepositoryToken(Task),
          useValue: mockTaskRepository,
        },
        // C3: provide Project repository token → mock
        {
          provide: getRepositoryToken(Project),
          useValue: mockProjectRepository,
        },
        // X3: provide LoggerService → mock
        {
          provide: LoggerService,
          useValue: mockLoggerService,
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

  // ── C2: Unit test with mocked repository ──────────────────────────
  describe('getTaskCount', () => {
    it('should return task count from the repository', async () => {
      mockTaskRepository.count.mockResolvedValue(42);

      const result = await service.getTaskCount();

      expect(result).toBe(42);
      expect(mockTaskRepository.count).toHaveBeenCalledTimes(1);
    });
  });

  // ── C3: Tests replace one mock while service code stays the same ──
  describe('getProjectCount', () => {
    it('should return project count from the repository', async () => {
      mockProjectRepository.count.mockResolvedValue(7);

      const result = await service.getProjectCount();

      expect(result).toBe(7);
      expect(mockProjectRepository.count).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDatabaseHealth', () => {
    it('should return combined health data from both providers', async () => {
      mockTaskRepository.count.mockResolvedValue(42);
      mockProjectRepository.count.mockResolvedValue(7);

      const result = await service.getDatabaseHealth();

      expect(result).toEqual({
        status: 'ok',
        taskCount: 42,
        projectCount: 7,
      });
      expect(mockTaskRepository.count).toHaveBeenCalledTimes(1);
      expect(mockProjectRepository.count).toHaveBeenCalledTimes(1);
      // X3: Verify the logger (cross-module provider) was called
      expect(mockLoggerService.log).toHaveBeenCalledWith(
        'HealthService',
        'DB check: 42 tasks, 7 projects',
      );
    });

    it('should propagate repository errors', async () => {
      mockTaskRepository.count.mockRejectedValue(new Error('DB down'));
      mockProjectRepository.count.mockResolvedValue(7);

      await expect(service.getDatabaseHealth()).rejects.toThrow('DB down');
    });
  });
});
