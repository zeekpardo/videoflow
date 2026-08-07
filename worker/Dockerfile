FROM mcr.microsoft.com/playwright:v1.58.0-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY worker ./worker

USER pwuser
CMD ["node", "worker/media-worker.mjs"]
