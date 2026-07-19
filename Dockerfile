# Panoptic - serveur d'audit. Image Node minimale, sans dependance a installer.
FROM node:20-slim

# git: requis pour l'offre "code + prod" (clone ephemere du depot a auditer).
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Le moteur et le serveur n'ont aucune dependance npm: on copie le code tel quel.
COPY package.json ./
COPY engine ./engine
COPY server ./server

ENV PORT=8787
EXPOSE 8787

# Stockage local par defaut; definir SUPABASE_URL + SUPABASE_SERVICE_KEY pour Supabase.
CMD ["node", "server/server.mjs"]
