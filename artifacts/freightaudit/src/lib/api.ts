/**
 * Returns the full URL for an API endpoint path.
 * In the Replit monorepo, the api-server is mounted at /api.
 *
 * @param path  e.g. "/fleet-analysis/summary" → "/api/fleet-analysis/summary"
 */
export function getApiUrl(path: string): string {
  const base = "/api";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
