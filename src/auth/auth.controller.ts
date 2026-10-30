import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
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

@Public()
@UseGuards(AuthThrottlerGuard)
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
