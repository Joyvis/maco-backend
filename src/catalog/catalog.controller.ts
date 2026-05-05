import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../tenancy/auth/current-user.decorator';
import { RequestUser } from '../tenancy/auth/jwt-payload.interface';

import { CatalogService } from './catalog.service';
import { CategoryResponse, ListCategoriesResponse } from './dto/category.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateServiceConsumptionDto } from './dto/create-service-consumption.dto';
import { CreateServiceDependencyDto } from './dto/create-service-dependency.dto';
import { CreateServiceDto } from './dto/create-service.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { ListProductsResponse, ProductResponse } from './dto/product.dto';
import {
  ListServiceConsumptionsResponse,
  ListServiceDependenciesResponse,
  ListServicesResponse,
  ServiceConsumptionResponse,
  ServiceDependencyResponse,
  ServiceResponse,
} from './dto/service.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ProductStatus } from './entities/product.entity';
import { ServiceStatus } from './entities/service.entity';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('products')
  listProducts(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ListProductsResponse> {
    return this.catalogService.listProducts(user.tenantId, query);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProductResponse> {
    return this.catalogService.createProduct(user.tenantId, dto);
  }

  @Get('products/:id')
  getProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProductResponse> {
    return this.catalogService.getProduct(user.tenantId, id);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProductResponse> {
    return this.catalogService.updateProduct(user.tenantId, id, dto);
  }

  @Post('products/:id/activate')
  @HttpCode(HttpStatus.OK)
  activateProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProductResponse> {
    return this.catalogService.setProductStatus(user.tenantId, id, ProductStatus.ACTIVE);
  }

  @Post('products/:id/archive')
  @HttpCode(HttpStatus.OK)
  archiveProduct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProductResponse> {
    return this.catalogService.setProductStatus(user.tenantId, id, ProductStatus.ARCHIVED);
  }

  @Get('categories')
  listCategories(@CurrentUser() user: RequestUser): Promise<ListCategoriesResponse> {
    return this.catalogService.listCategories(user.tenantId);
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CategoryResponse> {
    return this.catalogService.createCategory(user.tenantId, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CategoryResponse> {
    return this.catalogService.updateCategory(user.tenantId, id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.catalogService.deleteCategory(user.tenantId, id);
  }

  @Get('services')
  listServices(
    @Query() query: ListServicesQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ListServicesResponse> {
    return this.catalogService.listServices(user.tenantId, query);
  }

  @Post('services')
  @HttpCode(HttpStatus.CREATED)
  createService(
    @Body() dto: CreateServiceDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ServiceResponse> {
    return this.catalogService.createService(user.tenantId, dto);
  }

  @Get('services/:id')
  getService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ServiceResponse> {
    return this.catalogService.getService(user.tenantId, id);
  }

  @Patch('services/:id')
  updateService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ServiceResponse> {
    return this.catalogService.updateService(user.tenantId, id, dto);
  }

  @Post('services/:id/activate')
  @HttpCode(HttpStatus.OK)
  activateService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ServiceResponse> {
    return this.catalogService.setServiceStatus(user.tenantId, id, ServiceStatus.ACTIVE);
  }

  @Post('services/:id/archive')
  @HttpCode(HttpStatus.OK)
  archiveService(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ServiceResponse> {
    return this.catalogService.setServiceStatus(user.tenantId, id, ServiceStatus.ARCHIVED);
  }

  @Get('services/:id/consumptions')
  listServiceConsumptions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ListServiceConsumptionsResponse> {
    return this.catalogService.listServiceConsumptions(user.tenantId, id);
  }

  @Post('services/:id/consumptions')
  @HttpCode(HttpStatus.CREATED)
  addServiceConsumption(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateServiceConsumptionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ServiceConsumptionResponse> {
    return this.catalogService.addServiceConsumption(user.tenantId, id, dto);
  }

  @Delete('services/:id/consumptions/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeServiceConsumption(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.catalogService.removeServiceConsumption(user.tenantId, id, productId);
  }

  @Get('services/:id/dependencies')
  listServiceDependencies(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ListServiceDependenciesResponse> {
    return this.catalogService.listServiceDependencies(user.tenantId, id);
  }

  @Post('services/:id/dependencies')
  @HttpCode(HttpStatus.CREATED)
  addServiceDependency(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CreateServiceDependencyDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ServiceDependencyResponse> {
    return this.catalogService.addServiceDependency(user.tenantId, id, dto);
  }

  @Delete('services/:id/dependencies/:dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeServiceDependency(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('dependencyId', new ParseUUIDPipe()) dependencyId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.catalogService.removeServiceDependency(user.tenantId, id, dependencyId);
  }
}
