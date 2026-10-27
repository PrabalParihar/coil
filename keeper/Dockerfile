FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
ENV KEEPER_WATCH=true
CMD ["npm", "start", "--", "--watch"]
