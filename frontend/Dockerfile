# Build stage
FROM node:24-slim AS build

WORKDIR /app

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

COPY . ./

RUN yarn build && ls -la

# Production stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Fails because backend doesn't exist at image-build time
#RUN ["nginx", "-t"]

CMD ["nginx", "-g", "daemon off;"]
