// src/components/assistant/AssistantKeySettings.jsx
// "Use your own Gemini key": a student with their own Google Gemini API key
// can paste it, and the assistant answers with their account instead of the
// school's shared key (same model, same rules). The server checks the key with
// a tiny test call before saving it, stores it encrypted, and only ever shows
// its last four characters. onChange runs after a key is saved or removed.
import React, { useEffect, useState } from "react";
import api from "../../api/axios";

const FIELD = "w-full std-text text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 px-3 py-2 rounded-md outline-blue-600 focus:ring-2 focus:ring-blue-500/20 placeholder-slate-400 dark:placeholder-slate-500";

function AssistantKeySettings({ onChange }) {
  const [info,   setInfo]   = useState(null);   // { available, model, key }
  const [apiKey, setApiKey] = useState("");
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let ignore = false;
    api.get("/api/me/ai-key")
      .then((res) => { if (!ignore) setInfo(res.data); })
      .catch((err) => console.error("Failed to load your AI key settings:", err));
    return () => { ignore = true; };
  }, []);

  if (!info) return <p className="text-xs text-slate-400 animate-pulse">Loading…</p>;
  if (!info.available) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Using your own AI key isn't turned on for this website yet.
      </p>
    );
  }

  async function save(e) {
    e.preventDefault();
    if (!apiKey.trim() || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const { data } = await api.put("/api/me/ai-key", { api_key: apiKey.trim() });
      setInfo((i) => ({ ...i, key: data.key }));
      setApiKey("");
      setNotice("Saved. The assistant now answers with your Gemini key.");
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't save your key. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove your Gemini key? The assistant goes back to the school's shared key.")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await api.delete("/api/me/ai-key");
      setInfo((i) => ({ ...i, key: null }));
      setNotice("Removed. The assistant uses the school's shared key again.");
      onChange?.();
    } catch (err) {
      setError(err.response?.data?.error ?? "Couldn't remove your key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm std-text">
      <p className="text-slate-600 dark:text-slate-300">
        The assistant runs on Google's {info.model}. If you have your own Gemini API key, it can answer with your
        account instead of the school's shared key: same model, same private chat, and your account's limits.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        This needs a Gemini <strong>API key</strong> from Google AI Studio. A Gemini app subscription isn't an API key and can't be used here.
      </p>

      {info.key ? (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 flex items-center justify-between gap-2">
          <p className="font-medium">Using your Gemini key ••••{info.key.last4}</p>
          <button type="button" className="white-btn text-xs py-1.5" onClick={remove} disabled={busy}>
            Remove
          </button>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">No key added. The assistant uses the school's shared key.</p>
      )}

      <form onSubmit={save} className="flex flex-col gap-2" aria-label="Add your own Gemini key">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold">Gemini API key</span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={FIELD}
            value={apiKey}
            onChange={(e) => { setError(null); setNotice(null); setApiKey(e.target.value); }}
            placeholder="Paste your key from Google AI Studio"
            disabled={busy}
          />
        </label>
        <button type="submit" className="blue-btn text-xs py-1.5 self-end" disabled={!apiKey.trim() || busy}>
          {busy ? "Checking the key…" : info.key ? "Replace key" : "Save key"}
        </button>
      </form>

      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      {notice && <p role="status" className="text-xs text-green-600 dark:text-green-400">{notice}</p>}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Your messages, plus the class material when you ask in a class, are sent to Google under your own account's
        terms. The key is checked with a tiny test request, stored encrypted, and never shown again in full. Remove it
        here at any time.
      </p>
    </div>
  );
}

export default AssistantKeySettings;
