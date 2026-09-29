export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location) {
    const loc = window.location;
    // If accessing via single deployed port (e.g. 5000, 80, 443) or tunnel/public domain
    if (
      loc.port === '5000' ||
      loc.port === '80' ||
      loc.port === '443' ||
      loc.port === '' ||
      loc.hostname.includes('.loca.lt') ||
      loc.hostname.includes('.ngrok') ||
      loc.hostname.includes('.trycloudflare.com')
    ) {
      return loc.origin;
    }
    // If accessing via dev server (port 4200), redirect API calls to port 5000 of same host/IP
    return `${loc.protocol}//${loc.hostname}:5000`;
  }
  return 'http://localhost:5000';
}
