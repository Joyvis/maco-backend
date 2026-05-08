import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CurrentUser } from '@tenancy/auth/current-user.decorator';
import { RequestUser } from '@tenancy/auth/jwt-payload.interface';

import { AvailabilityQueryDto } from './dto/availability-query.dto';
import { AvailabilitySlot, QualifiedStaff, TimeSlot } from './dto/availability.dto';
import { QualifiedStaffQueryDto } from './dto/qualified-staff-query.dto';
import { SchedulingService } from './scheduling.service';

@Controller()
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get('availability')
  async getAvailability(
    @Query() query: AvailabilityQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: TimeSlot[] | AvailabilitySlot[] }> {
    const result = await this.schedulingService.getAvailability(user.tenantId, query);
    return { data: result.slots };
  }

  @Get('services/:id/qualified-staff')
  async getQualifiedStaff(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: QualifiedStaffQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: QualifiedStaff[] }> {
    const hasDate = query.date !== undefined;
    const hasStart = query.start_time !== undefined;
    if (hasDate !== hasStart) {
      throw new BadRequestException('date and start_time must be provided together');
    }
    const filter =
      hasDate && hasStart ? { date: query.date!, start_time: query.start_time! } : undefined;
    const data = await this.schedulingService.getQualifiedStaff(user.tenantId, id, filter);
    return { data };
  }
}
