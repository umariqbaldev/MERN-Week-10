import {
  PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common';

/**
 * C3 (Asgn3): Validates that a route parameter is a positive integer (≥ 1).
 * Rejects zero, negative numbers, decimals, and non-numeric strings
 * before the value ever reaches the database.
 */
@Injectable()
export class ParsePositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(
        `Validation failed: "${value}" is not a positive integer`,
      );
    }

    return parsed;
  }
}
