// Panoptic - authentification via Supabase Auth (GoTrue), proxifiee par le serveur.
// Le front n'a JAMAIS la service key: il appelle /api/auth/* sur notre serveur, qui
// parle a GoTrue avec la service key (deja presente sur Render) et ne renvoie au client
// que SON access_token utilisateur. Zero dependance, zero nouvelle variable, zero email.
//
// tenant d'un utilisateur = "u_" + 12 premiers caracteres de son id. Role owner.
const SUPA = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? { url: process.env.SUPABASE_URL.replace(/\/$/, ""), key: process.env.SUPABASE_SERVICE_KEY }
  : null;

export const authEnabled = () => Boolean(SUPA);

function headers(extra = {}) {
  return { apikey: SUPA.key, authorization: `Bearer ${SUPA.key}`, "content-type": "application/json", ...extra };
}

const tenantOf = (userId) => "u_" + String(userId).replace(/-/g, "").slice(0, 12);

// Cree un utilisateur DEJA confirme (admin API, pas d'email a valider) puis ouvre une session.
export async function signup(email, password) {
  if (!SUPA) throw new Error("auth non configuree (SUPABASE_URL / SERVICE_KEY absents)");
  if (!email || !password || password.length < 8) throw new Error("email et mot de passe (>= 8 caracteres) requis");
  const create = await fetch(`${SUPA.url}/auth/v1/admin/users`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!create.ok) {
    const t = await create.text();
    if (/already.been.registered|already exists|duplicate/i.test(t)) throw new Error("Cet email a deja un compte. Connectez-vous.");
    throw new Error("Creation du compte impossible: " + t.slice(0, 160));
  }
  return login(email, password);
}

// Ouvre une session par mot de passe. Renvoie { access_token, user, tenant }.
export async function login(email, password) {
  if (!SUPA) throw new Error("auth non configuree");
  const res = await fetch(`${SUPA.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.msg || "Identifiants invalides");
  return { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: body.expires_in, user: { id: body.user?.id, email: body.user?.email }, tenant: tenantOf(body.user?.id) };
}

// Cache de validation (60s) pour ne pas appeler GoTrue a chaque requete.
const cache = new Map(); // token -> { at, principal }
const TTL = 60_000;

// Valide un access_token utilisateur et renvoie { tenant, role, email } ou null.
export async function resolveBearer(token) {
  if (!SUPA || !token) return null;
  const hit = cache.get(token);
  if (hit && Date.now() - hit.at < TTL) return hit.principal;
  const res = await fetch(`${SUPA.url}/auth/v1/user`, { headers: { apikey: SUPA.key, authorization: `Bearer ${token}` } });
  if (!res.ok) { cache.delete(token); return null; }
  const u = await res.json().catch(() => null);
  if (!u?.id) return null;
  const principal = { tenant: tenantOf(u.id), role: "owner", email: u.email, userId: u.id };
  cache.set(token, { at: Date.now(), principal });
  return principal;
}
