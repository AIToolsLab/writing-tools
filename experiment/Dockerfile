# Stage 1: Install dependencies
FROM node:24-slim AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Stage 2: Build the application
FROM node:24-slim AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY . .

# Build argument for git commit hash
ARG GIT_COMMIT=unknown

# Set environment variables for build
ENV NEXT_PUBLIC_GIT_COMMIT=${GIT_COMMIT}
ENV DOCKER_BUILD=true

# Build the Next.js application
RUN npm run build

# Stage 3: Production runtime
FROM node:24-slim AS runner
# Note: unlike the backend Dockerfile, this container doesn't set WORKDIR to a subfolder of /app
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Build argument for group ID (to match host permissions)
ARG EXP_LOGS_GID=1001

# Create non-root user for security
RUN addgroup --system --gid ${EXP_LOGS_GID} appgroup && \
    adduser --system --uid 1001 nextjs \
    adduser nextjs appgroup

# Copy standalone output from builder
COPY --from=builder /app/.next/standalone ./
# Copy static files (Next.js doesn't include these in standalone by default)
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Set correct permissions
RUN chown -R nextjs:appgroup /app

# Switch to non-root user
USER nextjs

# Expose the port
EXPOSE 3000

# Set default port
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the application
CMD ["node", "server.js"]
