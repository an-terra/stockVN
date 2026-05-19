# syntax=docker/dockerfile:1
# Build SPA + chạy Express (API + static) một cổng — Render / App Runner / ECS / EC2.

FROM node:22-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY frontend ./frontend
RUN npm ci --prefix frontend
ENV VITE_API_BASE=
RUN npm run build --prefix frontend

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
COPY server ./server
RUN npm ci --prefix server --omit=dev
COPY --from=web-build /app/frontend/dist ./frontend/dist
EXPOSE 8000
ENV PORT=8000
CMD ["node", "server/index.mjs"]
