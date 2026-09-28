import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  name: string;

  /**
   * W2: ownerId is now optional — the authenticated user (@CurrentUser)
   * is used as the project owner. If provided, it is ignored by the service.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  ownerId?: number;
}
