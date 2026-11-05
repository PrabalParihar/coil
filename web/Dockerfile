# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY . .
ARG NEXT_PUBLIC_COIL_FACTORY
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM nginx:stable-alpine AS runtime
ENV PORT=8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/out /usr/share/nginx/html
EXPOSE 8080
