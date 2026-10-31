import type { Role } from '@/generated/prisma/client.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}
