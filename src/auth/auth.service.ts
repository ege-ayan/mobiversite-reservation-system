import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { Prisma, type Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginRequest } from './dto/login-request.js';
import type { LoginResponse } from './dto/login-response.js';
import type { RegisterRequest } from './dto/register-request.js';
import type { UserResponse } from './dto/user-response.js';

const BCRYPT_ROUNDS = 12;

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

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
  private dummyPasswordHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.expiresInSeconds = config.get('JWT_EXPIRES_IN_SECONDS', {
      infer: true,
    });
  }

  async register(request: RegisterRequest): Promise<UserResponse> {
    const email = normalizeEmail(request.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already registered');
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
        throw new ConflictException('Email already registered');
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
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.expiresInSeconds,
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
