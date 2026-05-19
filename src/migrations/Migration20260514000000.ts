/* eslint-disable @typescript-eslint/require-await */
import { Migration } from '@mikro-orm/migrations';

export class Migration20260514000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "sale_orders"
        add column "payment_method" varchar(16) null;
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "sale_orders"
        drop column if exists "payment_method";
    `);
  }
}
