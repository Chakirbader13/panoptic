// Panoptic - Agent Email / delivrabilite. DNS: SPF, DKIM, DMARC (usurpation).
import { makeFinding, dnsQuery, hostOf } from "../shared.js";

export async function run(scope) {
  const findings = [];
  const host = hostOf(scope.target);
  const domain = host.replace(/^www\./, "");
  const F = (r) => findings.push(makeFinding("email", "visibilite", { url: `dns:${domain}`, ...r, evidenceType: "prod" }));

  // MX: le domaine recoit-il des emails ? (sinon SPF/DMARC restent recommandes anti-usurpation)
  const mx = await dnsQuery(domain, "MX");
  const txt = await dnsQuery(domain, "TXT");
  const records = txt.answers || [];

  // SPF
  const spf = records.find((r) => /v=spf1/i.test(r));
  if (!spf) F({ rule: "no-spf", severity: "high", effort: 0.2, title: "Aucun enregistrement SPF", fix: "Publier un TXT v=spf1 ... -all pour autoriser vos serveurs d'envoi.", proof: "Pas de v=spf1." });
  else if (/\?all|~all/i.test(spf) && !/-all/i.test(spf)) F({ rule: "weak-spf", severity: "medium", effort: 0.1, title: "SPF permissif (~all/?all au lieu de -all)", fix: "Passer en -all une fois les sources d'envoi validees.", proof: spf.slice(0, 80) });

  // DMARC
  const dmarc = await dnsQuery(`_dmarc.${domain}`, "TXT");
  const dmarcRec = (dmarc.answers || []).find((r) => /v=DMARC1/i.test(r));
  if (!dmarcRec) F({ rule: "no-dmarc", severity: "high", effort: 0.2, title: "Aucun enregistrement DMARC", fix: "Publier _dmarc TXT v=DMARC1; p=quarantine (puis reject).", proof: "Pas de v=DMARC1." });
  else if (/p=none/i.test(dmarcRec)) F({ rule: "dmarc-none", severity: "medium", effort: 0.2, title: "DMARC en p=none (aucune protection appliquee)", fix: "Passer a p=quarantine puis p=reject apres analyse des rapports.", proof: dmarcRec.slice(0, 80) });

  // DKIM: on ne peut pas deviner le selecteur, mais on teste les plus courants
  let dkimFound = false;
  for (const sel of ["default", "google", "selector1", "k1", "dkim"]) {
    const d = await dnsQuery(`${sel}._domainkey.${domain}`, "TXT");
    if ((d.answers || []).some((r) => /v=DKIM1|p=/i.test(r))) { dkimFound = true; break; }
  }
  if ((mx.answers || []).length && !dkimFound) F({ rule: "no-dkim", severity: "medium", effort: 0.3, title: "Aucun DKIM detecte sur les selecteurs courants", fix: "Configurer DKIM chez votre fournisseur d'envoi et publier la cle.", proof: "Selecteurs testes sans cle DKIM." });

  return { findings, stats: { mx: (mx.answers || []).length, spf: Boolean(spf), dmarc: Boolean(dmarcRec), dkim: dkimFound } };
}
