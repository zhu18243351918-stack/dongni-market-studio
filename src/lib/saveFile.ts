import { isDesktopApp } from '../auth/supabase';

export type SaveLocationMode = 'ask' | 'downloads';

export interface SaveDestination {
  kind: 'download' | 'file-handle' | 'tauri';
  handle?: FileSystemFileHandle;
  suggestedName: string;
}

interface SavePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
  excludeAcceptAllOption?: boolean;
}

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options?: SavePickerOptions) => Promise<FileSystemFileHandle>;
};

const SAVE_LOCATION_KEY = 'dongni-market-save-location';

export function getSaveLocationMode(): SaveLocationMode {
  try {
    return window.localStorage.getItem(SAVE_LOCATION_KEY) === 'downloads' ? 'downloads' : 'ask';
  } catch {
    return 'ask';
  }
}

export function setSaveLocationMode(mode: SaveLocationMode) {
  try { window.localStorage.setItem(SAVE_LOCATION_KEY, mode); }
  catch { /* Storage can be disabled in private mode. */ }
}

export function supportsSystemSavePicker() {
  return isDesktopApp || typeof (window as SavePickerWindow).showSaveFilePicker === 'function';
}

export async function chooseSaveDestination(
  suggestedName: string,
  mimeType: string,
  extensions: string[],
): Promise<SaveDestination | null> {
  const mode = getSaveLocationMode();
  if (mode === 'downloads') return { kind: 'download', suggestedName };
  if (isDesktopApp) return { kind: 'tauri', suggestedName };
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) return { kind: 'download', suggestedName };
  try {
    const handle = await picker({
      suggestedName,
      excludeAcceptAllOption: false,
      types: [{ description: '东尼菜市场导出文件', accept: { [mimeType]: extensions } }],
    });
    return { kind: 'file-handle', handle, suggestedName };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function saveBlobToComputer(blob: Blob, destination: SaveDestination) {
  if (destination.kind === 'file-handle' && destination.handle) {
    const writable = await destination.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { saved: true, method: 'file-picker' as const, path: destination.handle.name };
  }
  if (destination.kind === 'tauri') {
    const { invoke } = await import('@tauri-apps/api/core');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const path = await invoke<string | null>('save_export_file', {
      suggestedName: destination.suggestedName,
      bytes: Array.from(bytes),
    });
    return { saved: Boolean(path), method: 'tauri' as const, path: path || undefined };
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = destination.suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1800);
  return { saved: true, method: 'download' as const, path: destination.suggestedName };
}
