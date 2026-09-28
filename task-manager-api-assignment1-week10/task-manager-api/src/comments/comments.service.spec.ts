import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { Comment } from '../entities/comment.entity';
import { Task } from '../entities/task.entity';
import { User } from '../entities/user.entity';

/**
 * C3 + X1: Unit tests for CommentsService.
 * Updated for Assignment 2 — create() now takes (taskId, dto, userId).
 */
describe('CommentsService', () => {
  let service: CommentsService;

  // ── Mock repositories ──────────────────────────────────────────────
  const mockCommentRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
  };

  const mockTaskRepository = {
    findOneBy: jest.fn(),
  };

  const mockUserRepository = {
    findOneBy: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: getRepositoryToken(Comment), useValue: mockCommentRepository },
        { provide: getRepositoryToken(Task), useValue: mockTaskRepository },
        { provide: getRepositoryToken(User), useValue: mockUserRepository },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ══════════════════════════════════════════════════════════════════
  //  create — W2: author from @CurrentUser (userId), not body
  // ══════════════════════════════════════════════════════════════════
  describe('create', () => {
    it('should throw NotFoundException when task does not exist (C1)', async () => {
      mockTaskRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create(999, { body: 'Hello' }, 1),
      ).rejects.toThrow(NotFoundException);

      expect(mockTaskRepository.findOneBy).toHaveBeenCalledWith({ id: 999 });
    });

    it('should throw NotFoundException when author (userId) does not exist', async () => {
      mockTaskRepository.findOneBy.mockResolvedValue({ id: 1 });
      mockUserRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.create(1, { body: 'Hello' }, 999),
      ).rejects.toThrow(NotFoundException);

      expect(mockUserRepository.findOneBy).toHaveBeenCalledWith({ id: 999 });
    });

    it('should create a comment with userId as author and return with relation (X1)', async () => {
      const fakeTask = { id: 1, title: 'Task 1' };
      const fakeUser = { id: 2, name: 'Bob', email: 'bob@test.com' };
      const fakeSaved = {
        id: 10,
        task_id: 1,
        author_id: 2,
        body: 'Great work!',
        created_at: new Date(),
      };
      const fakeFullComment = { ...fakeSaved, author: fakeUser };

      mockTaskRepository.findOneBy.mockResolvedValue(fakeTask);
      mockUserRepository.findOneBy.mockResolvedValue(fakeUser);
      mockCommentRepository.create.mockReturnValue(fakeSaved);
      mockCommentRepository.save.mockResolvedValue(fakeSaved);
      mockCommentRepository.findOne.mockResolvedValue(fakeFullComment);

      const result = await service.create(1, { body: 'Great work!' }, 2);

      // X1: field-by-field mapping assertion
      expect(result.id).toBe(10);
      expect(result.task_id).toBe(1);
      expect(result.author_id).toBe(2);
      expect(result.body).toBe('Great work!');
      expect(result.author).toEqual(fakeUser);
      expect(mockCommentRepository.create).toHaveBeenCalledWith({
        task_id: 1,
        author_id: 2, // userId, not from body
        body: 'Great work!',
      });
      expect(mockCommentRepository.save).toHaveBeenCalled();
      expect(mockCommentRepository.findOne).toHaveBeenCalledWith({
        where: { id: 10 },
        relations: ['author'],
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  findByTask — X3: paginated comments
  // ══════════════════════════════════════════════════════════════════
  describe('findByTask', () => {
    it('should throw NotFoundException when task does not exist', async () => {
      mockTaskRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findByTask(999, {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return paginated comments with defaults', async () => {
      const fakeTask = { id: 1 };
      const fakeComments = [
        { id: 1, body: 'Comment 1', author: { id: 1 } },
        { id: 2, body: 'Comment 2', author: { id: 2 } },
      ];

      mockTaskRepository.findOneBy.mockResolvedValue(fakeTask);
      mockCommentRepository.findAndCount.mockResolvedValue([fakeComments, 2]);

      const result = await service.findByTask(1, {});

      expect(result.items).toEqual(fakeComments);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(mockCommentRepository.findAndCount).toHaveBeenCalledWith({
        where: { task_id: 1 },
        relations: ['author'],
        skip: 0,
        take: 20,
        order: { created_at: 'DESC' },
      });
    });

    it('should respect page and pageSize', async () => {
      mockTaskRepository.findOneBy.mockResolvedValue({ id: 1 });
      mockCommentRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findByTask(1, { page: 2, pageSize: 5 });

      expect(mockCommentRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,  // (2 - 1) * 5
          take: 5,
        }),
      );
    });

    it('should cap pageSize at 100', async () => {
      mockTaskRepository.findOneBy.mockResolvedValue({ id: 1 });
      mockCommentRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findByTask(1, { pageSize: 999 });

      expect(mockCommentRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
