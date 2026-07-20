# Panoptic - serveur d'audit code+prod. Node + git + semgrep (SAST) + Chromium (axe/Lighthouse).
FROM node:20-slim

# Toutes les images du navigateur Playwright dans un chemin stable.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# git: clone ephemere du depot a auditer.
# python3 + semgrep: scanner SAST structurel reel (engine/scanners/semgrep.js), hors-ligne.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip \
    && pip3 install --break-system-packages --no-cache-dir semgrep
RUN semgrep --version

WORKDIR /app

# Dependances Node (playwright, axe-core, lighthouse, chrome-launcher, @netlify/blobs).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Chromium headless + librairies systeme pour les scanners navigateur (axe-core, Lighthouse).
# `--with-deps` fait son propre apt-get update+install; on nettoie apres.
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY engine ./engine
COPY server ./server

ENV PORT=8787
EXPOSE 8787

# Stockage local par defaut; definir SUPABASE_URL + SUPABASE_SERVICE_KEY pour Supabase.
CMD ["node", "server/server.mjs"]
