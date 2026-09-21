import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const ATRIUM_CORE_ROOT = resolve(__dirname, '..');
export const ATRIUM_DESKTOP_PROFILE_DIR = resolve(ATRIUM_CORE_ROOT, 'profiles', 'atrium-desktop');
export const ATRIUM_DESKTOP_PATCH_FILE = resolve(ATRIUM_DESKTOP_PROFILE_DIR, 'cordis.patch.yml');

export const ATRIUM_PROFILE_NAME = 'atrium-desktop';
export const ATRIUM_DEFAULT_PORT = 19387;

export interface AtriumHarnessConfig {
  port: number;
  host: string;
  profile: string;
  profileDir: string;
  patchFile: string;
}

export function getAtriumHarnessConfig(port: number = ATRIUM_DEFAULT_PORT): AtriumHarnessConfig {
  return {
    port,
    host: '127.0.0.1',
    profile: ATRIUM_PROFILE_NAME,
    profileDir: ATRIUM_DESKTOP_PROFILE_DIR,
    patchFile: ATRIUM_DESKTOP_PATCH_FILE,
  };
}
