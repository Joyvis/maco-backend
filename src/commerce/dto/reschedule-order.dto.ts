import { IsISO8601 } from 'class-validator';

export class RescheduleOrderDto {
  @IsISO8601()
  new_datetime!: string;
}
