# Build stage
FROM node:24-slim AS build
WORKDIR /app/backend
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:24-slim AS run
WORKDIR /app/backend
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/backend/dist ./dist

# Study logs are written here; in deployment this path is a mounted volume.
RUN mkdir -p logs

EXPOSE 5000
CMD ["node", "dist/index.js"]
