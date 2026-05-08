import { IsEnum, IsUUID } from 'class-validator';

import { ComboItemType } from '../entities/combo-item.entity';

export class ComboItemDto {
  @IsEnum(ComboItemType)
  item_type!: ComboItemType;

  @IsUUID()
  item_id!: string;
}
