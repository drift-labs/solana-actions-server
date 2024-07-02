FROM public.ecr.aws/bitnami/node:18
ENV NODE_ENV=production
RUN npm install -g yarn
RUN npm install -g typescript

WORKDIR /app
COPY . .
RUN yarn
RUN yarn build

EXPOSE 3000