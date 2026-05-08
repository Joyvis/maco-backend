import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  service_id!: string;

  @IsString()
  shop_slug!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @Matches(/^\d{2}:\d{2}$/, { message: 'start_time must be HH:MM' })
  start_time!: string;

  @IsOptional()
  @IsUUID()
  staff_id?: string;
}
