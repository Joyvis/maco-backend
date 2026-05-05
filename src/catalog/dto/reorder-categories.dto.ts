import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class ReorderCategoryItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(0)
  display_order!: number;
}

export class ReorderCategoriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReorderCategoryItemDto)
  items!: ReorderCategoryItemDto[];
}
