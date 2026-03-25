import config from './config';

export async function getXrayToken(): Promise<string> {
  const { xrayApiBaseUrl, xrayClientId, xrayClientSecret } = config;

  if (!xrayClientId || !xrayClientSecret) {
    throw new Error('XRAY_CLIENT_ID and XRAY_CLIENT_SECRET must be set in environment');
  }

  const url = `${xrayApiBaseUrl}/authenticate`;
  const body = JSON.stringify({
    client_id: xrayClientId,
    client_secret: xrayClientSecret
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Xray token (${res.status}): ${text}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  let token: string | null = null;

  if (contentType.includes('application/json')) {
    const data = await res.json();
    token = typeof data === 'string' ? data : data?.token;
  } else {
    token = (await res.text()).trim();
  }

  if (!token) {
    const bodyText = await res.text();
    throw new Error(`Invalid Xray token response: ${bodyText}`);
  }

  console.log('getXrayToken: received token length', token.length);
  return token;
}
