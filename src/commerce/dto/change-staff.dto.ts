import { IsUUID } from 'class-validator';

export class ChangeStaffDto {
  // Target staff that the source's items should be reassigned to.
  @IsUUID()
  staff_id!: string;

  // Source staff whose items are being moved. Required so the swap is scoped
  // to a single agenda block — moving Ana's items to Carla must leave Bruno's
  // unrelated items untouched, even though they live on the same order.
  @IsUUID()
  from_staff_id!: string;
}
