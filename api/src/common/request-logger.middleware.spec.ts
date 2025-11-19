import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { RequestLoggerMiddleware } from './request-logger.middleware';

function run(statusCode: number) {
  const middleware = new RequestLoggerMiddleware();
  const debug = jest.spyOn(middleware['logger'], 'debug').mockImplementation(() => undefined);
  const error = jest.spyOn(middleware['logger'], 'error').mockImplementation(() => undefined);
  const res = Object.assign(new EventEmitter(), { statusCode }) as unknown as Response;
  const next = jest.fn() as NextFunction;
  middleware.use({ method: 'GET', originalUrl: '/api/notes' } as Request, res, next);
  (res as unknown as EventEmitter).emit('finish');
  return { debug, error, next };
}

describe('RequestLoggerMiddleware', () => {
  it('logs successful requests at debug level', () => {
    const { debug, error, next } = run(200);
    expect(next).toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.stringMatching(/^GET \/api\/notes 200 \d+\.\dms$/));
    expect(error).not.toHaveBeenCalled();
  });

  it('logs server errors as errors', () => {
    const { debug, error } = run(503);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('GET /api/notes 503'));
    expect(debug).not.toHaveBeenCalled();
  });
});
