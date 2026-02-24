# Build stage
FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . ./

ARG POSTHOG_KEY=""
ARG POSTHOG_HOST="https://e.thoughtful-ai.com/"
ENV POSTHOG_KEY=$POSTHOG_KEY
ENV POSTHOG_HOST=$POSTHOG_HOST

RUN npm run build && ls -la

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Fails because backend doesn't exist at image-build time
#RUN ["nginx", "-t"]

CMD ["nginx", "-g", "daemon off;"]
