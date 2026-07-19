// Panoptic - clone ephemere d'un depot git pour l'audit "code + prod".
// Clone superficiel (--depth 1), URLs HTTPS uniquement, timeout, nettoyage garanti.
// Le scanner ne fait que LIRE les fichiers (regex), il n'execute jamais le code cloné.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// N'autorise que des URLs HTTPS de depots publics (pas de ssh, file://, git://).
function safeRepoUrl(url) {
  if (!/^https:\/\/[\w.-]+\/[\w./-]+$/.test(url)) return null;
  if (/[;&|`$(){}<>\\]/.test(url)) return null;             // pas d'injection shell
  return url.replace(/\.git$/, "") + ".git";
}

/**
 * Clone un depot et renvoie { dir, cleanup }. Appeler cleanup() dans un finally.
 * @param {string} url  URL HTTPS du depot
 */
export async function cloneRepo(url) {
  const safe = safeRepoUrl(url);
  if (!safe) throw new Error("URL de depot invalide (HTTPS publique attendue)");
  const dir = mkdtempSync(join(tmpdir(), "panoptic-repo-"));
  const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } };

  await new Promise((resolve, reject) => {
    // execFile (pas de shell) + arguments en tableau = pas d'interpretation shell.
    const child = execFile("git", ["clone", "--depth", "1", "--single-branch", safe, dir],
      { timeout: 60000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err) => { if (err) { cleanup(); reject(new Error(`clone echoue: ${err.message.split("\n")[0]}`)); } else resolve(); });
    child.on("error", (e) => { cleanup(); reject(e); });
  });

  return { dir, cleanup };
}
