import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  body: string;

  /**
   * W2: authorId is now optional — the authenticated user (@CurrentUser)
   * is used as the comment author. If provided, it is ignored by the service.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  authorId?: number;
}
