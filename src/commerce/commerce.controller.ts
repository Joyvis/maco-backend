import { Controller } from "@nestjs/common";
import { CommerceService } from "./commerce.service";

@Controller("commerce")
export class CommerceController {
  constructor(private readonly commerceService: CommerceService) {}
}
