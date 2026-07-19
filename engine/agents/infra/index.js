// Panoptic - Agent Infrastructure / DevOps. DNS, TLS (certificat reel), redirections, IaC.
import { makeFinding, dnsQuery, httpGet, originOf, hostOf } from "../shared.js";
import tls from "node:tls";

// Recupere le certificat TLS et sa date d'expiration (vraie connexion).
function certInfo(host) {
  return new Promise((resolve) => {
    // panoptic-ignore: lecture du certificat pour l'expiration, aucune donnee transmise ici.
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 7000, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) return resolve({ error: "pas de certificat" });
      resolve({ validTo: cert.valid_to, issuer: cert.issuer?.O, subject: cert.subject?.CN });
    });
    socket.on("error", (e) => resolve({ error: e.message }));
    socket.on("timeout", () => { socket.destroy(); resolve({ error: "timeout TLS" }); });
  });
}

export async function run(scope) {
  const findings = [];
  const host = hostOf(scope.target);
  const origin = originOf(scope.target);
  const F = (r) => findings.push(makeFinding("infra", "technique", { url: origin, ...r }));

  // 1. Certificat TLS: expiration proche ou depassee
  const cert = await certInfo(host);
  if (!cert.error && cert.validTo) {
    const days = Math.round((new Date(cert.validTo).getTime() - new Date("2026-07-19").getTime()) / 86400000);
    if (days < 0) F({ rule: "cert-expired", severity: "critical", effort: 0.2, title: "Certificat TLS expire", fix: "Renouveler le certificat immediatement (automatiser via ACME/Let's Encrypt).", proof: `Expire le ${cert.validTo}.` });
    else if (days < 21) F({ rule: "cert-expiring", severity: "high", effort: 0.2, title: `Certificat TLS expire dans ${days} jours`, fix: "Automatiser le renouvellement du certificat.", proof: `Valide jusqu'au ${cert.validTo}.` });
  }

  // 2. Redirection HTTP -> HTTPS
  const httpRes = await httpGet(`http://${host}/`, { redirect: "manual", timeout: 7000 });
  if (!httpRes.error) {
    const loc = httpRes.headers?.location || "";
    if (!(httpRes.status >= 300 && httpRes.status < 400 && /^https:/i.test(loc))) {
      F({ rule: "no-https-redirect", severity: "high", effort: 0.2, title: "HTTP ne redirige pas vers HTTPS", fix: "Rediriger tout le trafic HTTP en 301 vers HTTPS.", proof: `HTTP repond ${httpRes.status} sans redirection HTTPS.` });
    }
  }

  // 3. Enregistrement CAA (limite qui peut emettre des certificats)
  const caa = await dnsQuery(host, "CAA");
  if (!caa.error && (!caa.answers || caa.answers.length === 0)) {
    F({ rule: "no-caa", severity: "low", effort: 0.2, title: "Aucun enregistrement DNS CAA", fix: "Ajouter un CAA pour restreindre les autorites de certification autorisees.", proof: "Pas de CAA." });
  }

  // 4. security.txt (divulgation responsable)
  if (!scope.securityTxt?.present) F({ rule: "no-security-txt", severity: "info", effort: 0.1, title: "/.well-known/security.txt absent", fix: "Publier un security.txt avec un contact securite.", proof: "security.txt introuvable." });

  // 5. Secrets d'infra dans le repo (fichiers d'env / CI)
  if (scope.repoPath) {
    const { readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const hits = [];
    const scan = (dir, depth) => {
      if (depth > 3) return;
      let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (["node_modules", ".git", "dist"].includes(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) scan(full, depth + 1);
        else if (/^\.env(\.|$)/.test(e.name) && !/\.example$|\.sample$/.test(e.name)) hits.push(full.slice(scope.repoPath.length + 1));
      }
    };
    try { scan(scope.repoPath, 0); } catch { /* ignore */ }
    for (const h of hits) findings.push(makeFinding("infra", "technique", { rule: "env-committed", file: h, line: 1, evidenceType: "code", severity: "high", effort: 0.3, title: `Fichier d'environnement versionne (${h})`, fix: "Retirer du depot, ajouter a .gitignore, purger l'historique.", proof: h }));
  }

  return { findings, stats: { cert: cert.validTo || cert.error, stack: scope.stack } };
}
