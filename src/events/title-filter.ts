import { Prisma } from '@/generated/prisma/client.js';

const FULLTEXT_OPERATORS = /[+\-<>()~*"@]+/g;

export function titleFilter(q: string | undefined): Prisma.EventWhereInput {
  const title = q?.trim();
  if (!title) {
    return {};
  }
  const words = title
    .replace(FULLTEXT_OPERATORS, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.join('').length >= 3) {
    return {
      title: { search: words.map((word) => `"${word}"`).join(' ') },
    };
  }
  return { title: { contains: title } };
}
