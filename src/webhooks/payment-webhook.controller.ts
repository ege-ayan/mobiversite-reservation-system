import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator.js';
import { PaymentWebhookService } from './payment-webhook.service.js';

@ApiTags('Webhooks')
@Public()
@Controller('webhooks/payments')
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Apply a signed payment result from the payment provider',
  })
  @ApiNoContentResponse()
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-payment-signature') signature?: string,
  ): Promise<void> {
    return this.webhooks.receive(request.rawBody, signature);
  }
}
