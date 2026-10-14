# EKO RUMMY — imagen de producción (Node 22, sin dependencias nativas salvo ws)
FROM node:22-alpine AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json ./
# Sin --omit=optional: esbuild instala su binario de plataforma como dependencia opcional.
RUN npm install --no-audit --no-fund
COPY . .
RUN node scripts/build.mjs

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 DB_PATH=/data/eko-rummy.sqlite STATIC_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server/src ./apps/server/src
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/package.json ./
RUN addgroup -S eko && adduser -S eko -G eko && mkdir -p /data && chown eko:eko /data
USER eko
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/index.ts"]
