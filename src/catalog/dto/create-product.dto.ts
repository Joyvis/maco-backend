import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import { ProductUnit } from '../entities/product.entity';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  category?: string;

  @IsEnum(ProductUnit)
  unit!: ProductUnit;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_price!: number;
}
