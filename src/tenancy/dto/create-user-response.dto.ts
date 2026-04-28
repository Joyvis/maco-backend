export class CreateUserResponseDto {
  id!: string;
  tenant_id!: string;
  email!: string;
  full_name!: string;
  phone!: string | null;
  state!: 'active';
  roles!: string[];
  created_at!: string;
}
