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
ENV VITE_GIT_COMMIT=${GIT_COMMIT}

# Build the application
RUN npm run build

# Stage 3: Production runtime
FROM node:24-slim AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Build argument for group ID (to match host permissions)
ARG EXP_LOGS_GID=1001

# Create non-root user for security
RUN addgroup --system --gid ${EXP_LOGS_GID} appgroup \
  && adduser --system --uid 1001 --ingroup appgroup appuser

# Copy built output from builder
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/public ./public

# Set correct permissions
RUN chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose the port
EXPOSE 3000

# Set default port
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the application
CMD ["node", ".output/server/index.mjs"]
