import { IsUUID } from 'class-validator';

export class CreateServiceDependencyDto {
  @IsUUID()
  depends_on_service_id!: string;
}
