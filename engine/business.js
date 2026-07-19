// Panoptic - estimation d'impact business, en FOURCHETTE et clairement "estimation".
// Deux modes:
//  - calibre: si l'utilisateur fournit trafic + valeur de conversion, les findings qui
//    touchent la conversion/visibilite sont chiffres comme une fraction du CA annuel.
//  - severite: sinon, fourchette par sévérité (ordre de grandeur, pas une mesure).
// Toujours { low, high, kind, estimate:true, basis }.

// Fourchettes par sévérité (euros), utilisées sans données business. Ordre de grandeur.
const SEV_RANGE = {
  critical: [5000, 20000],
  high: [2000, 8000],
  medium: [500, 2500],
  low: [100, 500],
  info: [0, 0],
};

// Effet sur le CA annuel de conversion, en fraction, par sévérité (mode calibre).
const CONV_EFFECT = {
  critical: [0.02, 0.06],
  high: [0.01, 0.03],
  medium: [0.003, 0.01],
  low: [0.001, 0.003],
  info: [0, 0],
};

// Agents dont les findings agissent sur le trafic / la conversion.
const CONVERSION_AGENTS = new Set(["seo", "geo", "perf", "ux", "cro", "content", "a11y"]);

// params = { monthlyVisits, conversionValue, conversionRate } (tous optionnels).
export function estimateImpact(finding, params) {
  const sev = finding.severity || "info";
  const kind = finding.business?.kind === "gain" ? "gain" : "risk";

  const calibrated =
    params && params.monthlyVisits > 0 && params.conversionValue > 0 &&
    CONVERSION_AGENTS.has(finding.agent);

  if (calibrated) {
    const rate = params.conversionRate > 0 ? params.conversionRate : 0.02; // 2% par defaut
    const annualRevenue = params.monthlyVisits * 12 * rate * params.conversionValue;
    const [lo, hi] = CONV_EFFECT[sev] || CONV_EFFECT.info;
    return { kind, low: Math.round(annualRevenue * lo), high: Math.round(annualRevenue * hi), estimate: true, basis: "calibre" };
  }

  const [lo, hi] = SEV_RANGE[sev] || SEV_RANGE.info;
  return { kind, low: lo, high: hi, estimate: true, basis: "severite" };
}

// Applique l'estimation a tous les findings et renvoie les totaux (fourchette).
export function applyBusiness(findings, params) {
  let riskLow = 0, riskHigh = 0, gainLow = 0, gainHigh = 0;
  for (const f of findings) {
    const est = estimateImpact(f, params);
    f.business = { ...(f.business || {}), ...est };
    if (est.kind === "gain") { gainLow += est.low; gainHigh += est.high; }
    else { riskLow += est.low; riskHigh += est.high; }
  }
  return {
    riskLow, riskHigh, gainLow, gainHigh,
    calibrated: Boolean(params && params.monthlyVisits > 0 && params.conversionValue > 0),
  };
}
