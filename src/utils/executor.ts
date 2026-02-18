import { PendingChange, ApiCredentials } from '../types';

const DEFAULT_BASE_URL = 'https://demo-rmp-api.rik.ee/v1';

export async function executeChange(change: PendingChange): Promise<any> {
  // Get credentials from environment
  const credentials: ApiCredentials = {
    apiKeyId: process.env.API_KEY_ID || '',
    apiKeyPublic: process.env.API_KEY_PUBLIC || '',
    apiKeyPassword: process.env.API_KEY_PASSWORD || '',
    baseUrl: process.env.API_BASE_URL || DEFAULT_BASE_URL,
  };
  
  if (!credentials.apiKeyId || !credentials.apiKeyPublic || !credentials.apiKeyPassword) {
    throw new Error('API credentials not configured');
  }
  
  // Convert proxy path to API path: /proxy/v1/xxx -> /v1/xxx
  const apiPath = change.path.replace(/^\/proxy/, '');
  
  // Build full URL - strip /v1 from path since baseUrl already has it
  const baseUrl = credentials.baseUrl.endsWith('/') ? credentials.baseUrl : credentials.baseUrl + '/';
  const pathWithoutV1 = apiPath.replace(/^\/v1\//, '');
  const cleanPath = pathWithoutV1.startsWith('/') ? pathWithoutV1.slice(1) : pathWithoutV1;
  const url = new URL(cleanPath, baseUrl);
  Object.entries(change.query).forEach(([key, value]) => {
    if (value) url.searchParams.append(key, value);
  });
  
  // Import auth module dynamically to avoid circular deps
  const { signRequest } = await import('./auth');
  
  // Generate fresh auth headers - path must include /v1 prefix for signing
  const signPath = apiPath.startsWith('/v1/') ? apiPath : '/v1' + (apiPath.startsWith('/') ? apiPath : '/' + apiPath);
  const authHeaders = signRequest(change.method, signPath, credentials);
  
  // Transform body format if needed (transactions -> postings)
  let requestBody = change.body;
  if (change.body && change.path.includes('/journals')) {
    try {
      const bodyObj = JSON.parse(change.body);
      if (bodyObj.transactions && !bodyObj.postings) {
        // Convert simplified format to API format
        const postings = [];
        for (const tx of bodyObj.transactions) {
          if (tx.debit_account) {
            postings.push({
              accounts_id: parseInt(tx.debit_account),
              type: 'D',
              amount: parseFloat(tx.amount),
              base_amount: parseFloat(tx.amount),
              cl_currencies_id: 'EUR',
              is_deleted: false,
            });
          }
          if (tx.credit_account) {
            postings.push({
              accounts_id: parseInt(tx.credit_account),
              type: 'C',
              amount: parseFloat(tx.amount),
              base_amount: parseFloat(tx.amount),
              cl_currencies_id: 'EUR',
              is_deleted: false,
            });
          }
        }
        
        const apiBody = {
          ...bodyObj,
          postings,
        };
        delete apiBody.transactions;
        requestBody = JSON.stringify(apiBody);
      }
    } catch (e) {
      console.error('Failed to transform body:', e);
    }
  }
  
  // Execute request
  const response = await fetch(url.toString(), {
    method: change.method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: requestBody || undefined,
  });
  
  const responseData = await response.json();
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${JSON.stringify(responseData)}`);
  }
  
  return responseData;
}

export async function forwardReadRequest(
  method: string,
  path: string,
  query: Record<string, string>,
  headers: Record<string, string>
): Promise<any> {
  const credentials: ApiCredentials = {
    apiKeyId: process.env.API_KEY_ID || '',
    apiKeyPublic: process.env.API_KEY_PUBLIC || '',
    apiKeyPassword: process.env.API_KEY_PASSWORD || '',
    baseUrl: process.env.API_BASE_URL || DEFAULT_BASE_URL,
  };
  
  if (!credentials.apiKeyId || !credentials.apiKeyPublic || !credentials.apiKeyPassword) {
    throw new Error('API credentials not configured');
  }
  
  // Build full URL - ensure base URL ends with / and path doesn't start with /
  const baseUrl = credentials.baseUrl.endsWith('/') ? credentials.baseUrl : credentials.baseUrl + '/';
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(cleanPath, baseUrl);
  Object.entries(query).forEach(([key, value]) => {
    if (value) url.searchParams.append(key, value);
  });
  
  const { signRequest } = await import('./auth');
  // The path for signing must include /v1 prefix
  const signPath = path.startsWith('/v1/') ? path : '/v1' + (path.startsWith('/') ? path : '/' + path);
  const authHeaders = signRequest(method, signPath, credentials);
  
  const response = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
  });
  
  const responseData = await response.json();
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status} - ${JSON.stringify(responseData)}`);
  }
  
  return responseData;
}
