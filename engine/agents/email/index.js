// Panoptic - Agent Email / delivrabilite. DNS: SPF, DKIM, DMARC (usurpation).
// FAIL-CLOSED: on ne signale une absence QUE si la requete DNS a reussi. Un echec
// de resolution n'est jamais traite comme "enregistrement absent".
import { makeFinding, dnsQuery, hostOf } from "../shared.js";

export async function run(scope) {
  const findings = [];
  const host = hostOf(scope.target);
  const domain = host.replace(/^www\./, "");
  const F = (r) => findings.push(makeFinding("email", "visibilite", { url: `dns:${domain}`, ...r, evidenceType: "prod" }));

  const mx = await dnsQuery(domain, "MX");
  const txt = await dnsQuery(domain, "TXT");

  // SPF: seulement si la requete TXT a abouti.
  if (!txt.error) {
    const spf = (txt.answers || []).find((r) => /v=spf1/i.test(r));
    if (!spf) F({ rule: "no-spf", severity: "high", effort: 0.2, title: "Aucun enregistrement SPF", fix: "Publier un TXT v=spf1 ... -all pour autoriser vos serveurs d'envoi.", proof: "Requete TXT aboutie, aucun v=spf1." });
    else if (/[?~]all/i.test(spf) && !/-all/i.test(spf)) F({ rule: "weak-spf", severity: "medium", effort: 0.1, title: "SPF permissif (~all/?all au lieu de -all)", fix: "Passer en -all une fois les sources d'envoi validees.", proof: spf.slice(0, 90) });
  }

  // DMARC: seulement si la requete a abouti.
  const dmarc = await dnsQuery(`_dmarc.${domain}`, "TXT");
  if (!dmarc.error) {
    const dmarcRec = (dmarc.answers || []).find((r) => /v=DMARC1/i.test(r));
    if (!dmarcRec) F({ rule: "no-dmarc", severity: "high", effort: 0.2, title: "Aucun enregistrement DMARC", fix: "Publier _dmarc TXT v=DMARC1; p=quarantine (puis reject).", proof: "Requete DMARC aboutie, aucun v=DMARC1." });
    else if (/p=none/i.test(dmarcRec)) F({ rule: "dmarc-none", severity: "medium", effort: 0.2, title: "DMARC en p=none (aucune protection appliquee)", fix: "Passer a p=quarantine puis p=reject apres analyse des rapports.", proof: dmarcRec.slice(0, 90) });
  }

  // Si les deux resolutions ont echoue, le signaler comme info (jamais comme absence).
  if (txt.error && dmarc.error) {
    F({ rule: "dns-uncheckable", severity: "info", effort: 0, title: "SPF/DMARC non verifiables (resolution DNS indisponible)", fix: "Relancer l'audit; verifier que le domaine resout.", proof: txt.error, reason: "Resolution DNS echouee, ni presence ni absence confirmee.", check: { verdict: "plausible", votes: 1, refuters: 0, reason: "Verification impossible." } });
  }

  // DKIM: teste des selecteurs courants; ne signaler l'absence que si le domaine recoit
  // des emails (MX present) ET que les requetes DKIM ont abouti.
  if (!mx.error && (mx.answers || []).length) {
    let dkimFound = false, dkimChecked = false;
    for (const sel of ["default", "google", "selector1", "selector2", "k1", "dkim", "mail"]) {
      const d = await dnsQuery(`${sel}._domainkey.${domain}`, "TXT");
      if (d.error) continue;
      dkimChecked = true;
      if ((d.answers || []).some((r) => /v=DKIM1|p=[A-Za-z0-9+/]/i.test(r))) { dkimFound = true; break; }
    }
    if (dkimChecked && !dkimFound) F({ rule: "no-dkim", severity: "low", effort: 0.3, title: "Aucun DKIM detecte sur les selecteurs courants", fix: "Configurer DKIM chez votre fournisseur d'envoi (le selecteur peut etre non standard).", proof: "Selecteurs courants testes sans cle. Le vrai selecteur peut differer.", check: { verdict: "plausible", votes: 2, refuters: 1, reason: "Selecteur DKIM non devinable a coup sur." } });
  }

  return { findings, stats: { mxOk: !mx.error, txtOk: !txt.error, dmarcOk: !dmarc.error } };
}
