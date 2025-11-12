import type { PrismaService } from '../prisma/prisma.service';

type ModelMock = Record<string, jest.Mock>;

export type PrismaMock = {
  [model: string]: ModelMock;
} & {
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
};

function modelMock(): ModelMock {
  return new Proxy({} as ModelMock, {
    get(target, method: string) {
      if (!(method in target)) target[method] = jest.fn();
      return target[method];
    },
  });
}

/**
 * A stand-in for PrismaService where every model method is a jest.fn()
 * created on first use. $transaction runs callbacks against the same mock
 * and resolves arrays of promises, like the real client.
 */
export function createPrismaMock(): PrismaMock {
  const models = new Map<string, ModelMock>();
  const $queryRaw = jest.fn();
  const $transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(mock) : Promise.all(arg as unknown[]),
  );

  const mock = new Proxy({} as PrismaMock, {
    get(_target, key: string) {
      if (key === 'then') return undefined;
      if (key === '$transaction') return $transaction;
      if (key === '$queryRaw') return $queryRaw;
      if (!models.has(key)) models.set(key, modelMock());
      return models.get(key);
    },
  });
  return mock;
}

export function asPrismaService(mock: PrismaMock): PrismaService {
  return mock as unknown as PrismaService;
}
