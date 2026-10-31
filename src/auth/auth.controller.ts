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
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOAuth2,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import {
  HttpErrorResponse,
  ValidationErrorResponse,
} from '@/common/dto/error-response.js';

import { AuthService } from './auth.service.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginRequest } from './dto/login-request.js';
import { LoginResponse } from './dto/login-response.js';
import {
  PasswordTokenRequest,
  PasswordTokenResponse,
} from './dto/password-token.js';
import { RefreshRequest } from './dto/refresh-request.js';
import { RegisterRequest } from './dto/register-request.js';
import { UserResponse } from './dto/user-response.js';
import { AuthThrottlerGuard } from './guards/auth-throttler.guard.js';
import type { AuthenticatedUser } from './types/authenticated-user.js';

const tooManyRequests = {
  description: 'Too many attempts from this client',
  type: HttpErrorResponse,
  example: {
    message: 'Too many requests',
    error: 'Too Many Requests',
    statusCode: 429,
    code: 'RATE_LIMITED',
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
      code: 'INVALID_CREDENTIALS',
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
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('application/x-www-form-urlencoded')
  @ApiOperation({
    summary: 'Exchange an email and password for a bearer token',
    description:
      'OAuth 2.0 password grant. The Swagger Authorize dialog posts the account email in username. JSON clients use POST /auth/login.',
  })
  @ApiOkResponse({ type: PasswordTokenResponse })
  @ApiUnauthorizedResponse({
    description: 'Invalid email or password',
    type: HttpErrorResponse,
    example: {
      message: 'Invalid email or password',
      error: 'Unauthorized',
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed',
    type: ValidationErrorResponse,
  })
  @ApiTooManyRequestsResponse(tooManyRequests)
  async token(
    @Body() body: PasswordTokenRequest,
  ): Promise<PasswordTokenResponse> {
    const session = await this.authService.login({
      email: body.username,
      password: body.password,
    });
    return {
      access_token: session.accessToken,
      token_type: session.tokenType,
      expires_in: session.expiresIn,
      refresh_token: session.refreshToken,
    };
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
      code: 'EMAIL_TAKEN',
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

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token and issue a new access token',
  })
  @ApiOkResponse({ type: LoginResponse })
  @ApiUnauthorizedResponse({ description: 'Invalid refresh token' })
  @ApiTooManyRequestsResponse(tooManyRequests)
  refresh(@Body() body: RefreshRequest): Promise<LoginResponse> {
    return this.authService.refresh(body.refreshToken);
  }

  @Public()
  @UseGuards(AuthThrottlerGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  @ApiNoContentResponse()
  @ApiTooManyRequestsResponse(tooManyRequests)
  logout(@Body() body: RefreshRequest): Promise<void> {
    return this.authService.logout(body.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Return the signed-in user' })
  @ApiOkResponse({ type: UserResponse })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return this.authService.me(user.id);
  }
}
