import { useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import {
  clearAuthToken,
  getAuthToken,
  getServerUrl,
  isDemoMode,
  isNativePlatform,
  normalizeServerUrl,
  setAuthToken,
  setDemoMode,
  setServerUrl,
} from '../lib/apiClient';
import { getSecureStorageLabel } from '../lib/secureStorage';
import {
  checkAndInstallDesktopUpdate,
  isTauriDesktop,
  type DesktopUpdateCheckResult,
} from '../lib/updater';
import type { AuthLoginResponse } from '../types';

interface ServerConfigModalProps {
  open: boolean;
  initialMessage?: string | null;
  onClose: () => void;
  onApplied: () => void;
}

export function ServerConfigModal({
  open,
  initialMessage,
  onClose,
  onApplied,
}: ServerConfigModalProps) {
  const [urlInput, setUrlInput] = useState<string>(() => getServerUrl());
  const [tokenInput, setTokenInput] = useState<string>(() => getAuthToken());
  const [testing, setTesting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<DesktopUpdateCheckResult | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);

  if (!open) return null;

  const demoActive = isDemoMode();
  const nativeApp = isNativePlatform();
  const tauriDesktop = isTauriDesktop();
  const currentServer = getServerUrl();
  const storageLabel = getSecureStorageLabel();

  const handleConnectServer = async (e: FormEvent) => {
    e.preventDefault();
    const normalized = normalizeServerUrl(urlInput);
    if (!normalized) {
      setFeedback({
        type: 'error',
        text: 'Saisissez une URL valide (ex: https://pve-panel.example.ts.net).',
      });
      return;
    }

    setTesting(true);
    setFeedback(null);
    try {
      const headers = new Headers();
      if (tokenInput.trim()) {
        headers.set('Authorization', `Bearer ${tokenInput.trim()}`);
      }
      const resp = await fetch(`${normalized}/api/me`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      if (resp.status === 401 && !tokenInput.trim()) {
        const probeResp = await fetch(`${normalized}/api/onboarding/status`, {
          method: 'GET',
          credentials: 'include',
        });
        if (probeResp.ok) {
          const probeData = (await probeResp.json().catch(() => ({}))) as {
            server_id?: string;
            auth_methods?: unknown[];
          };
          if (probeData?.server_id || Array.isArray(probeData?.auth_methods)) {
            setDemoMode(false);
            setServerUrl(normalized);
            clearAuthToken();
            setFeedback({
              type: 'success',
              text: 'Serveur PVE Center détecté — authentification PIN ou Bearer requise.',
            });
            onApplied();
            return;
          }
        }
      }
      if (!resp.ok) {
        throw new Error(`Le serveur a répondu HTTP ${resp.status}.`);
      }
      const data = (await resp.json()) as { login?: string };
      if (!data?.login) {
        throw new Error('Réponse inattendue : vérifiez que le serveur cible pointe vers pve-panel.');
      }
      setDemoMode(false);
      setServerUrl(normalized);
      if (tokenInput.trim()) {
        setAuthToken(tokenInput.trim());
      } else {
        clearAuthToken();
      }
      setFeedback({
        type: 'success',
        text: `Connecté en tant que ${data.login}.`,
      });
      onApplied();
    } catch (err) {
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? `${err.message} Vérifiez l’URL, le jeton Bearer ou activez le Mode Démo.`
            : 'Connexion impossible. Vérifiez Tailscale ou activez le Mode Démo.',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleEnableDemo = () => {
    setDemoMode(true);
    setFeedback(null);
    onApplied();
  };

  const handleUseLocalOrigin = () => {
    setDemoMode(false);
    setServerUrl('');
    setUrlInput('');
    if (tokenInput.trim()) {
      setAuthToken(tokenInput.trim());
    }
    setFeedback(null);
    onApplied();
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    const res = await checkAndInstallDesktopUpdate(false);
    setUpdateResult(res);
    setCheckingUpdate(false);
  };

  const handleInstallUpdate = async () => {
    if (updateResult?.status !== 'available') return;
    setInstallingUpdate(true);
    try {
      await updateResult.install();
    } catch (err) {
      setUpdateResult({
        status: 'unavailable',
        message: err instanceof Error ? err.message : 'Échec d’installation de la mise à jour.',
      });
      setInstallingUpdate(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="ios-sheet safe-bottom-sheet max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[32px] p-5 text-slate-900 dark:text-slate-100 sm:rounded-3xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex justify-center sm:hidden">
          <div className="ios-grabber" />
        </div>

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/35 bg-cyan-500/15 text-cyan-600 shadow-inner dark:text-cyan-300">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Connexion Serveur &amp; Mode Démo
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {demoActive
                  ? 'Actuellement en Mode Démo interactif'
                  : currentServer
                    ? `Connecté à ${currentServer}`
                    : nativeApp
                      ? 'Aucun serveur configuré sur cet appareil'
                      : 'Connecté à l’hôte local'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="liquid-pill rounded-full p-2 text-slate-500 transition hover:text-slate-900 active:scale-95 dark:text-slate-300 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {initialMessage && (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-300" />
            <span>{initialMessage}</span>
          </div>
        )}

        {feedback && (
          <div
            className={`mt-4 flex items-start gap-2.5 rounded-2xl border p-3 text-xs ${
              feedback.type === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200'
            }`}
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Mode Démo App Store / Aperçu */}
        <div className="mt-4 rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/15 via-cyan-500/10 to-transparent p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/20 text-indigo-600 dark:text-indigo-200">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Mode Démo interactif (Aperçu / Test)
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Explorez l’ensemble de l’interface Liquid Glass (Proxmox VE, stockage 32 To, incidents, connecteurs &amp; notifications) avec des données simulées complètes.
              </p>
              <button
                type="button"
                onClick={handleEnableDemo}
                className="cider-accent-btn mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {demoActive ? 'Relancer le Mode Démo' : 'Activer le Mode Démo'}
              </button>
            </div>
          </div>
        </div>

        {/* Connexion serveur Tailscale Serve / LAN */}
        <form onSubmit={handleConnectServer} className="mt-5 space-y-3">
          <div>
            <label
              htmlFor="pve-server-url"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
            >
              <Globe className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-400" />
              URL Tailscale Serve ou LAN de votre panel
            </label>
            <input
              id="pve-server-url"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://pve-panel.example.ts.net"
              className="liquid-input"
            />
          </div>

          <div>
            <label
              htmlFor="pve-bearer-token"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300"
            >
              <KeyRound className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
              Jeton Bearer API / Session (optionnel si Tailscale SSO)
            </label>
            <input
              id="pve-bearer-token"
              type="password"
              autoCapitalize="none"
              autoCorrect="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="pve_..."
              className="liquid-input font-mono text-xs"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={testing}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-cyan-500/40 bg-cyan-500/20 px-4 py-2.5 text-xs font-semibold text-cyan-800 transition hover:bg-cyan-500/30 active:scale-[0.98] disabled:opacity-50 dark:text-cyan-100"
            >
              {testing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Vérification...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Tester &amp; Connecter
                </>
              )}
            </button>

            {!nativeApp && (currentServer || demoActive) && (
              <button
                type="button"
                onClick={handleUseLocalOrigin}
                className="liquid-pill inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-xs font-medium text-slate-700 transition hover:text-slate-950 active:scale-[0.98] dark:text-slate-200 dark:hover:text-white"
              >
                Hôte local
              </button>
            )}
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-3 text-[11px] text-slate-500 dark:border-white/10 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>{storageLabel}</span>
          </span>

          {tauriDesktop && (
            <div className="flex flex-wrap items-center gap-2">
              {updateResult?.status === 'available' ? (
                <button
                  type="button"
                  onClick={handleInstallUpdate}
                  disabled={installingUpdate}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 font-medium text-emerald-700 transition hover:bg-emerald-500/25 disabled:opacity-50 dark:text-emerald-300"
                >
                  {installingUpdate ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  Installer v{updateResult.version}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCheckUpdate}
                  disabled={checkingUpdate}
                  className="liquid-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium text-slate-600 transition hover:text-slate-900 disabled:opacity-50 dark:text-slate-300 dark:hover:text-white"
                >
                  {checkingUpdate ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Mises à jour Desktop
                </button>
              )}
              {updateResult?.status === 'up-to-date' && (
                <span className="text-emerald-600 dark:text-emerald-400">À jour</span>
              )}
              {updateResult?.status === 'unavailable' && (
                <span className="text-amber-600 dark:text-amber-300">{updateResult.message}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface AuthLoginModalProps {
  open: boolean;
  serverName?: string;
  pinConfigured?: boolean;
  onAuthenticated: () => void;
  onOpenServerConfig: () => void;
}

export function AuthLoginModal({
  open,
  serverName = 'PVE Command Center',
  pinConfigured = true,
  onAuthenticated,
  onOpenServerConfig,
}: AuthLoginModalProps) {
  const [mode, setMode] = useState<'pin' | 'token'>(pinConfigured ? 'pin' : 'token');
  const [pin, setPin] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const payload = mode === 'pin' ? { pin: pin.trim() } : { api_token: apiToken.trim() };
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await resp.json().catch(() => ({}))) as Partial<AuthLoginResponse> & {
        detail?: string;
      };
      if (!resp.ok || !data.access_token) {
        throw new Error(data.detail || `Authentification refusée (HTTP ${resp.status})`);
      }
      setAuthToken(data.access_token);
      setPin('');
      setApiToken('');
      onAuthenticated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Échec de connexion.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/65 p-0 backdrop-blur-md sm:items-center sm:p-4">
      <div className="ios-sheet safe-bottom-sheet w-full max-w-md rounded-t-[32px] p-5 text-slate-900 dark:text-slate-100 sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex justify-center sm:hidden">
          <div className="ios-grabber" />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-500/35 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Connexion requise (LAN)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {serverName} — authentifiez-vous par PIN ou jeton Bearer
            </p>
          </div>
        </div>

        <div className="liquid-pill mt-4 grid grid-cols-2 gap-1 rounded-full p-1 text-xs">
          <button
            type="button"
            onClick={() => {
              setMode('pin');
              setErrorMsg(null);
            }}
            className={`rounded-full py-1.5 font-semibold transition ${
              mode === 'pin'
                ? 'bg-cyan-500/20 text-cyan-800 dark:bg-white/15 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Code PIN Admin
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('token');
              setErrorMsg(null);
            }}
            className={`rounded-full py-1.5 font-semibold transition ${
              mode === 'token'
                ? 'bg-cyan-500/20 text-cyan-800 dark:bg-white/15 dark:text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Jeton API Bearer
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {mode === 'pin' ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Code PIN Administrateur
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                className="liquid-input font-mono text-base tracking-widest"
              />
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Jeton API (<code className="font-mono">pve_...</code>)
              </label>
              <input
                type="password"
                autoFocus
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="pve_..."
                className="liquid-input font-mono text-xs"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || (mode === 'pin' ? !pin.trim() : !apiToken.trim())}
            className="cider-accent-btn inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connexion…
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Déverrouiller le Dashboard
              </>
            )}
          </button>
        </form>

        <div className="mt-4 border-t border-slate-200/80 pt-3 text-center dark:border-white/10">
          <button
            type="button"
            onClick={onOpenServerConfig}
            className="text-xs font-medium text-cyan-700 hover:underline dark:text-cyan-300"
          >
            Configurer un autre serveur ou passer en Mode Démo
          </button>
        </div>
      </div>
    </div>
  );
}
