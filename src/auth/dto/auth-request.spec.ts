import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginRequest } from './login-request.js';
import { RegisterRequest } from './register-request.js';

describe('auth requests', () => {
  it('trims the email before checking it', async () => {
    const login = plainToInstance(LoginRequest, {
      email: ' ada@example.com ',
      password: 'secret',
    });
    const register = plainToInstance(RegisterRequest, {
      email: ' ada@example.com ',
      password: 'correct horse battery',
    });

    expect(login.email).toBe('ada@example.com');
    expect(register.email).toBe('ada@example.com');
    await expect(validate(login)).resolves.toEqual([]);
    await expect(validate(register)).resolves.toEqual([]);
  });

  it('rejects a short registration password', async () => {
    const register = plainToInstance(RegisterRequest, {
      email: 'ada@example.com',
      password: 'too-short',
    });

    await expect(validate(register)).resolves.toHaveLength(1);
  });
});
