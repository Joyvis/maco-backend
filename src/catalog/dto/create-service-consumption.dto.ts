import { IsNumber, IsUUID, Min } from 'class-validator';

export class CreateServiceConsumptionDto {
  @IsUUID()
  product_id!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity!: number;
}
