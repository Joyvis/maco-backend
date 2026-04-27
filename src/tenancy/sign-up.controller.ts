import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { Public } from './auth/public.decorator';
import { SignUpResponseDto } from './dto/sign-up-response.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { TenancyService } from './tenancy.service';

@Controller()
export class SignUpController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Public()
  @Post('sign-up')
  @HttpCode(HttpStatus.CREATED)
  signUp(@Body() dto: SignUpDto): Promise<SignUpResponseDto> {
    return this.tenancyService.registerTenant(dto);
  }
}
