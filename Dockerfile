FROM node:26-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/prepare.mjs ./scripts/prepare.mjs
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

ENV DATABASE_URL=mysql://mobiversite:mobiversite@127.0.0.1:3306/mobiversite
RUN npx prisma generate && npm run build

FROM node:26-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY scripts/prepare.mjs ./scripts/prepare.mjs
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts

USER node

EXPOSE 3000

ENTRYPOINT ["node", "dist/main.js"]
