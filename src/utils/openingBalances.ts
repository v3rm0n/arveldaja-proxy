import { forwardReadRequest } from './executor';
import { fetchAllJournals } from './journals';
import { setOpeningBalance } from '../db';

// Opening balances entered in e-arveldaja are stored as a journal with
// operation_type INITIAL ("Algbilansi seadistamine"). The /journals list
// endpoint hides these journals (even when filtered to their effective date),
// but GET /journals/{id} returns them — the only problem is finding the id.
//
// Journal ids are global across all e-arveldaja tenants, so the company's
// journals occupy a sparse slice of the id space; ids belonging to other
// companies return 409 "No such object". The INITIAL journal is created when
// the company sets up its books, so its id sits among the company's earliest
// journal ids. discoverInitialJournal() therefore scans the gaps between the
// company's listed journal ids in ascending order, with a bounded probe budget.

const round2 = (n: number): number => Math.round(n * 100) / 100;

const DEFAULT_MAX_PROBES = 500;
const MAX_MAX_PROBES = 2000;
const PROBE_CONCURRENCY = 5;

export interface DiscoveredOpeningBalances {
  journal: {
    id: number;
    number: number;
    title: string;
    effectiveDate: string;
  };
  balances: { account: string; amount: number }[];
  total: number;
  probesUsed: number;
}

async function fetchJournalById(id: number): Promise<any | null> {
  try {
    const journal = await forwardReadRequest('GET', `/journals/${id}`, {}, {});
    return journal && journal.id !== undefined ? journal : null;
  } catch {
    // 409 "No such object" — the id belongs to another company or nothing.
    return null;
  }
}

function isUsableInitialJournal(journal: any): boolean {
  return (
    journal !== null &&
    journal.operation_type === 'INITIAL' &&
    !journal.is_deleted &&
    journal.registered !== false
  );
}

async function discoverInitialJournal(opts: {
  journalId?: number;
  maxProbes?: number;
}): Promise<{ journal: any; probesUsed: number }> {
  if (opts.journalId !== undefined) {
    const journal = await fetchJournalById(opts.journalId);
    if (!journal) {
      throw new Error(`Journal ${opts.journalId} not found (the API answers "No such object")`);
    }
    if (!isUsableInitialJournal(journal)) {
      throw new Error(
        `Journal ${opts.journalId} ("${journal.title}") has operation_type ${journal.operation_type}` +
        `${journal.is_deleted ? ', is deleted' : ''}${journal.registered === false ? ', is unregistered' : ''}` +
        ' — expected a registered INITIAL journal'
      );
    }
    return { journal, probesUsed: 0 };
  }

  const listed = await fetchAllJournals();
  const ids = [...new Set<number>(listed.map((j: any) => j.id))].sort((a, b) => a - b);
  if (ids.length === 0) {
    throw new Error('No journals found to derive an id range from');
  }

  const maxProbes = Math.min(Math.max(opts.maxProbes ?? DEFAULT_MAX_PROBES, 1), MAX_MAX_PROBES);
  const candidates: number[] = [];
  for (let i = 1; i < ids.length && candidates.length < maxProbes; i++) {
    for (let id = ids[i - 1] + 1; id < ids[i] && candidates.length < maxProbes; id++) {
      candidates.push(id);
    }
  }

  let probesUsed = 0;
  for (let i = 0; i < candidates.length; i += PROBE_CONCURRENCY) {
    const batch = candidates.slice(i, i + PROBE_CONCURRENCY);
    const results = await Promise.all(batch.map(fetchJournalById));
    probesUsed += batch.length;

    const found = results.find(isUsableInitialJournal);
    if (found) {
      return { journal: found, probesUsed };
    }
  }

  throw new Error(
    `No INITIAL journal found within ${maxProbes} probed ids. ` +
    'If you can see the opening balance journal in e-arveldaja, pass its id as journalId; ' +
    'otherwise raise maxProbes or enter the opening balances manually.'
  );
}

// Convert an INITIAL journal's postings into signed opening balances. INITIAL
// postings use type 'I' with the amount stated in the account's natural
// direction (balance_type 'D' or 'C' from /accounts); plain D/C postings are
// mapped directly.
function extractOpeningBalances(
  journal: any,
  balanceTypeByAccount: Map<string, string>
): { account: string; amount: number }[] {
  const byAccount = new Map<string, number>();

  for (const posting of journal.postings || []) {
    if (posting.is_deleted) continue;

    const account = String(posting.accounts_id);
    const amount = parseFloat(String(posting.amount)) || 0;

    let signed: number;
    if (posting.type === 'D') {
      signed = amount;
    } else if (posting.type === 'C') {
      signed = -amount;
    } else {
      signed = balanceTypeByAccount.get(account) === 'C' ? -amount : amount;
    }

    byAccount.set(account, (byAccount.get(account) || 0) + signed);
  }

  return Array.from(byAccount.entries())
    .map(([account, amount]) => ({ account, amount: round2(amount) }))
    .filter((b) => b.amount !== 0)
    .sort((a, b) => a.account.localeCompare(b.account));
}

// Find the INITIAL journal (by explicit id or by probing), convert its
// postings to signed opening balances and store them in the local
// opening_balances table. Read-only towards e-Financials.
export async function discoverAndStoreOpeningBalances(opts: {
  journalId?: number;
  maxProbes?: number;
}): Promise<DiscoveredOpeningBalances> {
  const { journal, probesUsed } = await discoverInitialJournal(opts);

  const accountsData = await forwardReadRequest('GET', '/accounts', {}, {});
  const balanceTypeByAccount = new Map<string, string>(
    Array.isArray(accountsData)
      ? accountsData.map((a: any) => [String(a.id), a.balance_type])
      : []
  );

  const balances = extractOpeningBalances(journal, balanceTypeByAccount);
  if (balances.length === 0) {
    throw new Error(`INITIAL journal ${journal.id} ("${journal.title}") has no usable postings`);
  }

  for (const balance of balances) {
    await setOpeningBalance(balance.account, balance.amount);
  }

  return {
    journal: {
      id: journal.id,
      number: journal.number,
      title: journal.title,
      effectiveDate: journal.effective_date,
    },
    balances,
    total: round2(balances.reduce((sum, b) => sum + b.amount, 0)),
    probesUsed,
  };
}
