import type { Role } from '../../generated/prisma/client.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}
