FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       ca-certificates \
       python3 \
       python3-pip \
       curl \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp with EJS support
RUN python3 -m pip install --break-system-packages -U "yt-dlp[default]"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
