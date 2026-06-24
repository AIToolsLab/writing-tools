# Build stage
FROM node:24-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . ./

RUN npm run build && npm run build:google-docs && ls -la

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
# Google Docs sidebar bundle, served at /gdocs/google-docs.bundle.js so the
# Apps Script sidebar can load it via an absolute URL (it can't run a 1.5MB
# inline script). The sidebar's PROD_BASE points here. The Vite build emits
# it into dist/, so copy that single file into the /gdocs/ path.
COPY --from=build /app/dist/google-docs.bundle.js /usr/share/nginx/html/gdocs/google-docs.bundle.js

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Fails because backend doesn't exist at image-build time
#RUN ["nginx", "-t"]

CMD ["nginx", "-g", "daemon off;"]
