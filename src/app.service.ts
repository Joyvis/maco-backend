import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /** Returns the default landing-page greeting. */
  getHello(): string {
    return 'Hello World!';
  }
}
