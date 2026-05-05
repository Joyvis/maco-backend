import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateServiceDto {
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

  @IsInt()
  @Min(1)
  duration_minutes!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  base_price!: number;
}
