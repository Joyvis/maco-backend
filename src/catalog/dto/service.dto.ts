export type ServiceStatus = 'draft' | 'active' | 'archived';

export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  category: string | null;
  status: ServiceStatus;
  duration_minutes: number;
  base_price: number;
  created_at: string;
  updated_at: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ListServicesResponse {
  data: Service[];
  meta: PaginationMeta;
}

export interface ServiceResponse {
  data: Service;
}

export interface ServiceConsumption {
  id: string;
  service_id: string;
  product_id: string;
  quantity: number;
  unit?: string;
  product_name?: string;
  created_at: string;
}

export interface ListServiceConsumptionsResponse {
  data: ServiceConsumption[];
}

export interface ServiceConsumptionResponse {
  data: ServiceConsumption;
}

export interface ServiceDependency {
  id: string;
  service_id: string;
  depends_on_service_id: string;
  depends_on_service_name?: string;
  created_at: string;
}

export interface ListServiceDependenciesResponse {
  data: ServiceDependency[];
}

export interface ServiceDependencyResponse {
  data: ServiceDependency;
}
