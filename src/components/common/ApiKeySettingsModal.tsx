/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Key, X, CheckCircle2, ShieldAlert, ExternalLink } from 'lucide-react';

interface ApiKeySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialError?: string;
}

export function ApiKeySettingsModal({ isOpen, onClose, initialError }: ApiKeySettingsModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState(initialError || '');

  useEffect(() => {
    const existing = localStorage.getItem('gemini_api_key') || '';
    setApiKey(existing);
    if (initialError) {
      setErrorMsg(initialError);
    }
  }, [isOpen, initialError]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a valid Gemini API key.');
      return;
    }
    localStorage.setItem('gemini_api_key', trimmed);
    setSaved(true);
    setErrorMsg('');
    setTimeout(() => {
      setSaved(false);
      onClose();
      window.location.reload();
    }, 1000);
  };

  const handleClear = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKey('');
    setSaved(false);
    setErrorMsg('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-neutral-100">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
              <Key className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">SOMA Intelligence Settings</h3>
              <p className="text-xs text-blue-100">Configure Gemini API Key for external hosting</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800 leading-relaxed font-medium">
                {errorMsg}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider">
              Gemini API Key (AIza...)
            </label>
            <input 
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full px-4 py-3 rounded-xl border border-neutral-300 focus:ring-2 focus:ring-blue-600 focus:border-blue-600 text-sm font-mono transition-all outline-none"
            />
            <p className="text-[11px] text-neutral-500 leading-normal">
              When using SOMA AI Mentor outside AI Studio (e.g. on your custom domain <span className="font-semibold text-neutral-700">soma-app.me</span> or in incognito), provide your personal Gemini API key. It is saved securely in your browser's local storage only.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Get a Gemini API Key <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <div className="flex items-center gap-2">
              {apiKey && (
                <button 
                  type="button"
                  onClick={handleClear}
                  className="px-3 py-2 text-xs font-medium text-neutral-600 hover:text-red-600 transition-colors"
                >
                  Clear Key
                </button>
              )}
              <button 
                type="submit"
                disabled={saved}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 disabled:bg-emerald-600"
              >
                {saved ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 animate-bounce" /> Saved & Reloading...
                  </>
                ) : (
                  'Save & Connect SOMA'
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
