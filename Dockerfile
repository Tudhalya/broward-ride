FROM oven/bun:latest

# Run as non-root for security
RUN mkdir -p /app && chown bun:bun /app
WORKDIR /app
USER bun

COPY --chown=bun:bun package*.json ./
RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun . .

ENV NODE_ENV=production
EXPOSE 8080

CMD ["bun", "server.js"]
