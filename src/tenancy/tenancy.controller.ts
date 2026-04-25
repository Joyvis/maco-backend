import { Controller } from "@nestjs/common";
import { TenancyService } from "./tenancy.service";

@Controller("tenancy")
export class TenancyController {
  constructor(private readonly tenancyService: TenancyService) {}
}
