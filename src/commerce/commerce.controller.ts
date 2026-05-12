import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '@tenancy/auth/current-user.decorator';
import { RequestUser } from '@tenancy/auth/jwt-payload.interface';
import { Roles } from '@tenancy/auth/roles.decorator';
import { RolesGuard } from '@tenancy/auth/roles.guard';

import { CommerceService } from './commerce.service';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { BookingResultDto, RefundPolicyDto, SaleOrderResponseDto } from './dto/sale-order.dto';

@Controller()
export class CommerceController {
  constructor(private readonly commerceService: CommerceService) {}

  @Post('sale-orders')
  @HttpCode(HttpStatus.CREATED)
  async createBooking(
    @Body() dto: CreateBookingDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: BookingResultDto }> {
    const data = await this.commerceService.createBooking(user.tenantId, user.id, dto);
    return { data };
  }

  @Get('sale-orders')
  async listOrders(
    @Query() query: ListOrdersQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{
    data: SaleOrderResponseDto[];
    meta: { total: number; page: number; page_size: number };
  }> {
    const customerId = query.customer_id === 'me' || !query.customer_id ? user.id : user.id;
    return this.commerceService.listMyOrders(user.tenantId, customerId, query);
  }

  @Post('sale-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: SaleOrderResponseDto }> {
    const data = await this.commerceService.cancelOrder(user.tenantId, user.id, id, dto);
    return { data };
  }

  @Post('sale-orders/:id/reschedule')
  @HttpCode(HttpStatus.OK)
  async reschedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RescheduleOrderDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: SaleOrderResponseDto }> {
    const data = await this.commerceService.rescheduleOrder(user.tenantId, user.id, id, dto);
    return { data };
  }

  @Post('sale-orders/:id/mark-picked-up')
  @HttpCode(HttpStatus.OK)
  async markPickedUp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: SaleOrderResponseDto }> {
    const data = await this.commerceService.markPickedUp(user.tenantId, user.id, id);
    return { data };
  }

  @Post('sale-orders/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'ta')
  async checkIn(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: SaleOrderResponseDto }> {
    const data = await this.commerceService.checkIn(user.tenantId, user.id, id);
    return { data };
  }

  @Post('sale-orders/:id/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'ta')
  async start(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: SaleOrderResponseDto }> {
    const data = await this.commerceService.start(user.tenantId, user.id, id);
    return { data };
  }

  @Post('sale-orders/:id/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'ta')
  async complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: SaleOrderResponseDto }> {
    const data = await this.commerceService.complete(user.tenantId, user.id, id);
    return { data };
  }

  @Post('sale-orders/:id/no-show')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('owner', 'ta')
  async noShow(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ data: SaleOrderResponseDto }> {
    const data = await this.commerceService.noShow(user.tenantId, user.id, id);
    return { data };
  }

  @Get('refund-policies')
  async refundPolicies(@CurrentUser() user: RequestUser): Promise<{ data: RefundPolicyDto[] }> {
    const data = await this.commerceService.listRefundPolicies(user.tenantId);
    return { data };
  }
}
