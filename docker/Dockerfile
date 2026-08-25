FROM node:23-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM node:23-bookworm-slim
WORKDIR /app
COPY docker/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY docker/server.js ./
COPY --from=frontend /build/frontend/dist ./frontend/dist
ENV NODE_ENV=production PORT=3100 VIDEOX_DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3100
CMD ["node", "server.js"]
