# One image for both the help desk and the store API (different commands).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY store-api.js ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=3000 DB_FILE=/data/helpdesk.db
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1
CMD ["node", "src/server.js"]
