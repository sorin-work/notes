import { Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../config/config';

/**
 * The roomy allowance for reading shared notes: PUBLIC_THROTTLE_LIMIT a
 * minute per client address and route.
 *
 * A guard of its own, with the limit taken here, so that the number counts
 * on the routes this guard is put on and nowhere else. As a second entry in
 * the ThrottlerModule list it would also be counted on every route with the
 * plain ThrottlerGuard, and the lower of the two limits would rule both.
 */
@Injectable()
export class PublicThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super(options, storage, reflector);
  }

  protected handleRequest(request: ThrottlerRequest): Promise<boolean> {
    return super.handleRequest({ ...request, limit: this.config.publicThrottleLimit });
  }
}
