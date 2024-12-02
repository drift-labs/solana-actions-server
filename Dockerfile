FROM public.ecr.aws/bitnami/node:18
ENV NODE_ENV=production
RUN npm install -g typescript

# test new build

WORKDIR /app
COPY . .
RUN yarn
RUN yarn build

EXPOSE 3000