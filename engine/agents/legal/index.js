// Panoptic - Agent Juridique / RGPD. Le poste ou le client risque une amende.
import { makeFinding } from "../shared.js";

const TRACKERS = [
  { re: /googletagmanager|gtag\(|google-analytics|analytics\.js/i, name: "Google Analytics / GTM" },
  { re: /connect\.facebook\.net|fbq\(/i, name: "Meta Pixel" },
  { re: /hotjar|hj\(/i, name: "Hotjar" },
  { re: /clarity\.ms/i, name: "Microsoft Clarity" },
  { re: /doubleclick|adservice\.google/i, name: "Google Ads" },
];

export function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const html = scope.home.body;
  const F = (r) => findings.push(makeFinding("legal", "risque", { ...r, url }));

  // Cookies deposes des la premiere reponse (avant tout consentement)
  const cookies = scope.home.setCookie || [];
  const nonEssential = cookies.filter((c) => /_ga|_gid|_fbp|_gcl|hjSession|amplitude|mp_/i.test(c));
  if (nonEssential.length) F({ rule: "cookie-before-consent", severity: "high", effort: 0.4, cwe: "GDPR-Art7", risk_eur: 12000, title: `${nonEssential.length} cookie(s) de tracking depose(s) avant consentement`, fix: "Ne charger les traceurs qu'apres consentement explicite (CMP + Consent Mode).", proof: nonEssential[0]?.slice(0, 80), impact: "Violation ePrivacy / RGPD" });

  // Traceurs charges sans mecanisme de consentement visible
  const loaded = TRACKERS.filter((t) => t.re.test(html));
  const hasCMP = /cookie|consent|cmp|didomi|axeptio|tarteaucitron|cookiebot|onetrust/i.test(html);
  if (loaded.length && !hasCMP) F({ rule: "tracker-no-cmp", severity: "high", effort: 0.6, cwe: "GDPR-Art7", risk_eur: 12000, title: `Traceur(s) sans banniere de consentement (${loaded.map((t) => t.name).join(", ")})`, fix: "Installer une CMP conforme qui bloque les traceurs avant choix.", proof: `${loaded.length} traceur(s), pas de CMP detectee.` });

  // Mentions legales / confidentialite: texte (insensible aux accents) OU slug d'URL (href).
  const flat = html.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hasPrivacy = /politique de confidentialite|privacy policy|donnees personnelles|\brgpd\b|\bgdpr\b/.test(flat)
    || /href=["'][^"']*(privacy|confidentialite|politique-de-confidentialite|donnees-personnelles)/i.test(html);
  if (!hasPrivacy) F({ rule: "no-privacy-link", severity: "medium", effort: 0.3, risk_eur: 4000, title: "Aucun lien politique de confidentialite detecte", fix: "Publier et lier une politique de confidentialite conforme RGPD.", proof: "Ni texte ni lien de confidentialite sur l'accueil.", check: { verdict: "plausible", votes: 2, refuters: 1, reason: "Scan boite noire de l'accueil uniquement." } });
  const hasLegal = /mentions legales|legal notice|impressum|conditions generales|terms of service|\bcgv\b|\bcgu\b/.test(flat)
    || /href=["'][^"']*(mentions-legales|\/cgv|\/cgu|\/legal|mentions_legales)/i.test(html);
  if (!hasLegal) F({ rule: "no-legal-notice", severity: "medium", effort: 0.3, risk_eur: 3000, title: "Aucun lien mentions legales / CGU detecte", fix: "Publier mentions legales et CGV/CGU (obligation legale FR).", proof: "Ni texte ni lien de mentions legales sur l'accueil.", check: { verdict: "plausible", votes: 2, refuters: 1, reason: "Scan boite noire de l'accueil uniquement." } });

  return { findings, stats: { cookies: cookies.length, trackers: loaded.length, cmp: hasCMP } };
}
