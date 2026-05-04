import { EntityManager } from '@mikro-orm/core';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { Test, TestingModule } from '@nestjs/testing';

import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';

describe('CatalogController', () => {
  let controller: CatalogController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatalogController],
      providers: [
        CatalogService,
        { provide: getRepositoryToken(Product), useValue: {} },
        { provide: getRepositoryToken(Category), useValue: {} },
        { provide: EntityManager, useValue: {} },
      ],
    }).compile();

    controller = module.get<CatalogController>(CatalogController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
