FROM node:22-alpine AS build
# Prisma's query engine needs OpenSSL to pick the right binary.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json docker-entrypoint.sh ./
# The folder for attachment files. A named volume mounted here starts out
# with this owner, so the API, which does not run as root, can write to it.
RUN mkdir -p /data/attachments && chown node:node /data/attachments
USER node
EXPOSE 4401
ENTRYPOINT ["./docker-entrypoint.sh"]
