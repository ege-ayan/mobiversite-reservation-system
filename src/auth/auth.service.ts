import { createHash, randomBytes } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';

import { conflict, unauthorized } from '@/common/errors/app.exception.js';
import { ErrorCode } from '@/common/errors/error-code.js';
import type { EnvironmentVariables } from '@/config/env.validation.js';
import { Prisma, type Role } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';

import type { LoginRequest } from './dto/login-request.js';
import type { LoginResponse } from './dto/login-response.js';
import type { RegisterRequest } from './dto/register-request.js';
import type { UserResponse } from './dto/user-response.js';
import type { AccessTokenPayload } from './types/access-token-payload.js';

const BCRYPT_ROUNDS = 12;

type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class AuthService {
  private readonly expiresInSeconds: number;
  private readonly refreshExpiresInSeconds: number;
  private dummyPasswordHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.expiresInSeconds = config.get('JWT_EXPIRES_IN_SECONDS', {
      infer: true,
    });
    this.refreshExpiresInSeconds = config.get(
      'REFRESH_TOKEN_EXPIRES_IN_SECONDS',
      {
        infer: true,
      },
    );
  }

  async me(userId: string): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    return toUserResponse(user);
  }

  async register(request: RegisterRequest): Promise<UserResponse> {
    const email = normalizeEmail(request.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw conflict('Email already registered', ErrorCode.EMAIL_TAKEN);
    }

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(request.password, BCRYPT_ROUNDS),
        },
      });
      return toUserResponse(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw conflict('Email already registered', ErrorCode.EMAIL_TAKEN);
      }
      throw error;
    }
  }

  async login(request: LoginRequest): Promise<LoginResponse> {
    const email = normalizeEmail(request.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const passwordHash =
      user?.passwordHash ?? (await this.getDummyPasswordHash());
    const passwordMatches = await bcrypt.compare(
      request.password,
      passwordHash,
    );

    if (!user || !passwordMatches) {
      throw unauthorized(
        'Invalid email or password',
        ErrorCode.INVALID_CREDENTIALS,
      );
    }

    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });
    if (!stored || stored.expiresAt.getTime() <= Date.now()) {
      throw unauthorized(
        'Invalid refresh token',
        ErrorCode.INVALID_REFRESH_TOKEN,
      );
    }
    if (stored.revokedAt) {
      await this.revokeRefreshFamily(stored.userId);
      throw unauthorized(
        'Invalid refresh token',
        ErrorCode.INVALID_REFRESH_TOKEN,
      );
    }

    const rotated = await this.prisma.refreshToken.updateMany({
      where: {
        id: stored.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    if (rotated.count !== 1) {
      await this.revokeRefreshFamily(stored.userId);
      throw unauthorized(
        'Invalid refresh token',
        ErrorCode.INVALID_REFRESH_TOKEN,
      );
    }
    return this.issueSession(stored.user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeRefreshFamily(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(user: UserRecord): Promise<LoginResponse> {
    const secret = issueRefreshSecret();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: secret.tokenHash,
        expiresAt: new Date(Date.now() + this.refreshExpiresInSeconds * 1000),
      },
    });
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.expiresInSeconds,
      refreshToken: secret.refreshToken,
      refreshExpiresIn: this.refreshExpiresInSeconds,
      user: toUserResponse(user),
    };
  }

  private getDummyPasswordHash() {
    this.dummyPasswordHash ??= bcrypt.hash(
      'not-a-real-password',
      BCRYPT_ROUNDS,
    );
    return this.dummyPasswordHash;
  }
}

function issueRefreshSecret() {
  const refreshToken = randomBytes(32).toString('base64url');
  return { refreshToken, tokenHash: hashRefreshToken(refreshToken) };
}

function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email: string) {
  return email.trim().normalize('NFC').toLowerCase();
}

function toUserResponse(user: UserRecord): UserResponse {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
