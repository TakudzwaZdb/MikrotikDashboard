# ---- build the frontend ----
FROM node:20-bookworm-slim AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- runtime: API + built frontend in one container ----
FROM node:20-bookworm-slim
ENV NODE_ENV=production STATIC_DIR=/app/public PORT=8080
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./
COPY --from=web /web/dist ./public
USER node
EXPOSE 8080
# apply migrations, (re)create the admin login, then start
CMD ["sh", "-c", "npm run migrate && npm run seed && node src/server.js"]
