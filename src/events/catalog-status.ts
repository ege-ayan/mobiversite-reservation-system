export const CATALOG_STATUSES = [
  'ON_SALE',
  'PAST',
  'CANCELLING',
  'DELETED',
] as const;

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export function catalogStatus(
  event: { deletedAt: Date | null; salesClosedAt: Date | null; startsAt: Date },
  now = new Date(),
): CatalogStatus {
  if (event.deletedAt) {
    return 'DELETED';
  }
  if (event.salesClosedAt) {
    return 'CANCELLING';
  }
  if (event.startsAt.getTime() <= now.getTime()) {
    return 'PAST';
  }
  return 'ON_SALE';
}
