import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { TaskService } from '../task/task.service';

describe('NotificationService (X2 — circular dependency)', () => {
  let service: NotificationService;

  const mockTaskService = {
    getTaskTitle: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: TaskService,
          useValue: mockTaskService,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should compose a notification with the task title', async () => {
    mockTaskService.getTaskTitle.mockResolvedValue('Fix login bug');

    const result = await service.notify(1, 'assigned to you');

    expect(result).toBe('[NOTIFY] Task "Fix login bug": assigned to you');
    expect(mockTaskService.getTaskTitle).toHaveBeenCalledWith(1);
  });
});
