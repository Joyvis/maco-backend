import { IsDateString, IsNotEmpty } from 'class-validator';

export class AgendaQueryDto {
  @IsNotEmpty()
  @IsDateString()
  date!: string;
}
