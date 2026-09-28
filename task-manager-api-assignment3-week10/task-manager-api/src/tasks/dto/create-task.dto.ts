import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  MinLength,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TaskStatus } from '../../entities/task.entity';

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskStatus, {
    message: `status must be one of: ${Object.values(TaskStatus).join(', ')}`,
  })
  status?: TaskStatus = TaskStatus.TODO;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  priority?: number;

  @IsInt()
  @Type(() => Number)
  projectId: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  assigneeId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];
}
