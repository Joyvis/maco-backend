export interface ShopServiceDto {
  id: string;
  name: string;
  description?: string;
  category?: string;
  duration_minutes: number;
  base_price: number;
}

export interface ShopStaffQualifiedServiceDto {
  id: string;
  name: string;
}

export interface ShopStaffDto {
  user_id: string;
  name: string;
  photo_url?: string;
  qualified_services: ShopStaffQualifiedServiceDto[];
}

export interface ShopProfileDto {
  slug: string;
  name: string;
  logo_url?: string;
  city?: string;
  rating?: number;
  services: ShopServiceDto[];
  staff: ShopStaffDto[];
}
