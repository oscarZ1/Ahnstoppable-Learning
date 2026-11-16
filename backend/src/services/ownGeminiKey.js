// src/services/ownGeminiKey.js
// Calls Google Gemini with a student's own API key (services/aiKeys.js)
// instead of the shared one. The caller builds the request (model, system
// prompt, settings), so it's the same request either way; only the key, and
// whose quota pays for it, differ. BYO_GEMINI_BASE_URL points the SDK
// elsewhere (the browser tests use a fake API that way).
//
// Errors become AiErrors that talk about the student's own account. Only the
// model and HTTP status are logged: Google's error messages can echo parts of
// the request.
import { GoogleGenAI, ApiError } from '@google/genai';
import { AiError, logUsage } from './gemini.js';

const TIMEOUT_MS = 60_000;

// Which kind of failure. Never a 401 to the browser: the site treats that as
// "signed out".
function toAiError(err) {
  if (!(err instanceof ApiError)) return new AiError(503, "Couldn't reach Google Gemini. Please try again shortly.");
  // Gemini answers a bad key with 400 "API key not valid".
  if (err.status === 401 || err.status === 403 || (err.status === 400 && /api[_ ]key/i.test(err.message))) {
    return new AiError(400, "Your Gemini API key was rejected. Check it, or remove it to use the school's assistant.");
  }
  if (err.status === 402) {
    return new AiError(402, "Your Google account has a billing problem. Fix it in Google AI Studio, or remove your key to use the school's assistant.");
  }
  if (err.status === 404) {
    return new AiError(400, "Your Gemini API key can't use the assistant's model. Check the key's project in Google AI Studio.");
  }
  if (err.status === 429) return new AiError(429, 'Your Gemini account hit its rate limit. Wait a minute and try again.', 60);
  if (err.status >= 500) return new AiError(503, 'Google Gemini is busy or having problems right now. Please try again in a few minutes.');
  return new AiError(502, 'Google Gemini had a problem with this request. Please try again.');
}

// One call with the student's key: { feature, apiKey, model, contents, config }.
// Returns { response, model }, like gemini.js generate(); throws an AiError.
export async function generateWithOwnKey({ feature, apiKey, model, contents, config }) {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: TIMEOUT_MS,
      retryOptions: { attempts: 1 },
      ...(process.env.BYO_GEMINI_BASE_URL ? { baseUrl: process.env.BYO_GEMINI_BASE_URL } : {}),
    },
  });
  try {
    const response = await client.models.generateContent({ model, contents, config });
    logUsage(`${feature} (own key)`, model, response.usageMetadata);
    return { response, model };
  } catch (err) {
    console.warn(`${feature}: own Gemini key failed on ${model} (${err instanceof ApiError ? err.status : 'unreachable'}).`);
    throw toAiError(err);
  }
}

// A tiny test call before a key is saved, so a bad key is refused right away.
// Any answer, even a cut-off or refused one, proves the key works.
export async function verifyKey({ apiKey, model, config = {} }) {
  await generateWithOwnKey({
    feature: 'Key check', apiKey, model,
    contents: [{ role: 'user', parts: [{ text: 'Say OK.' }] }],
    config: { ...config, systemInstruction: 'Reply with the single word OK.' },
  });
}
