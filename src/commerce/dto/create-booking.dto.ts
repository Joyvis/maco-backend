import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export enum CreateBookingItemType {
  SERVICE = 'service',
  PRODUCT = 'product',
  COMBO = 'combo',
}

export enum CreateBookingFulfillment {
  APPOINTMENT = 'appointment',
  PICKUP = 'pickup',
}

export class CreateBookingItemDto {
  @IsEnum(CreateBookingItemType)
  catalog_item_type!: CreateBookingItemType;

  @IsUUID()
  catalog_item_id!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  assigned_staff_id?: string;
}

export class CreateBookingDto {
  // ── New cart-style payload ────────────────────────────────────────────────
  @IsOptional()
  @IsEnum(CreateBookingFulfillment)
  fulfillment?: CreateBookingFulfillment;

  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @IsOptional()
  @IsString()
  shop_slug?: string;

  @IsOptional()
  @IsISO8601()
  scheduled_start_at?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBookingItemDto)
  items?: CreateBookingItemDto[];

  // ── Legacy single-service payload (kept for backwards compat) ─────────────
  @IsOptional()
  @IsUUID()
  service_id?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'start_time must be HH:MM' })
  start_time?: string;

  @IsOptional()
  @IsUUID()
  staff_id?: string;
}
