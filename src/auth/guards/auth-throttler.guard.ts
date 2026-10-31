import { Injectable } from '@nestjs/common';
import { HttpThrottlerGuard } from '../../rate-limit/http-throttler.guard.js';

@Injectable()
export class AuthThrottlerGuard extends HttpThrottlerGuard {}
