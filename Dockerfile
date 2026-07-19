# Panoptic - serveur d'audit. Image Node minimale, sans dependance a installer.
FROM node:20-slim

WORKDIR /app
# Le moteur et le serveur n'ont aucune dependance npm: on copie le code tel quel.
COPY package.json ./
COPY engine ./engine
COPY server ./server

ENV PORT=8787
EXPOSE 8787

# Stockage local par defaut; definir SUPABASE_URL + SUPABASE_SERVICE_KEY pour Supabase.
CMD ["node", "server/server.mjs"]
