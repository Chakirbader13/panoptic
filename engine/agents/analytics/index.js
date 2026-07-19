// Panoptic - Agent Analytics et mesure. Si la mesure est fausse, tout le rapport CRO ment.
import { makeFinding } from "../shared.js";

export function run(scope) {
  const findings = [];
  if (!scope.reachable) return { findings, stats: { skipped: "prod injoignable" } };
  const url = scope.url;
  const html = scope.home.body;
  const F = (r) => findings.push(makeFinding("analytics", "visibilite", { ...r, url }));

  const hasGA4 = /gtag\(\s*['"]config['"]\s*,\s*['"]G-|googletagmanager\.com\/gtag\/js\?id=G-/i.test(html);
  const hasGTM = /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/i.test(html);
  const hasUA = /UA-\d{4,}-\d+|analytics\.js/i.test(html);
  const hasAny = hasGA4 || hasGTM || hasUA || /plausible|matomo|piwik|fathom|segment\.com|mixpanel/i.test(html);

  // Aucune mesure du tout
  if (!hasAny) F({ rule: "no-analytics", severity: "medium", effort: 0.3, title: "Aucune solution d'analytics detectee", fix: "Installer une mesure (GA4, Plausible, Matomo) avec plan de tracking.", proof: "Aucun tag analytics trouve." });

  // Universal Analytics obsolete
  if (hasUA && !hasGA4) F({ rule: "legacy-ua", severity: "high", effort: 0.5, title: "Universal Analytics obsolete (arrete par Google)", fix: "Migrer vers GA4; UA ne collecte plus de donnees.", proof: "Tag UA-/analytics.js detecte." });

  // Double comptage probable (GA4 direct + via GTM)
  if (hasGA4 && hasGTM) F({ rule: "double-tagging", severity: "medium", effort: 0.3, title: "GA4 charge en direct ET via GTM (double comptage possible)", fix: "Charger GA4 par une seule voie pour eviter les hits dupliques.", proof: "gtag config + GTM detectes." });

  // Consent Mode absent alors qu'un tag Google est present
  if ((hasGA4 || hasGTM) && !/consent['"]?\s*,\s*['"](default|update)|gcs=|consent_mode/i.test(html)) {
    F({ rule: "no-consent-mode", severity: "medium", effort: 0.4, title: "Consent Mode v2 non detecte avec un tag Google", fix: "Implementer Consent Mode v2 (obligatoire EEE pour Google Ads/GA4).", proof: "Tag Google sans signal de consentement." });
  }

  return { findings, stats: { ga4: hasGA4, gtm: hasGTM, ua: hasUA } };
}
