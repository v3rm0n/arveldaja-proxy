export interface Changeset {
  id: string;
  name: string;
  description?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface PendingChange {
  id: string;
  changesetId?: string;
  method: string;
  path: string;
  originalUrl: string;
  headers: Record<string, string>;
  body: string | null;
  query: Record<string, string>;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  response: string | null;
  error: string | null;
}

export interface JournalEntry {
  id: number;
  no: string;
  effective_date: string;
  description: string;
  type: 'MANUAL' | 'OTHER';
  status: 'REGISTERED' | 'INVALID' | 'PENDING';
  transactions: TransactionLine[];
}

export interface TransactionLine {
  id: number;
  debit_account: string;
  credit_account: string;
  amount: string;
  description: string;
  client_id: number | null;
}

export interface ApiCredentials {
  apiKeyId: string;
  apiKeyPublic: string;
  apiKeyPassword: string;
  baseUrl: string;
}
