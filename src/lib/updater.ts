import { isTauriDesktop } from './secureStorage';

export { isTauriDesktop };

export type DesktopUpdateCheckResult =
  | {
      status: 'available';
      version: string;
      notes?: string;
      install: () => Promise<void>;
    }
  | { status: 'up-to-date' }
  | { status: 'unavailable'; message: string };

/**
 * Check GitHub Releases (`latest.json`) via `tauri-plugin-updater` for a signed Desktop update.
 * Safe to invoke even when releases are not yet signed or when offline.
 */
export async function checkAndInstallDesktopUpdate(
  autoInstall = false
): Promise<DesktopUpdateCheckResult> {
  if (!isTauriDesktop()) {
    return {
      status: 'unavailable',
      message: 'Mises à jour automatiques réservées à l’application Desktop.',
    };
  }

  try {
    const [{ check }, { relaunch }] = await Promise.all([
      import('@tauri-apps/plugin-updater'),
      import('@tauri-apps/plugin-process'),
    ]);
    const update = await check();
    if (!update) {
      return { status: 'up-to-date' };
    }

    const install = async () => {
      await update.downloadAndInstall();
      await relaunch();
    };

    if (autoInstall) {
      await install();
    }

    return {
      status: 'available',
      version: update.version,
      notes: update.body ?? undefined,
      install,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const notPublished =
      raw.includes('404') ||
      raw.toLowerCase().includes('valid release json') ||
      raw.toLowerCase().includes('signature');
    return {
      status: 'unavailable',
      message: notPublished
        ? 'Aucune mise à jour signée disponible (version actuelle à jour).'
        : `Vérification impossible : ${raw}`,
    };
  }
}
