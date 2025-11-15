import type { ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaExceptionFilter } from './prisma-exception.filter';

function hostWithResponse() {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  return { host, response };
}

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('failed', { code, clientVersion: 'test' });
}

describe('PrismaExceptionFilter', () => {
  const filter = new PrismaExceptionFilter();

  it('maps unique constraint violations to 409', () => {
    const { host, response } = hostWithResponse();
    filter.catch(prismaError('P2002'), host);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 409, error: 'Conflict' }));
  });

  it('maps missing records to 404', () => {
    const { host, response } = hostWithResponse();
    filter.catch(prismaError('P2025'), host);
    expect(response.status).toHaveBeenCalledWith(404);
  });

  it('hides other errors behind a 500', () => {
    const { host, response } = hostWithResponse();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    filter.catch(prismaError('P2034'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });
});
