# One application image: builds the website, then the Node server serves API + website together.
FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev
USER node
EXPOSE 8080
CMD ["npm", "start"]
