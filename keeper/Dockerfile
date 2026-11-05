FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run typecheck
ENV NODE_ENV=production
ENV KEEPER_WATCH=true
EXPOSE 3000
CMD ["npm", "start", "--", "--watch"]
