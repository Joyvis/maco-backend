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
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListProductsResponse, Product as ProductDto, ProductResponse } from './dto/product.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Category } from './entities/category.entity';
import { Product, ProductStatus } from './entities/product.entity';

const NO_TENANT_FILTER = { filters: { tenant: false } } as const;

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Product) private readonly productRepo: EntityRepository<Product>,
    @InjectRepository(Category) private readonly categoryRepo: EntityRepository<Category>,
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
}
