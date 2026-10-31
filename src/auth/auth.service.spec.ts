import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const password = 'correct horse battery';

describe('AuthService', () => {
  let service: AuthService;
  const users = {
    findUnique: vi.fn(),
    create: vi.fn(),
  };
  const jwt = {
    signAsync: vi.fn(),
  };

  beforeEach(async () => {
    users.findUnique.mockReset();
    users.create.mockReset();
    jwt.signAsync.mockReset();
    jwt.signAsync.mockResolvedValue('signed-token');

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: users,
            refreshToken: { create: vi.fn().mockResolvedValue({}) },
          },
        },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: { get: () => 3600 },
        },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  describe('me', () => {
    it('returns the stored user', async () => {
      users.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'ada@example.com',
        role: 'CUSTOMER',
        passwordHash: 'hash',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });

      await expect(service.me('user-id')).resolves.toEqual({
        id: 'user-id',
        email: 'ada@example.com',
        role: 'CUSTOMER',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    it('rejects a token whose user was removed', async () => {
      users.findUnique.mockResolvedValue(null);

      await expect(service.me('missing')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('register', () => {
    it('stores a customer with a hashed password and omits the hash', async () => {
      users.findUnique.mockResolvedValue(null);
      users.create.mockImplementation(
        async ({
          data,
        }: {
          data: { email: string; passwordHash: string };
        }) => ({
          id: 'user-id',
          email: data.email,
          passwordHash: data.passwordHash,
          role: 'CUSTOMER',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await service.register({
        email: ' Ada@Example.com ',
        password,
      });

      expect(result).toEqual({
        id: 'user-id',
        email: 'ada@example.com',
        role: 'CUSTOMER',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      expect(result).not.toHaveProperty('passwordHash');

      const storedHash = users.create.mock.calls[0][0].data
        .passwordHash as string;
      expect(storedHash).not.toBe(password);
      await expect(bcrypt.compare(password, storedHash)).resolves.toBe(true);
    });

    it('rejects an email that is already registered', async () => {
      users.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({ email: 'ada@example.com', password }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('turns a unique-constraint race into a conflict', async () => {
      users.findUnique.mockResolvedValue(null);
      users.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.register({ email: 'ada@example.com', password }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows a database error that is not a duplicate email', async () => {
      users.findUnique.mockResolvedValue(null);
      users.create.mockRejectedValue(new Error('database down'));

      await expect(
        service.register({ email: 'ada@example.com', password }),
      ).rejects.toThrow('database down');
    });
  });

  describe('login', () => {
    const storedUser = {
      id: 'user-id',
      email: 'ada@example.com',
      role: 'CUSTOMER' as const,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      passwordHash: '',
    };

    beforeEach(async () => {
      storedUser.passwordHash = await bcrypt.hash(password, 4);
    });

    it('returns a bearer token for a matching password', async () => {
      users.findUnique.mockResolvedValue(storedUser);

      const result = await service.login({
        email: 'ADA@example.com',
        password,
      });

      expect(result.accessToken).toBe('signed-token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(3600);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: 'user-id',
        email: 'ada@example.com',
        role: 'CUSTOMER',
      });
    });

    it('rejects a wrong password and an unknown email with the same error', async () => {
      users.findUnique.mockResolvedValueOnce(storedUser);

      const wrongPassword = service.login({
        email: 'ada@example.com',
        password: 'not the password',
      });
      await expect(wrongPassword).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(wrongPassword).rejects.toThrow('Invalid email or password');

      users.findUnique.mockResolvedValueOnce(null);
      const unknownEmail = service.login({
        email: 'missing@example.com',
        password,
      });
      await expect(unknownEmail).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(unknownEmail).rejects.toThrow('Invalid email or password');
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });
});
