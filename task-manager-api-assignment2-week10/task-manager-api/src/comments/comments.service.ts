import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from '../entities/comment.entity';
import { Task } from '../entities/task.entity';
import { User } from '../entities/user.entity';
import { CreateCommentDto } from './dto/create-comment.dto';

export interface PaginatedComments {
  items: Comment[];
  total: number;
  page: number;
}

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,

    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * C1: Validate that the parent task exists before saving.
   * Throws NotFoundException (404) instead of letting a raw FK error (500) leak.
   */
  private async validateTask(taskId: number): Promise<void> {
    const task = await this.taskRepository.findOneBy({ id: taskId });
    if (!task) {
      throw new NotFoundException(`Task with id ${taskId} not found`);
    }
  }

  /** Validate that the author (user) exists. */
  private async validateAuthor(authorId: number): Promise<void> {
    const user = await this.userRepository.findOneBy({ id: authorId });
    if (!user) {
      throw new NotFoundException(`User (author) with id ${authorId} not found`);
    }
  }

  /**
   * W2 + C1: Create a comment on a task.
   * Task id comes from the URL path. Author comes from @CurrentUser (userId).
   */
  async create(taskId: number, dto: CreateCommentDto, userId: number): Promise<Comment> {
    await this.validateTask(taskId);
    await this.validateAuthor(userId);

    const comment = this.commentRepository.create({
      task_id: taskId,
      author_id: userId, // W2: use authenticated user, not body
      body: dto.body,
    });

    const saved = await this.commentRepository.save(comment);

    // Return with author relation loaded
    return this.commentRepository.findOne({
      where: { id: saved.id },
      relations: ['author'],
    }) as Promise<Comment>;
  }

  /**
   * W2 + X3: List comments for a task with pagination.
   * Returns { items, total, page } — same shape as task list.
   */
  async findByTask(
    taskId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<PaginatedComments> {
    await this.validateTask(taskId);

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0
      ? Math.min(query.pageSize, 100)
      : 20;

    const [items, total] = await this.commentRepository.findAndCount({
      where: { task_id: taskId },
      relations: ['author'],
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { created_at: 'DESC' },
    });

    return { items, total, page };
  }
}
