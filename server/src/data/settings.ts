import type { MaraDatabase } from '../db/client';
import { dataDir } from '../paths';
import { clearPassphrase, passphraseIsSet, setPassphrase } from './auth';
import { ApiError } from './errors';
import { COST_CEILING_SETTING_KEY, positiveUsd, readSetting, writeSetting } from './settings-store';

export interface PublicSettings {
  telemetry: boolean;
  langfuseContent: boolean;
  presetDefault: string;
  providerProfile: string;
  costCeilingUsd: number | null;
  dataLocation: string;
  passphraseSet: boolean;
}

export function getSettings(db: MaraDatabase): PublicSettings {
  return {
    telemetry: readSetting<boolean>(db, 'telemetry') === true,
    langfuseContent: readSetting<boolean>(db, 'langfuse_content') === true,
    presetDefault: readSetting<string>(db, 'preset_default') ?? 'balanced',
    providerProfile: readSetting<string>(db, 'provider_profile') ?? 'default',
    costCeilingUsd: positiveUsd(readSetting<unknown>(db, COST_CEILING_SETTING_KEY)) ?? null,
    dataLocation: dataDir(),
    passphraseSet: passphraseIsSet(db),
  };
}

export interface SettingsPatch {
  telemetry?: boolean;
  langfuseContent?: boolean;
  presetDefault?: string;
  providerProfile?: string;
  costCeilingUsd?: number | null;
  passphrase?: string | null;
}

export function putSettings(db: MaraDatabase, patch: SettingsPatch): PublicSettings {
  if (patch.telemetry !== undefined) {
    if (typeof patch.telemetry !== 'boolean') {
      throw new ApiError('unprocessable', 'telemetry must be a boolean.', { field: 'telemetry' });
    }
    writeSetting(db, 'telemetry', patch.telemetry);
  }
  if (patch.langfuseContent !== undefined) {
    if (typeof patch.langfuseContent !== 'boolean') {
      throw new ApiError('unprocessable', 'langfuseContent must be a boolean.', { field: 'langfuseContent' });
    }
    writeSetting(db, 'langfuse_content', patch.langfuseContent);
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
  if (patch.costCeilingUsd !== undefined) {
    if (patch.costCeilingUsd === null) {
      writeSetting(db, COST_CEILING_SETTING_KEY, null);
    } else if (positiveUsd(patch.costCeilingUsd) === undefined) {
      throw new ApiError('unprocessable', 'costCeilingUsd must be a positive number of US dollars, or null to clear.', {
        field: 'costCeilingUsd',
      });
    } else {
      writeSetting(db, COST_CEILING_SETTING_KEY, patch.costCeilingUsd);
    }
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
