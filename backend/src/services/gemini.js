// src/services/gemini.js
// The Gemini plumbing shared by every AI feature (question summaries, the
// study assistant): one client, one API key, one quota, one overload skip.
// The study assistant pins its own model (ASSISTANT_MODEL in
// services/studyAssistant.js); the settings below are for the summaries.
// Both use Gemini 3.5 Flash-Lite by default: the cheapest current model.
//
// The API key stays on the server (GEMINI_API_KEY). GEMINI_MODEL picks another
// model; GEMINI_BASE_URL can point the SDK elsewhere (the browser tests use a
// fake API that way).
//
// Staying fast and inside the free tier:
//   - thinking is turned down (GEMINI_THINKING_LEVEL, default "low"), since
//     thinking tokens count against the quota;
//   - if the main model is rate-limited, overloaded or unreachable, an
//     optional fallback model (GEMINI_FALLBACK_MODEL; none by default) is
//     tried straight away, since each model has its own free-tier quota;
//   - an overloaded main model is skipped for a few minutes afterwards
//     (GEMINI_OVERLOAD_SKIP_SECONDS), because Google can take 10–15 seconds
//     to say it's overloaded, and it usually stays that way for a while;
//   - the same model is retried only when that can help: a per-minute limit
//     that Google says clears within a few seconds, or an overloaded model
//     when there's nothing to fall back to. A per-day limit is never retried.
import { GoogleGenAI, ApiError } from '@google/genai';

export const MAIN_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const fallbackSetting = process.env.GEMINI_FALLBACK_MODEL || 'none';
export const FALLBACK_MODEL = fallbackSetting === 'none' || fallbackSetting === MAIN_MODEL ? null : fallbackSetting;
// "default" leaves thinking to the model (needed for models without thinking levels).
const THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL || 'low';

// Retry the same model only if Google asks us to wait this long or less.
const MAX_RETRY_WAIT_SECONDS = 10;
// Wait before retrying an overloaded (5xx) model when there's no fallback.
const OVERLOAD_RETRY_SECONDS = 2;
// How long to go straight to the fallback after the main model was overloaded.
const OVERLOAD_SKIP_MS = Number(process.env.GEMINI_OVERLOAD_SKIP_SECONDS || 300) * 1000;
let mainSkippedUntil = 0;

// Finish reasons meaning Gemini declined to answer.
export const BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'LANGUAGE', 'OTHER']);

// A problem the user should see as a plain message. retryAfter (seconds) is
// set when we know how long to wait before trying again.
export class AiError extends Error {
  constructor(status, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

let client = null;
function getClient() {
  client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      // An answer normally takes a few seconds; past this, the fallback is quicker.
      timeout: 30_000,
      // No automatic retries: generate() decides when retrying can help.
      retryOptions: { attempts: 1 },
      ...(process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
    },
  });
  return client;
}

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// The shared thinking setting, unless the caller set its own.
function withDefaults(config) {
  if (THINKING_LEVEL === 'default' || config.thinkingConfig) return config;
  return { ...config, thinkingConfig: { thinkingLevel: THINKING_LEVEL } };
}

function callModel(model, request) {
  return getClient().models.generateContent({ model, contents: request.contents, config: withDefaults(request.config) });
}

// What a Gemini 429 says about the limit: the SDK puts Google's JSON error body
// in err.message. Its details name the quota (per-minute or per-day) and often
// how long to wait ("retryDelay": "37s").
function quotaInfo(err) {
  let details = [];
  try {
    const text = String(err.message ?? '');
    details = JSON.parse(text.slice(text.indexOf('{'))).error?.details ?? [];
  } catch { /* not JSON: no details */ }
  if (!Array.isArray(details)) details = [];
  const retryDelay = details.find((d) => String(d?.['@type']).endsWith('RetryInfo'))?.retryDelay;
  const seconds = Number.parseFloat(retryDelay);
  const quotaIds = details
    .filter((d) => String(d?.['@type']).endsWith('QuotaFailure'))
    .flatMap((d) => d.violations ?? [])
    .map((v) => String(v?.quotaId ?? ''));
  return {
    retryAfter: Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null,
    daily: quotaIds.some((id) => /PerDay/i.test(id)),
  };
}

const isApiStatus = (err, test) => err instanceof ApiError && test(err.status);
const isOverloaded = (err) => isApiStatus(err, (s) => s >= 500);
const isRateLimit  = (err) => isApiStatus(err, (s) => s === 429);

const isUnreachable = (err) => !(err instanceof ApiError);   // no connection, DNS, or the timeout

// Seconds to wait before retrying the same model, or null when retrying won't
// help (or the next model is the better bet).
function retryWait(err, isLastModel) {
  if (isOverloaded(err)) return isLastModel ? OVERLOAD_RETRY_SECONDS : null;
  if (isRateLimit(err)) {
    const { retryAfter, daily } = quotaInfo(err);
    if (!daily && retryAfter != null && retryAfter <= MAX_RETRY_WAIT_SECONDS) return retryAfter;
  }
  return null;
}

