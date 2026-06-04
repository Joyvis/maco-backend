import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  Category as CategoryDto,
  CategoryResponse,
  ListCategoriesResponse,
} from './dto/category.dto';
import {
  Combo as ComboDto,
  ComboItem as ComboItemResponseDto,
  ComboResponse,
  ComboSummary as ComboSummaryDto,
  ListCombosResponse,
} from './dto/combo.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateComboDto } from './dto/create-combo.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateServiceConsumptionDto } from './dto/create-service-consumption.dto';
import { CreateServiceDependencyDto } from './dto/create-service-dependency.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListCombosQueryDto } from './dto/list-combos-query.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { ListProductsResponse, Product as ProductDto, ProductResponse } from './dto/product.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import {
  ListServiceConsumptionsResponse,
  ListServiceDependenciesResponse,
  ListServicesResponse,
  Service as ServiceDto,
  ServiceConsumption as ServiceConsumptionDto,
  ServiceConsumptionResponse,
  ServiceDependency as ServiceDependencyDto,
  ServiceDependencyResponse,
  ServiceResponse,
} from './dto/service.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateComboDto } from './dto/update-combo.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { Category } from './entities/category.entity';
import { ComboItem, ComboItemType } from './entities/combo-item.entity';
import { Combo, ComboStatus } from './entities/combo.entity';
import { Product, ProductStatus } from './entities/product.entity';
import { ServiceConsumption } from './entities/service-consumption.entity';
import { ServiceDependency } from './entities/service-dependency.entity';
import { Service, ServiceStatus } from './entities/service.entity';

