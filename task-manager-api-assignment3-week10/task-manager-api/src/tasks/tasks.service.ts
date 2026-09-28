import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Task } from '../entities/task.entity';
import { Project } from '../entities/project.entity';
import { User } from '../entities/user.entity';
import { Tag } from '../entities/tag.entity';
import { ProjectMember } from '../entities/project-member.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

interface ListTasksQuery {
  status?: string;
  projectId?: number;
  assigneeId?: number;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult {
  items: Task[];
  total: number;
  page: number;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,

    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,

    @InjectRepository(ProjectMember)
    private readonly memberRepository: Repository<ProjectMember>,
  ) {}

  /**
   * C4: Validate that a related entity exists before saving.
   * Throws NotFoundException (404) instead of letting a raw FK error (500) leak.
   */
  private async validateRelations(dto: CreateTaskDto | UpdateTaskDto): Promise<void> {
    if (dto.projectId !== undefined) {
      const project = await this.projectRepository.findOneBy({ id: dto.projectId });
      if (!project) {
        throw new NotFoundException(`Project with id ${dto.projectId} not found`);
      }
    }

    if (dto.assigneeId !== undefined) {
      const user = await this.userRepository.findOneBy({ id: dto.assigneeId });
      if (!user) {
        throw new NotFoundException(`User (assignee) with id ${dto.assigneeId} not found`);
      }
    }
  }

  /**
   * W2 + C4: Create a task from DTO, validating relations first.
   * creator_id comes from @CurrentUser (userId), not from the body.
   */
  async create(dto: CreateTaskDto, userId: number): Promise<Task> {
    await this.validateRelations(dto);

    const task = this.taskRepository.create({
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      project_id: dto.projectId,
      creator_id: userId, // W2: track who created the task
      assignee_id: dto.assigneeId,
      due_date: undefined,
    });

    // Handle tag associations
    if (dto.tagIds && dto.tagIds.length > 0) {
      const tags = await this.tagRepository.findBy({ id: In(dto.tagIds) });
      task.tags = tags;
    }

    const saved = await this.taskRepository.save(task);

    // Return with relations loaded
    return this.findOne(saved.id);
  }

  /**
   * W2 + X2: Find one task with project, assignee, tags loaded
   * AND commentCount exposed without loading every comment row.
   */
  async findOne(id: number): Promise<Task> {
    const task = await this.taskRepository
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .leftJoinAndSelect('task.tags', 'tags')
      .loadRelationCountAndMap('task.commentCount', 'task.comments')
      .where('task.id = :id', { id })
      .getOne();

    if (!task) {
      throw new NotFoundException(`Task with id ${id} not found`);
    }

    return task;
  }

  /** C2 + X1: List tasks with combinable filters and pagination. */
  async findAll(query: ListTasksQuery): Promise<PaginatedResult> {
    const qb = this.taskRepository.createQueryBuilder('task');

    // C2: Combinable filters — only add WHERE when the parameter is present
    if (query.status) {
      qb.andWhere('task.status = :status', { status: query.status });
    }

    if (query.projectId) {
      qb.andWhere('task.project_id = :projectId', { projectId: query.projectId });
    }

    if (query.assigneeId) {
      qb.andWhere('task.assignee_id = :assigneeId', { assigneeId: query.assigneeId });
    }

    // X1: Pagination
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0
      ? Math.min(query.pageSize, 100) // cap at 100
      : 20; // default

    qb.skip((page - 1) * pageSize).take(pageSize);
    qb.orderBy('task.created_at', 'DESC');

    const [items, total] = await qb.getManyAndCount();

    return { items, total, page };
  }

  /**
   * C3 + X1: Partial update with resource-ownership check.
   * X1: Only the task's creator, assignee, or a project owner may edit.
   * 404 if task not found. 403 if ownership check fails.
   */
  async update(id: number, dto: UpdateTaskDto, userId: number): Promise<Task> {
    const task = await this.findOne(id); // throws 404

    // X1: Resource-ownership guard
    // Creator and assignee can always edit their own task
    const isCreator = task.creator_id === userId;
    const isAssignee = task.assignee_id === userId;

    if (!isCreator && !isAssignee) {
      // Check if user is project owner — owners bypass ownership check
      const membership = await this.memberRepository.findOne({
        where: { user_id: userId, project_id: task.project_id },
      });

      if (!membership || membership.role !== 'owner') {
        throw new ForbiddenException(
          'Only the task creator, assignee, or project owner may edit this task',
        );
      }
    }

    // C4: Validate any changed relations
    await this.validateRelations(dto);

    // Apply partial updates
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.projectId !== undefined) task.project_id = dto.projectId;
    if (dto.assigneeId !== undefined) task.assignee_id = dto.assigneeId;

    if (dto.tagIds !== undefined) {
      const tags = await this.tagRepository.findBy({ id: In(dto.tagIds) });
      task.tags = tags;
    }

    await this.taskRepository.save(task);

    return this.findOne(id);
  }

  /** C3: Delete. 404 if missing. */
  async remove(id: number): Promise<void> {
    const task = await this.taskRepository.findOneBy({ id });
    if (!task) {
      throw new NotFoundException(`Task with id ${id} not found`);
    }
    await this.taskRepository.remove(task);
  }
}
