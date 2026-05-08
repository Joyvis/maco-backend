import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class AvailabilityQueryDto {
  @IsOptional()
  @IsUUID()
  service_id?: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'end_date must be YYYY-MM-DD' })
  end_date?: string;

  @IsOptional()
  @IsString()
  shop_slug?: string;

  @IsOptional()
  @IsUUID()
  staff_id?: string;

  @IsOptional()
  @IsUUID()
  order_id?: string;
}
