/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export async function somaFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = localStorage.getItem('gemini_api_key') || '';
  const headers = new Headers(options.headers || {});
  if (apiKey) {
    headers.set('x-gemini-api-key', apiKey);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  if (res.status === 400) {
    try {
      const data = await res.clone().json();
      if (data && data.error && (data.error.includes('API key') || data.error.includes('GEMINI_API_KEY') || data.error.includes('configured'))) {
        window.dispatchEvent(new CustomEvent('soma-open-api-settings', { detail: { error: data.error } }));
      }
    } catch (e) {}
  }

  return res;
}
