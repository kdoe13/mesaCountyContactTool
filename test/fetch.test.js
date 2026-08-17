import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchHtml } from '../scraper/lib/fetch.js';

function serve(handler) {
  return new Promise(resolve => {
    const srv = createServer(handler);
    srv.listen(0, () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('returns body and sends browser UA', async () => {
  let ua;
  const { srv, url } = await serve((req, res) => { ua = req.headers['user-agent']; res.end('<p>hi</p>'); });
  try {
    assert.equal(await fetchHtml(url), '<p>hi</p>');
    assert.match(ua, /Mozilla\/5\.0/);
  } finally { srv.close(); }
});

test('retries once on 500 then succeeds', async () => {
  let calls = 0;
  const { srv, url } = await serve((req, res) => {
    calls++;
    if (calls === 1) { res.statusCode = 500; res.end('boom'); } else res.end('ok');
  });
  try {
    assert.equal(await fetchHtml(url), 'ok');
    assert.equal(calls, 2);
  } finally { srv.close(); }
});

test('throws immediately on 4xx, no retry', async () => {
  let calls = 0;
  const { srv, url } = await serve((req, res) => {
    calls++;
    res.statusCode = 403; res.end();
  });
  try {
    await assert.rejects(() => fetchHtml(url), /fetch failed: 403/);
    assert.equal(calls, 1);
  } finally { srv.close(); }
});