async function tryModel(feature, model, request, isLastModel) {
  try {
    return await callModel(model, request);
  } catch (err) {
    const wait = retryWait(err, isLastModel);
    if (wait == null) throw err;
    console.warn(`${feature}: ${model} returned ${err.status}; retrying in ${wait}s.`);
    await sleep(wait);
    return callModel(model, request);
  }
}

// One Gemini call: the main model, then the fallback model if the main one was
// rate-limited, overloaded or unreachable. `feature` names it in the logs.
// `model` pins one model instead: no fallback, no overload skip.
// Returns { response, model }; throws an AiError.
export async function generate({ feature, contents, config, model: only = null }) {
  if (!aiConfigured()) {
    throw new AiError(503, "AI features aren't set up yet. Add a GEMINI_API_KEY to the server.");
  }
  const request = { contents, config };
  const skipMain = FALLBACK_MODEL && Date.now() < mainSkippedUntil;
  const models = only ? [only]
    : skipMain ? [FALLBACK_MODEL] : [MAIN_MODEL, FALLBACK_MODEL].filter(Boolean);
  let firstErr;
  for (const [i, model] of models.entries()) {
    try {
      const response = await tryModel(feature, model, request, i === models.length - 1);
      if (!only && model !== MAIN_MODEL) console.warn(`${feature}: used the fallback model ${model}.`);
      logUsage(feature, model, response.usageMetadata);
      return { response, model };
    } catch (err) {
      logFailure(feature, model, err);
      firstErr ??= err;
      if (!only && model === MAIN_MODEL && FALLBACK_MODEL && (isOverloaded(err) || isUnreachable(err)) && OVERLOAD_SKIP_MS > 0) {
        mainSkippedUntil = Date.now() + OVERLOAD_SKIP_MS;
        console.warn(`${feature}: using ${FALLBACK_MODEL} for the next ${OVERLOAD_SKIP_MS / 1000}s.`);
      }
      if (!isRateLimit(err) && !isOverloaded(err) && !isUnreachable(err)) break;
    }
  }
  // Report the first model's problem: that's the one that matters when trying again.
  throw toAiError(firstErr);
}

// Turn a refused or cut-off answer into an AiError. `messages` overrides the
// wording: { refused, cutOff }.
export function checkFinished(feature, response, messages = {}) {
  const blockReason = response.promptFeedback?.blockReason;
  const finishReason = response.candidates?.[0]?.finishReason;
  if (blockReason || BLOCKED.has(finishReason)) {
    console.warn(`${feature} refused:`, blockReason ?? finishReason);
    throw new AiError(422, messages.refused ?? "The AI couldn't help with this.");
  }
  if (finishReason === 'MAX_TOKENS') {
    throw new AiError(502, messages.cutOff ?? "The AI's answer was cut off. Please try again.");
  }
}

export function logFailure(feature, model, err) {
  if (!(err instanceof ApiError)) {
    console.error(`${feature}: could not reach the Gemini API (${model}):`, err.message);
  } else if (err.status === 429) {
    console.warn(`${feature}: Gemini rate limit (429) on ${model}:`, err.message);
  } else if (err.status === 503) {
    console.warn(`${feature}: Gemini overloaded (503) on ${model}:`, err.message);
  } else {
    console.error(`${feature}: Gemini API error ${err.status} on ${model}:`, err.message);
  }
}

export function toAiError(err) {
  if (!(err instanceof ApiError)) {
    // No connection, DNS, or the timeout.
    return new AiError(503, "Couldn't reach the AI service. Please try again shortly.");
  }
  // An invalid key comes back as 400 "API key not valid".
  if (err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message))) {
    return new AiError(503, "AI features aren't set up correctly (the API key was rejected).");
  }
  if (err.status === 429) {
    const { retryAfter, daily } = quotaInfo(err);
    if (daily) {
      return new AiError(429, "Today's free AI limit has been used up. It should work again tomorrow.");
    }
    if (retryAfter != null) {
      return new AiError(429, `You've hit the AI service's usage limit. Please try again in about ${retryAfter} seconds.`, retryAfter);
    }
    return new AiError(429, "You've hit the AI service's usage limit. Please try again in a minute. If it keeps happening, today's free limit may be used up.");
  }
  if (err.status === 503) {
    return new AiError(503, "Google's AI service is overloaded right now. Please try again in a few minutes.");
  }
  return new AiError(502, 'The AI service had a problem. Please try again.');
}

// One line per call, to see how close we are to the free-tier limits.
export function logUsage(feature, model, usage) {
  if (!usage) return;
  console.info(
    `${feature}: ${model} used ${usage.promptTokenCount ?? 0} input, ` +
    `${usage.candidatesTokenCount ?? 0} output and ${usage.thoughtsTokenCount ?? 0} thinking tokens.`
  );
}
