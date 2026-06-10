import { forwardReadRequest } from './executor';

// Short-lived in-memory cache for the full journal list. A single balance page
// load can trigger several requests (preset clicks, hide-zero toggle, refresh),
// each of which would otherwise re-paginate the entire journal history from the
// upstream API. Journal data only changes when an approved write is executed, so
// a short TTL is a safe trade-off. A single in-flight promise is shared so
// concurrent requests don't all fan out a full re-fetch.
const JOURNALS_CACHE_TTL_MS = 30_000;
let journalsCache: { data: any[]; expiresAt: number } | null = null;
let journalsInFlight: Promise<any[]> | null = null;

async function fetchAllJournalsUncached(): Promise<any[]> {
  const allJournals: any[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await forwardReadRequest('GET', '/journals', { page: String(page), per_page: '100' }, {});

    if (response && Array.isArray(response.items)) {
      allJournals.push(...response.items);
      totalPages = response.total_pages || 1;
    } else if (Array.isArray(response)) {
      allJournals.push(...response);
      break;
    }

    page++;
  } while (page <= totalPages);

  return allJournals;
}

export async function fetchAllJournals(): Promise<any[]> {
  if (journalsCache && journalsCache.expiresAt > Date.now()) {
    return journalsCache.data;
  }

  // Coalesce concurrent callers onto a single in-flight fetch.
  if (!journalsInFlight) {
    journalsInFlight = fetchAllJournalsUncached()
      .then((data) => {
        journalsCache = { data, expiresAt: Date.now() + JOURNALS_CACHE_TTL_MS };
        return data;
      })
      .finally(() => {
        journalsInFlight = null;
      });
  }

  return journalsInFlight;
}

// Invalidate the journal cache. Call this after a write is executed so freshly
// approved journals show up immediately instead of waiting for the TTL.
export function invalidateJournalsCache(): void {
  journalsCache = null;
}