const NO_TENANT_FILTER = { filters: { tenant: false } } as const;

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: EntityRepository<Product>,
    @InjectRepository(Category) private readonly categoryRepo: EntityRepository<Category>,
    @InjectRepository(Service) private readonly serviceRepo: EntityRepository<Service>,
    @InjectRepository(ServiceConsumption)
    private readonly consumptionRepo: EntityRepository<ServiceConsumption>,
    @InjectRepository(ServiceDependency)
    private readonly dependencyRepo: EntityRepository<ServiceDependency>,
    @InjectRepository(Combo) private readonly comboRepo: EntityRepository<Combo>,
    private readonly em: EntityManager,
  ) {}

  async listProducts(tenantId: string, query: ListProductsQueryDto): Promise<ListProductsResponse> {
    const page = query.page ?? 1;
    const page_size = query.page_size ?? 20;

    const where: Record<string, unknown> = { tenant_id: tenantId };
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;

    const [items, total] = await this.productRepo.findAndCount(where, {
      orderBy: { created_at: 'desc' },
      limit: page_size,
      offset: (page - 1) * page_size,
      filters: { tenant: false },
    });

    return {
      data: items.map((p) => this.toProductDto(p)),
      meta: {
        total,
        page,
        page_size,
        total_pages: Math.max(1, Math.ceil(total / page_size)),
      },
    };
  }

  async createProduct(tenantId: string, dto: CreateProductDto): Promise<ProductResponse> {
    const category = await this.resolveCategory(tenantId, dto.category);

    const product = new Product();
    product.tenant_id = tenantId;
    product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (category) product.category = category;
    product.unit = dto.unit;
    product.base_price = dto.base_price.toFixed(2);
    product.status = ProductStatus.DRAFT;

    await this.em.persistAndFlush(product);

    return { data: this.toProductDto(product) };
  }

  async getProduct(tenantId: string, id: string): Promise<ProductResponse> {
    const product = await this.findProductOrThrow(tenantId, id);
    return { data: this.toProductDto(product) };
  }

  async updateProduct(
    tenantId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    const product = await this.findProductOrThrow(tenantId, id);

    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.unit !== undefined) product.unit = dto.unit;
    if (dto.base_price !== undefined) product.base_price = dto.base_price.toFixed(2);
    if (dto.category !== undefined) {
      const category = await this.resolveCategory(tenantId, dto.category);
      product.category = category ?? undefined;
    }

    await this.em.flush();
    return { data: this.toProductDto(product) };
  }

  async setProductStatus(
    tenantId: string,
    id: string,
    status: ProductStatus,
  ): Promise<ProductResponse> {
    const product = await this.findProductOrThrow(tenantId, id);
    product.status = status;
    await this.em.flush();
    return { data: this.toProductDto(product) };
  }

  async listCategories(tenantId: string): Promise<ListCategoriesResponse> {
    const items = await this.categoryRepo.find(
      { tenant_id: tenantId },
      {
        orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
        filters: { tenant: false },
      },
    );
    return { data: items.map((c) => this.toCategoryDto(c)) };
  }

  async createCategory(tenantId: string, dto: CreateCategoryDto): Promise<CategoryResponse> {
    const category = new Category();
    category.tenant_id = tenantId;
    category.name = dto.name;
    await this.em.persistAndFlush(category);
    return { data: this.toCategoryDto(category) };
  }

  async updateCategory(
    tenantId: string,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<CategoryResponse> {
    const category = await this.categoryRepo.findOne({ id, tenant_id: tenantId }, NO_TENANT_FILTER);
    if (!category) throw new NotFoundException('Category not found');

    if (dto.name !== undefined) category.name = dto.name;
    if (dto.display_order !== undefined) category.display_order = dto.display_order;

    await this.em.flush();
    return { data: this.toCategoryDto(category) };
  }

  async reorderCategories(tenantId: string, dto: ReorderCategoriesDto): Promise<void> {
    await this.em.transactional(async (em) => {
      const uniqueIds = [...new Set(dto.items.map((i) => i.id))];
      const categories = await em.find(
        Category,
        { id: { $in: uniqueIds }, tenant_id: tenantId },
        NO_TENANT_FILTER,
      );

      if (categories.length !== uniqueIds.length) {
        throw new NotFoundException('One or more categories not found');
      }

      const orderById = new Map(dto.items.map((i) => [i.id, i.display_order]));
      for (const c of categories) {
        const order = orderById.get(c.id);
        if (order !== undefined) c.display_order = order;
      }
    });
  }

  async deleteCategory(tenantId: string, id: string): Promise<void> {
    const category = await this.categoryRepo.findOne({ id, tenant_id: tenantId }, NO_TENANT_FILTER);
    if (!category) throw new NotFoundException('Category not found');

    const refCount = await this.productRepo.count(
      { category: id, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (refCount > 0) {
      throw new ConflictException('Category is referenced by one or more products');
    }

    await this.em.removeAndFlush(category);
  }

  private async findProductOrThrow(tenantId: string, id: string): Promise<Product> {
    const product = await this.productRepo.findOne({ id, tenant_id: tenantId }, NO_TENANT_FILTER);
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async resolveCategory(tenantId: string, categoryId?: string): Promise<Category | null> {
    if (!categoryId) return null;
    const category = await this.categoryRepo.findOne(
      { id: categoryId, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (!category) throw new BadRequestException('Category not found');
    return category;
  }

  private toProductDto(product: Product): ProductDto {
    return {
      id: product.id,
      name: product.name,
      description: product.description,
      category: product.category?.id,
      unit: product.unit,
      base_price: Number(product.base_price),
      status: product.status,
      created_at: product.created_at.toISOString(),
    };
  }

  private toCategoryDto(category: Category): CategoryDto {
    return {
      id: category.id,
      name: category.name,
      display_order: category.display_order,
    };
  }

  async listServices(tenantId: string, query: ListServicesQueryDto): Promise<ListServicesResponse> {
    const page = query.page ?? 1;
    const page_size = query.page_size ?? 10;

    const where: Record<string, unknown> = { tenant_id: tenantId };
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.bookable === true) {
      const rows = (await this.em
        .getConnection()
        .execute('select distinct service_id from staff_qualifications where tenant_id = ?', [
          tenantId,
        ])) as Array<{ service_id: string }>;
      const bookableIds = rows.map((r) => r.service_id);
      if (bookableIds.length === 0) {
        return {
          data: [],
          meta: { total: 0, page, page_size, total_pages: 1 },
        };
      }
      where.id = { $in: bookableIds };
    }

    const [items, total] = await this.serviceRepo.findAndCount(where, {
      orderBy: { created_at: 'desc' },
      limit: page_size,
      offset: (page - 1) * page_size,
      filters: { tenant: false },
    });

    return {
      data: items.map((s) => this.toServiceDto(s)),
      meta: {
        total,
        page,
        page_size,
        total_pages: Math.max(1, Math.ceil(total / page_size)),
      },
    };
  }

  async createService(tenantId: string, dto: CreateServiceDto): Promise<ServiceResponse> {
    const category = await this.resolveCategory(tenantId, dto.category);

    const service = new Service();
    service.tenant_id = tenantId;
    service.name = dto.name.trim();
    if (dto.description !== undefined) service.description = dto.description;
    if (category) service.category = category;
    service.duration_minutes = dto.duration_minutes;
    service.base_price = dto.base_price.toFixed(2);
    service.status = ServiceStatus.DRAFT;

    await this.em.persistAndFlush(service);
    return { data: this.toServiceDto(service) };
  }

  async getService(tenantId: string, id: string): Promise<ServiceResponse> {
    const service = await this.findServiceOrThrow(tenantId, id);
    return { data: this.toServiceDto(service) };
  }

  async updateService(
    tenantId: string,
    id: string,
    dto: UpdateServiceDto,
  ): Promise<ServiceResponse> {
    const service = await this.findServiceOrThrow(tenantId, id);

    if (dto.name !== undefined) service.name = dto.name.trim();
    if (dto.description !== undefined) service.description = dto.description;
    if (dto.duration_minutes !== undefined) service.duration_minutes = dto.duration_minutes;
    if (dto.base_price !== undefined) service.base_price = dto.base_price.toFixed(2);
    if (dto.category !== undefined) {
      const category = await this.resolveCategory(tenantId, dto.category);
      service.category = category ?? undefined;
    }

    await this.em.flush();
    return { data: this.toServiceDto(service) };
  }

  async setServiceStatus(
    tenantId: string,
    id: string,
    status: ServiceStatus,
  ): Promise<ServiceResponse> {
    const service = await this.findServiceOrThrow(tenantId, id);
    if (service.status !== status) {
      service.status = status;
      await this.em.flush();
    }
    return { data: this.toServiceDto(service) };
  }

  async listServiceConsumptions(
    tenantId: string,
    serviceId: string,
  ): Promise<ListServiceConsumptionsResponse> {
    await this.findServiceOrThrow(tenantId, serviceId);
    const items = await this.consumptionRepo.find(
      { tenant_id: tenantId, service: serviceId },
      { populate: ['product'], orderBy: { created_at: 'asc' }, filters: { tenant: false } },
    );
    return { data: items.map((c) => this.toConsumptionDto(c)) };
  }

  async addServiceConsumption(
    tenantId: string,
    serviceId: string,
    dto: CreateServiceConsumptionDto,
  ): Promise<ServiceConsumptionResponse> {
    const service = await this.findServiceOrThrow(tenantId, serviceId);
    const product = await this.productRepo.findOne(
      { id: dto.product_id, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (!product) throw new BadRequestException('Product not found');

    const existing = await this.consumptionRepo.findOne(
      { tenant_id: tenantId, service: service.id, product: product.id },
      NO_TENANT_FILTER,
    );
    if (existing) {
      throw new ConflictException('Consumption already exists for this product');
    }

    const consumption = new ServiceConsumption();
    consumption.tenant_id = tenantId;
    consumption.service = service;
    consumption.product = product;
    consumption.quantity = dto.quantity.toFixed(3);

    await this.em.persistAndFlush(consumption);
    return { data: this.toConsumptionDto(consumption) };
  }

  async removeServiceConsumption(
    tenantId: string,
    serviceId: string,
    productId: string,
  ): Promise<void> {
    await this.findServiceOrThrow(tenantId, serviceId);
    const consumption = await this.consumptionRepo.findOne(
      { tenant_id: tenantId, service: serviceId, product: productId },
      NO_TENANT_FILTER,
    );
    if (!consumption) throw new NotFoundException('Consumption not found');
    await this.em.removeAndFlush(consumption);
  }

  async listServiceDependencies(
    tenantId: string,
    serviceId: string,
  ): Promise<ListServiceDependenciesResponse> {
    await this.findServiceOrThrow(tenantId, serviceId);
    const items = await this.dependencyRepo.find(
      { tenant_id: tenantId, service: serviceId },
      {
        populate: ['depends_on_service'],
        orderBy: { created_at: 'asc' },
        filters: { tenant: false },
      },
    );
    return { data: items.map((d) => this.toDependencyDto(d)) };
  }

  async addServiceDependency(
    tenantId: string,
    serviceId: string,
    dto: CreateServiceDependencyDto,
  ): Promise<ServiceDependencyResponse> {
    if (serviceId === dto.depends_on_service_id) {
      throw new BadRequestException('Service cannot depend on itself');
    }
    const service = await this.findServiceOrThrow(tenantId, serviceId);
    const target = await this.serviceRepo.findOne(
      { id: dto.depends_on_service_id, tenant_id: tenantId },
      NO_TENANT_FILTER,
    );
    if (!target) throw new BadRequestException('Dependency target service not found');

    const existing = await this.dependencyRepo.findOne(
      { tenant_id: tenantId, service: service.id, depends_on_service: target.id },
      NO_TENANT_FILTER,
    );
    if (existing) throw new ConflictException('Dependency already exists');

    const dep = new ServiceDependency();
    dep.tenant_id = tenantId;
    dep.service = service;
    dep.depends_on_service = target;
    if (dto.auto_include !== undefined) dep.auto_include = dto.auto_include;

    await this.em.persistAndFlush(dep);
    return { data: this.toDependencyDto(dep) };
  }

  async removeServiceDependency(
    tenantId: string,
    serviceId: string,
    dependencyId: string,
  ): Promise<void> {
    await this.findServiceOrThrow(tenantId, serviceId);
    const dep = await this.dependencyRepo.findOne(
      { id: dependencyId, tenant_id: tenantId, service: serviceId },
      NO_TENANT_FILTER,
    );
    if (!dep) throw new NotFoundException('Dependency not found');
    await this.em.removeAndFlush(dep);
  }

  private async findServiceOrThrow(tenantId: string, id: string): Promise<Service> {
    const service = await this.serviceRepo.findOne({ id, tenant_id: tenantId }, NO_TENANT_FILTER);
    if (!service) throw new NotFoundException('Service not found');
    return service;
  }

  private toServiceDto(service: Service): ServiceDto {
    return {
      id: service.id,
      tenant_id: service.tenant_id,
      name: service.name,
      description: service.description ?? null,
      category: service.category?.id ?? null,
      status: service.status,
      duration_minutes: service.duration_minutes,
      base_price: Number(service.base_price),
      created_at: service.created_at.toISOString(),
      updated_at: service.updated_at.toISOString(),
    };
  }

  private toConsumptionDto(consumption: ServiceConsumption): ServiceConsumptionDto {
    const product = consumption.product;
    return {
      id: consumption.id,
      service_id: consumption.service.id,
      product_id: product.id,
      quantity: Number(consumption.quantity),
      unit: product.unit,
      product_name: product.name,
      created_at: consumption.created_at.toISOString(),
    };
  }

  private toDependencyDto(dep: ServiceDependency): ServiceDependencyDto {
    return {
      id: dep.id,
      service_id: dep.depends_on_service.id,
      service_name: dep.depends_on_service.name,
      depends_on_service_id: dep.depends_on_service.id,
      depends_on_service_name: dep.depends_on_service.name,
      auto_include: dep.auto_include,
      created_at: dep.created_at.toISOString(),
    };
  }

  async listCombos(tenantId: string, query: ListCombosQueryDto): Promise<ListCombosResponse> {
    const page = query.page ?? 1;
    const page_size = query.page_size ?? 20;

    const where: Record<string, unknown> = { tenant_id: tenantId };
    if (query.status) where.status = query.status;

    const [combos, total] = await this.comboRepo.findAndCount(where, {
      orderBy: { created_at: 'desc' },
      limit: page_size,
      offset: (page - 1) * page_size,
      filters: { tenant: false },
    });

    const counts = new Map<string, number>();
    if (combos.length > 0) {
      const ids = combos.map((c) => c.id);
      const rows = (await this.em.getConnection().execute(
        `select combo_id, count(*)::int as item_count from combo_items
           where tenant_id = ? and combo_id in (${ids.map(() => '?').join(',')})
           group by combo_id`,
        [tenantId, ...ids],
      )) as Array<{ combo_id: string; item_count: string | number }>;
      for (const r of rows) counts.set(r.combo_id, Number(r.item_count) || 0);
    }

    return {
      data: combos.map((c) => this.toComboSummaryDto(c, counts.get(c.id) ?? 0)),
      meta: {
        total,
        page,
        page_size,
        total_pages: Math.max(1, Math.ceil(total / page_size)),
      },
    };
  }

  async createCombo(tenantId: string, dto: CreateComboDto): Promise<ComboResponse> {
    return this.em.transactional(async (em) => {
      const resolved = await this.resolveComboItems(em, tenantId, dto.items);

      const combo = new Combo();
      combo.tenant_id = tenantId;
      combo.name = dto.name.trim();
      if (dto.description !== undefined) combo.description = dto.description;
      combo.discount_percentage = dto.discount_percentage.toFixed(2);
      combo.status = ComboStatus.ACTIVE;

      em.persist(combo);

      for (const r of resolved) {
        const item = new ComboItem();
        item.tenant_id = tenantId;
        item.combo = combo;
        item.item_type = r.item_type;
        if (r.item_type === ComboItemType.SERVICE) {
          item.service = r.service;
        } else {
          item.product = r.product;
        }
        em.persist(item);
        combo.items.add(item);
      }

      await em.flush();
      return { data: this.toComboDto(combo) };
    });
  }

  async getCombo(tenantId: string, id: string): Promise<ComboResponse> {
    const combo = await this.comboRepo.findOne({ id, tenant_id: tenantId }, NO_TENANT_FILTER);
    if (!combo) throw new NotFoundException('Combo not found');
    await this.em.populate(combo, ['items.service', 'items.product'], NO_TENANT_FILTER);
    return { data: this.toComboDto(combo) };
  }

  async updateCombo(tenantId: string, id: string, dto: UpdateComboDto): Promise<ComboResponse> {
    return this.em.transactional(async (em) => {
      const combo = await em.findOne(Combo, { id, tenant_id: tenantId }, NO_TENANT_FILTER);
      if (!combo) throw new NotFoundException('Combo not found');
      await em.populate(combo, ['items.service', 'items.product'], NO_TENANT_FILTER);

      if (dto.name !== undefined) combo.name = dto.name.trim();
      if (dto.description !== undefined) combo.description = dto.description;
      if (dto.discount_percentage !== undefined) {
        combo.discount_percentage = dto.discount_percentage.toFixed(2);
      }

      if (dto.items !== undefined) {
        const resolved = await this.resolveComboItems(em, tenantId, dto.items);
        combo.items.removeAll();
        await em.flush();

        for (const r of resolved) {
          const item = new ComboItem();
          item.tenant_id = tenantId;
          item.combo = combo;
          item.item_type = r.item_type;
          if (r.item_type === ComboItemType.SERVICE) {
            item.service = r.service;
          } else {
            item.product = r.product;
          }
          em.persist(item);
          combo.items.add(item);
        }
      }

      await em.flush();
      return { data: this.toComboDto(combo) };
    });
  }

  async setComboStatus(tenantId: string, id: string, status: ComboStatus): Promise<ComboResponse> {
    const combo = await this.comboRepo.findOne({ id, tenant_id: tenantId }, NO_TENANT_FILTER);
    if (!combo) throw new NotFoundException('Combo not found');

    if (combo.status !== status) {
      combo.status = status;
      await this.em.flush();
    }
    await this.em.populate(combo, ['items.service', 'items.product'], NO_TENANT_FILTER);
    return { data: this.toComboDto(combo) };
  }

  private async resolveComboItems(
    em: EntityManager,
    tenantId: string,
    items: Array<{ item_type: ComboItemType; item_id: string }>,
  ): Promise<
    Array<
      | { item_type: ComboItemType.SERVICE; service: Service }
      | { item_type: ComboItemType.PRODUCT; product: Product }
    >
  > {
    const seen = new Set<string>();
    const resolved: Array<
      | { item_type: ComboItemType.SERVICE; service: Service }
      | { item_type: ComboItemType.PRODUCT; product: Product }
    > = [];

    for (const i of items) {
      const key = `${i.item_type}:${i.item_id}`;
      if (seen.has(key)) {
        throw new BadRequestException(`Duplicate combo item: ${key}`);
      }
      seen.add(key);

      if (i.item_type === ComboItemType.SERVICE) {
        const service = await em.findOne(
          Service,
          { id: i.item_id, tenant_id: tenantId },
          NO_TENANT_FILTER,
        );
        if (!service) throw new BadRequestException(`Invalid combo item: ${key}`);
        resolved.push({ item_type: ComboItemType.SERVICE, service });
      } else {
        const product = await em.findOne(
          Product,
          { id: i.item_id, tenant_id: tenantId },
          NO_TENANT_FILTER,
        );
        if (!product) throw new BadRequestException(`Invalid combo item: ${key}`);
        resolved.push({ item_type: ComboItemType.PRODUCT, product });
      }
    }

    return resolved;
  }

  private toComboSummaryDto(combo: Combo, item_count: number): ComboSummaryDto {
    return {
      id: combo.id,
      name: combo.name,
      description: combo.description,
      discount_percentage: Number(combo.discount_percentage),
      status: combo.status,
      item_count,
      created_at: combo.created_at.toISOString(),
    };
  }

  private toComboDto(combo: Combo): ComboDto {
    const items: ComboItemResponseDto[] = combo.items.getItems().map((item) => {
      if (item.item_type === ComboItemType.SERVICE) {
        const service = item.service!;
        return {
          id: item.id,
          item_type: ComboItemType.SERVICE,
          item_id: service.id,
          name: service.name,
          base_price: Number(service.base_price),
        };
      }
      const product = item.product!;
      return {
        id: item.id,
        item_type: ComboItemType.PRODUCT,
        item_id: product.id,
        name: product.name,
        base_price: Number(product.base_price),
      };
    });

    return {
      ...this.toComboSummaryDto(combo, items.length),
      items,
    };
  }
}
