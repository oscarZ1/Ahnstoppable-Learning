// A stand-in for the Gemini API, so the browser tests exercise the real SDK
// call path without a key or any cost. The backend is started with
// GEMINI_BASE_URL pointing here.
//   POST /v1beta/models/<model>:generateContent – answers like the real API
//                                                 (mode: ok | refusal | overloaded | rate_limit
//                                                  | rate_limit_minute | rate_limit_brief | rate_limit_daily)
//   POST /__mode        – { mode, model?, times? } switch behaviour; with model, only
//                         that model misbehaves; with times, only the next N calls do
//   GET  /__requests    – every generateContent request received so far
import http from 'node:http';
import { FAKE_GEMINI_PORT } from './test-db.js';

let mode = 'ok';
let onlyModel = null;   // misbehave only for this model
let timesLeft = null;   // misbehave only this many more times
const requests = [];

// Google's 429 body: which quota was hit, and how long to wait.
function rateLimitBody(quotaId, retryDelay) {
  return {
    error: {
      code: 429,
      message: 'You exceeded your current quota. (fake)',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay },
      ],
    },
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function fakeSummary(body) {
  const text = (body.contents ?? []).flatMap((c) => c.parts ?? []).map((p) => p.text ?? '').join('\n');
  const count = (text.match(/^Q\d+: /gm) ?? []).length;
  const numbers = Array.from({ length: count }, (_, i) => i + 1);
  return {
    overview: `Fake overview of ${count} questions.`,
    themes: [{ title: 'Fake theme', description: 'Every question, grouped by the fake API.', question_numbers: numbers }],
    confusions: ['Fake confusion'],
    suggested_followups: ['Fake follow-up'],
  };
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/__requests') return send(res, 200, requests);
    if (req.method === 'POST' && url.pathname === '/__mode') {
      const body = JSON.parse(raw || '{}');
      mode = body.mode ?? 'ok';
      onlyModel = body.model ?? null;
      timesLeft = body.times ?? null;
      return send(res, 200, { mode });
    }
    const match = url.pathname.match(/^\/v1beta\/models\/([^/:]+):generateContent$/);
    if (req.method === 'POST' && match) {
      const body = JSON.parse(raw || '{}');
      const model = decodeURIComponent(match[1]);
      requests.push({ model, body, headers: { apiKey: req.headers['x-goog-api-key'] ?? null } });
      let current = mode;
      if (onlyModel && model !== onlyModel) current = 'ok';
      if (current !== 'ok' && timesLeft != null) {
        if (timesLeft <= 0) current = 'ok';
        else timesLeft -= 1;
      }
      if (current === 'rate_limit_minute') return send(res, 429, rateLimitBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '40s'));
      if (current === 'rate_limit_brief')  return send(res, 429, rateLimitBody('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '1s'));
      if (current === 'rate_limit_daily')  return send(res, 429, rateLimitBody('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '52000s'));
      if (current === 'rate_limit') {
        return send(res, 429, { error: { code: 429, message: 'Fake rate limit', status: 'RESOURCE_EXHAUSTED' } });
      }
      if (current === 'overloaded') {
        return send(res, 503, { error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } });
      }
      const base = { modelVersion: model, usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } };
      if (current === 'refusal') {
        return send(res, 200, { ...base, candidates: [{ finishReason: 'SAFETY', index: 0 }] });
      }
      return send(res, 200, {
        ...base,
        candidates: [{
          content: { role: 'model', parts: [{ text: JSON.stringify(fakeSummary(body)) }] },
          finishReason: 'STOP', index: 0,
        }],
      });
    }
    send(res, 404, { error: { code: 404, message: `No fake for ${req.method} ${url.pathname}`, status: 'NOT_FOUND' } });
  });
});

server.listen(FAKE_GEMINI_PORT, () => console.log(`fake Gemini API on ${FAKE_GEMINI_PORT}`));
