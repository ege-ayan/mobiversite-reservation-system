import { Injectable } from '@nestjs/common';

import { HttpThrottlerGuard } from '@/rate-limit/http-throttler.guard.js';

@Injectable()
export class BookingThrottlerGuard extends HttpThrottlerGuard {
  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    if (user?.id) {
      return user.id;
    }
    return super.getTracker(req);
  }
}
