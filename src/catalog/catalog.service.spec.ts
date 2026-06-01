import { EntityManager, EntityRepository } from '@mikro-orm/core';
import { getRepositoryToken } from '@mikro-orm/nestjs';
import { Test, TestingModule } from '@nestjs/testing';

import { CatalogService } from './catalog.service';
import { ListServicesQueryDto } from './dto/list-services-query.dto';
import { Category } from './entities/category.entity';
import { Combo } from './entities/combo.entity';
import { Product } from './entities/product.entity';
import { ServiceConsumption } from './entities/service-consumption.entity';
import { ServiceDependency } from './entities/service-dependency.entity';
import { Service, ServiceStatus } from './entities/service.entity';

function makeService(id: string, name: string, status = ServiceStatus.ACTIVE): Service {
  const svc = new Service();
  svc.id = id;
  svc.tenant_id = 't-1';
  svc.name = name;
  svc.duration_minutes = 30;
  svc.base_price = '50.00';
  svc.status = status;
  svc.created_at = new Date('2026-01-01T00:00:00Z');
  return svc;
}

interface ServiceState {
  all: Service[];
  bookableIds: string[];
}

interface FindAndCountCall {
  where: Record<string, unknown>;
  options: Record<string, unknown>;
}

describe('CatalogService.listServices', () => {
  let service: CatalogService;
  let state: ServiceState;
  let lastFindAndCount: FindAndCountCall | null;

  beforeEach(async () => {
    state = { all: [], bookableIds: [] };
    lastFindAndCount = null;

    const serviceRepo: Partial<EntityRepository<Service>> = {
      findAndCount: ((where: Record<string, unknown>, options: Record<string, unknown>) => {
        lastFindAndCount = { where, options };
        let items = state.all;
        if (where['status']) {
          items = items.filter((s) => s.status === where['status']);
        }
        const idFilter = where['id'] as { $in?: string[] } | undefined;
        if (idFilter?.$in) {
          items = items.filter((s) => idFilter.$in?.includes(s.id));
        }
        const offset = (options.offset as number | undefined) ?? 0;
        const limit = (options.limit as number | undefined) ?? items.length;
        const page = items.slice(offset, offset + limit);
        return Promise.resolve([page, items.length]);
      }) as EntityRepository<Service>['findAndCount'],
    };

    const em: Partial<EntityManager> = {
      getConnection: () =>
        ({
          execute: (sql: string) => {
            if (sql.includes('staff_qualifications')) {
              return Promise.resolve(state.bookableIds.map((id) => ({ service_id: id })));
            }
            return Promise.resolve([]);
          },
        }) as unknown as ReturnType<EntityManager['getConnection']>,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: getRepositoryToken(Product), useValue: {} },
        { provide: getRepositoryToken(Category), useValue: {} },
        { provide: getRepositoryToken(Service), useValue: serviceRepo },
        { provide: getRepositoryToken(ServiceConsumption), useValue: {} },
        { provide: getRepositoryToken(ServiceDependency), useValue: {} },
        { provide: getRepositoryToken(Combo), useValue: {} },
        { provide: EntityManager, useValue: em },
      ],
    }).compile();

    service = module.get(CatalogService);
  });

  it('returns all services when bookable is not set (non-regression)', async () => {
    state.all = [makeService('s1', 'A'), makeService('s2', 'B')];
    const query = new ListServicesQueryDto();

    const result = await service.listServices('t-1', query);

    expect(result.data.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(result.meta.total).toBe(2);
    expect(lastFindAndCount?.where).not.toHaveProperty('id');
  });

  it('filters to services that have at least one staff qualification when bookable=true', async () => {
    state.all = [
      makeService('s1', 'Qualified'),
      makeService('s2', 'Also qualified'),
      makeService('s3', 'Orphan'),
    ];
    state.bookableIds = ['s1', 's2'];
    const query = new ListServicesQueryDto();
    query.bookable = true;

    const result = await service.listServices('t-1', query);

    expect(result.data.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(result.meta.total).toBe(2);
  });

  it('returns empty list when bookable=true and no service has qualifications', async () => {
    state.all = [makeService('s1', 'Orphan')];
    state.bookableIds = [];
    const query = new ListServicesQueryDto();
    query.bookable = true;

    const result = await service.listServices('t-1', query);

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.total_pages).toBe(1);
  });

  it('combines bookable=true with status filter', async () => {
    state.all = [
      makeService('s1', 'Active qualified', ServiceStatus.ACTIVE),
      makeService('s2', 'Draft qualified', ServiceStatus.DRAFT),
      makeService('s3', 'Active orphan', ServiceStatus.ACTIVE),
    ];
    state.bookableIds = ['s1', 's2'];
    const query = new ListServicesQueryDto();
    query.bookable = true;
    query.status = ServiceStatus.ACTIVE;

    const result = await service.listServices('t-1', query);

    expect(result.data.map((s) => s.id)).toEqual(['s1']);
  });

  it('respects pagination after applying the bookable filter', async () => {
    state.all = Array.from({ length: 5 }, (_, i) => makeService(`s${i + 1}`, `Svc ${i + 1}`));
    state.bookableIds = ['s1', 's2', 's3', 's4'];
    const query = new ListServicesQueryDto();
    query.bookable = true;
    query.page = 2;
    query.page_size = 2;

    const result = await service.listServices('t-1', query);

    expect(result.data.map((s) => s.id)).toEqual(['s3', 's4']);
    expect(result.meta.total).toBe(4);
    expect(result.meta.total_pages).toBe(2);
  });
});
