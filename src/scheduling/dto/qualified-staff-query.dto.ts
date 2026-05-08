import { IsOptional, Matches } from 'class-validator';

export class QualifiedStaffQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'start_time must be HH:MM' })
  start_time?: string;
}
