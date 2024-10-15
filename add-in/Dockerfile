# Node.js docker image
FROM node:16

# working directory
WORKDIR /add-in

# package.json& yarn.lock file copy
COPY add-in/package.json add-in/yarn.lock ./

# dependency install
RUN yarn install --frozen-lockfile

# source code copy 
COPY add-in ./docker

# application build
RUN yarn build

# port setting
EXPOSE 3000

# application run
CMD ["yarn", "start"]