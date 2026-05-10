import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Matches, Min } from 'class-validator';

export class ShopAvailabilityQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_from must be YYYY-MM-DD' })
  date_from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_to must be YYYY-MM-DD' })
  date_to?: string;

  @IsOptional()
  @IsISO8601()
  anchor_at?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset_minutes?: number;
}
