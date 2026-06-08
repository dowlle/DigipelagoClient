# syntax=docker/dockerfile:1

# --- Stage 1: build the Vite client into dist/ ------------------------------
FROM node:20-alpine AS client
WORKDIR /app
# Install with the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci
# Source needed by the build (tsc -b + vite build + check:dashes).
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
COPY tools ./tools
RUN npm run build

# --- Stage 2: Python runtime serving dist/ via gunicorn ---------------------
FROM python:3.12-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

# Python deps first for layer caching.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# App code + built frontend.
COPY backend ./backend
COPY --from=client /app/dist ./dist

EXPOSE 5003
CMD ["gunicorn", "-b", "0.0.0.0:5003", "backend.app:create_app()"]
