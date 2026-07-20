# Panoptic - serveur d'audit. Image Node + git + semgrep (SAST reel code+prod).
FROM node:20-slim

# git: clone ephemere du depot a auditer (offre code+prod).
# python3 + semgrep: scanner SAST structurel reel (engine/scanners/semgrep.js).
# semgrep tourne hors-ligne sur le jeu de regles bundle (--config, --metrics=off).
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 python3-pip \
    && pip3 install --break-system-packages --no-cache-dir semgrep \
    && rm -rf /var/lib/apt/lists/* /root/.cache

# Verifie que semgrep est bien sur le PATH a la construction (echoue tot sinon).
RUN semgrep --version

WORKDIR /app
# Le moteur et le serveur n'ont aucune dependance npm: on copie le code tel quel.
COPY package.json ./
COPY engine ./engine
COPY server ./server

ENV PORT=8787
EXPOSE 8787

# Stockage local par defaut; definir SUPABASE_URL + SUPABASE_SERVICE_KEY pour Supabase.
CMD ["node", "server/server.mjs"]
