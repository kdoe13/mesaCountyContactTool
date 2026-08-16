const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchHtml(url, { retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return await res.text();
      lastErr = new Error(`fetch failed: ${res.status} ${url}`);
      if (res.status < 500) break;
    } catch (err) {
      lastErr = new Error(`fetch failed: ${err.message} ${url}`);
    }
  }
  throw lastErr;
}
