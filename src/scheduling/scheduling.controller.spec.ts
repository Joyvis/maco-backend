import { EntityManager } from '@mikro-orm/core';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RequestUser } from '@tenancy/auth/jwt-payload.interface';

import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

describe('SchedulingController', () => {
  let controller: SchedulingController;
  let getQualifiedStaff: jest.Mock;

  beforeEach(async () => {
    getQualifiedStaff = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SchedulingController],
      providers: [
        { provide: SchedulingService, useValue: { getQualifiedStaff } },
        { provide: EntityManager, useValue: {} },
      ],
    }).compile();

    controller = module.get<SchedulingController>(SchedulingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /services/:id/qualified-staff', () => {
    const user: RequestUser = { id: 'u-1', tenantId: 't-1', roles: [] };
    const serviceId = '00000000-0000-4000-8000-000000000001';

    it('passes through with no filter when both query params are absent', async () => {
      await controller.getQualifiedStaff(serviceId, {}, user);
      expect(getQualifiedStaff).toHaveBeenCalledWith('t-1', serviceId, undefined);
    });

    it('passes the slot filter when both date and start_time are present', async () => {
      await controller.getQualifiedStaff(
        serviceId,
        { date: '2026-05-12', start_time: '09:00' },
        user,
      );
      expect(getQualifiedStaff).toHaveBeenCalledWith('t-1', serviceId, {
        date: '2026-05-12',
        start_time: '09:00',
      });
    });

    it('throws 400 when only date is provided', async () => {
      await expect(
        controller.getQualifiedStaff(serviceId, { date: '2026-05-12' }, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(getQualifiedStaff).not.toHaveBeenCalled();
    });

    it('throws 400 when only start_time is provided', async () => {
      await expect(
        controller.getQualifiedStaff(serviceId, { start_time: '09:00' }, user),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(getQualifiedStaff).not.toHaveBeenCalled();
    });
  });
});
