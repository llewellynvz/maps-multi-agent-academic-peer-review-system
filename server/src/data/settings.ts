import type { MaraDatabase } from '../db/client';
import { dataDir } from '../paths';
import { clearPassphrase, passphraseIsSet, setPassphrase } from './auth';
import { ApiError } from './errors';
import { readSetting, writeSetting } from './settings-store';

export interface PublicSettings {
  telemetry: boolean;
  presetDefault: string;
  providerProfile: string;
  dataLocation: string;
  passphraseSet: boolean;
}

export function getSettings(db: MaraDatabase): PublicSettings {
  return {
    telemetry: readSetting<boolean>(db, 'telemetry') === true,
    presetDefault: readSetting<string>(db, 'preset_default') ?? 'balanced',
    providerProfile: readSetting<string>(db, 'provider_profile') ?? 'default',
    dataLocation: dataDir(),
    passphraseSet: passphraseIsSet(db),
  };
}

export interface SettingsPatch {
  telemetry?: boolean;
  presetDefault?: string;
  providerProfile?: string;
  passphrase?: string | null;
}

export function putSettings(db: MaraDatabase, patch: SettingsPatch): PublicSettings {
  if (patch.telemetry !== undefined) {
    if (typeof patch.telemetry !== 'boolean') {
      throw new ApiError('unprocessable', 'telemetry must be a boolean.', { field: 'telemetry' });
    }
    writeSetting(db, 'telemetry', patch.telemetry);
  }
  if (patch.presetDefault !== undefined) {
    if (!['fast', 'balanced', 'thorough'].includes(patch.presetDefault)) {
      throw new ApiError('unprocessable', 'presetDefault must be fast, balanced, or thorough.', { field: 'presetDefault' });
    }
    writeSetting(db, 'preset_default', patch.presetDefault);
  }
  if (patch.providerProfile !== undefined) {
    writeSetting(db, 'provider_profile', patch.providerProfile);
  }
  if (patch.passphrase !== undefined) {
    if (patch.passphrase === null || patch.passphrase === '') {
      clearPassphrase(db);
    } else {
      setPassphrase(db, patch.passphrase);
    }
  }
  return getSettings(db);
}
