import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

export const PASSWORD_MAX_BYTES = 72;

@ValidatorConstraint({ name: 'passwordByteLength', async: false })
export class PasswordByteLengthConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES
    );
  }

  defaultMessage(): string {
    return `password must be at most ${PASSWORD_MAX_BYTES} bytes`;
  }
}
