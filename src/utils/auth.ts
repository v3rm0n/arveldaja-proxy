import crypto from 'crypto';
import { ApiCredentials } from '../types';

export function signRequest(
  method: string,
  path: string,
  credentials: ApiCredentials
): { 'X-AUTH-QUERYTIME': string; 'X-AUTH-KEY': string } {
  const timestamp = getUtcTimestamp();
  
  // Sign only the path (not query params)
  const pathToSign = path.split('?')[0];
  const payload = `${credentials.apiKeyId}:${timestamp}:${pathToSign}`;
  
  const signature = crypto
    .createHmac('sha384', credentials.apiKeyPassword)
    .update(payload)
    .digest('base64');
  
  return {
    'X-AUTH-QUERYTIME': timestamp,
    'X-AUTH-KEY': `${credentials.apiKeyPublic}:${signature}`,
  };
}

function getUtcTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace(/\.\d{3}Z$/, '');
}

export function extractAuthHeaders(headers: Record<string, string | string[] | undefined>): {
  queryTime?: string;
  apiKeyPublic?: string;
  signature?: string;
} {
  const queryTime = headers['x-auth-querytime'] as string | undefined;
  const authKey = headers['x-auth-key'] as string | undefined;
  
  if (!authKey) return {};
  
  const parts = authKey.split(':');
  if (parts.length !== 2) return {};
  
  return {
    queryTime,
    apiKeyPublic: parts[0],
    signature: parts[1],
  };
}

export function verifySignature(
  apiKeyId: string,
  apiKeyPassword: string,
  queryTime: string,
  path: string,
  providedSignature: string
): boolean {
  const payload = `${apiKeyId}:${queryTime}:${path}`;
  
  const expectedSignature = crypto
    .createHmac('sha384', apiKeyPassword)
    .update(payload)
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(providedSignature),
    Buffer.from(expectedSignature)
  );
}
