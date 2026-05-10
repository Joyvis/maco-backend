import { IsISO8601, IsOptional } from 'class-validator';

export class ShopStaffQueryDto {
  @IsOptional()
  @IsISO8601()
  slot_start_at?: string;
}
