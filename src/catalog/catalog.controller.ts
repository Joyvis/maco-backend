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
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListProductsResponse, ProductResponse } from './dto/product.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductStatus } from './entities/product.entity';

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
}
