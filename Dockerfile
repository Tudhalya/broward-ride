FROM node:20-alpine

# Run as non-root for security
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

ENV NODE_ENV=production
EXPOSE 3080

CMD ["node", "server.js"]
