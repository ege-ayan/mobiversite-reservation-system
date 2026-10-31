import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'futureDate', async: false })
export class FutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') {
      return false;
    }
    const time = new Date(value).getTime();
    return !Number.isNaN(time) && time > Date.now();
  }

  defaultMessage(): string {
    return 'startsAt must be in the future';
  }
}
