import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { AuthenticatedUser } from './types/authenticated-user.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard.js';
import {
  HttpErrorResponse,
  ValidationErrorResponse,
} from '../common/dto/error-response.js';
import { LoginResponse } from './dto/login-response.js';
import { LoginRequest } from './dto/login-request.js';
import { RegisterRequest } from './dto/register-request.js';
import { UserResponse } from './dto/user-response.js';

const tooManyRequests = {
  description: 'Too many attempts from this client',
  type: HttpErrorResponse,
  example: {
    message: 'Too many requests',
    error: 'Too Many Requests',
    statusCode: 429,
  },
};

@SkipThrottle({ booking: true })
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and receive a JWT access token' })
  @ApiOkResponse({
    description: 'JWT access token for the authenticated user',
    type: LoginResponse,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password',
    type: HttpErrorResponse,
    example: {
      message: 'Invalid email or password',
      error: 'Unauthorized',
      statusCode: 401,
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed',
    type: ValidationErrorResponse,
  })
  @ApiTooManyRequestsResponse(tooManyRequests)
  login(@Body() body: LoginRequest): Promise<LoginResponse> {
    return this.authService.login(body);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Post('register')
  @ApiOperation({ summary: 'Register a customer account' })
  @ApiCreatedResponse({
    description: 'Created customer account',
    type: UserResponse,
  })
  @ApiConflictResponse({
    description: 'Email already registered',
    type: HttpErrorResponse,
    example: {
      message: 'Email already registered',
      error: 'Conflict',
      statusCode: 409,
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed',
    type: ValidationErrorResponse,
  })
  @ApiTooManyRequestsResponse(tooManyRequests)
  register(@Body() body: RegisterRequest): Promise<UserResponse> {
    return this.authService.register(body);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the signed-in user' })
  @ApiOkResponse({ type: UserResponse })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return this.authService.me(user.id);
  }
}
