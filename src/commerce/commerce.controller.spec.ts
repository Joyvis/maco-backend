import { EntityManager } from '@mikro-orm/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from '@payments/payments.service';

import { CommerceController } from './commerce.controller';
import { CommerceService } from './commerce.service';

describe('CommerceController', () => {
  let controller: CommerceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommerceController],
      providers: [
        CommerceService,
        { provide: EntityManager, useValue: {} },
        { provide: PaymentsService, useValue: {} },
      ],
    }).compile();

    controller = module.get<CommerceController>(CommerceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
