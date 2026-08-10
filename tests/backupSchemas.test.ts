/**
 * `shared/schemas/backup.ts` Zod schema 边界测试（T5-2）
 *
 * 覆盖：
 *   - `MmwsBackupFileSchema`           formatVersion === 1 / 额外字段拒绝
 *   - `BackupMetaSchema`               appVersion / schemaVersion 范围
 *   - `BackupDataSchema`               各业务表行类型严格
 *   - `app_meta` key 白名单
 *   - `BackupInfoSchema`               字段范围（filename / path / size / createdAt）
 *   - `RestoreBackupInputSchema`       confirm 字面量
 *   - `ResetDataInputSchema`           confirm 字面量
 *   - `BackupNowResponseSchema` / `ExportDataResponseSchema` / etc.
 *   - 50MB 上限（**schema 层不限制**，在 service 层做）
 */

import { describe, expect, it } from 'vitest';

import {
  BackupDataSchema,
  BackupInfoSchema,
  BackupMetaSchema,
  BackupNowInputSchema,
  BackupNowResponseSchema,
  DeleteBackupInputSchema,
  DeleteBackupResponseSchema,
  ExportDataInputSchema,
  ExportDataResponseSchema,
  GetPathsResponseSchema,
  ImportDataInputSchema,
  ListBackupsResponseSchema,
  MmwsBackupFileSchema,
  ResetDataInputSchema,
  ResetDataResponseSchema,
  RestoreBackupInputSchema,
  RestoreBackupResponseSchema,
} from '../shared/schemas/backup';
import {
  DialogFilterSchema,
  DialogPropertySchema,
  ShowOpenDialogInputSchema,
  ShowOpenDialogResponseSchema,
  ShowSaveDialogInputSchema,
  ShowSaveDialogResponseSchema,
} from '../shared/schemas/dialog';
import {
  GetSettingsResponseSchema,
  MaybeAutoBackupResponseSchema,
  SetSettingsInputSchema,
  SettingsSchema,
} from '../shared/schemas/appSettings';

// ============================================================
//  基础 helper：构造一个合法的 backup file
// ============================================================

function makeValidBackupFile(overrides: Record<string, unknown> = {}): unknown {
  return {
    meta: {
      formatVersion: 1,
      exportedAt: 1700000000000,
      appVersion: '0.1.0',
      schemaVersion: 6,
    },
    data: {
      projects: [],
      inbox_items: [],
      tasks: [],
      notes: [],
      reviews: [],
      ai_configs: [],
      app_meta: [],
    },
    ...overrides,
  };
}

// ============================================================
//  MmwsBackupFileSchema
// ============================================================

describe('MmwsBackupFileSchema', () => {
  it('accepts a valid backup file', () => {
    const r = MmwsBackupFileSchema.safeParse(makeValidBackupFile());
    expect(r.success).toBe(true);
  });

  it('rejects formatVersion !== 1', () => {
    const r = MmwsBackupFileSchema.safeParse(
      makeValidBackupFile({
        meta: { formatVersion: 2, exportedAt: 1, appVersion: 'x', schemaVersion: 1 },
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rejects negative exportedAt', () => {
    const r = MmwsBackupFileSchema.safeParse(
      makeValidBackupFile({
        meta: { formatVersion: 1, exportedAt: -1, appVersion: 'x', schemaVersion: 1 },
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rejects schemaVersion out of range (> 1000)', () => {
    const r = MmwsBackupFileSchema.safeParse(
      makeValidBackupFile({
        meta: { formatVersion: 1, exportedAt: 1, appVersion: 'x', schemaVersion: 2000 },
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rejects extra top-level fields', () => {
    const r = MmwsBackupFileSchema.safeParse(makeValidBackupFile({ extra: 'no' }));
    expect(r.success).toBe(false);
  });

  it('rejects extra data-level fields', () => {
    const r = MmwsBackupFileSchema.safeParse(
      makeValidBackupFile({
        data: {
          projects: [],
          inbox_items: [],
          tasks: [],
          notes: [],
          reviews: [],
          ai_configs: [],
          app_meta: [],
          unknown: 'no',
        },
      }),
    );
    expect(r.success).toBe(false);
  });

  it('rejects extra meta-level fields', () => {
    const r = MmwsBackupFileSchema.safeParse(
      makeValidBackupFile({
        meta: {
          formatVersion: 1,
          exportedAt: 1,
          appVersion: 'x',
          schemaVersion: 1,
          userDataPath: 'C:\\Users\\test',
        },
      }),
    );
    expect(r.success).toBe(false);
  });
});

// ============================================================
//  app_meta 严格白名单
// ============================================================

describe('app_meta key whitelist (in BackupDataSchema)', () => {
  it('accepts allowed keys', () => {
    const sample = makeValidBackupFile();
    const obj = sample as { data: { app_meta: unknown[] } };
    obj.data.app_meta = [
      { key: 'schemaVersion', value: '6', createdAt: 1, updatedAt: 1 },
      { key: 'setupCompletedAt', value: '1', createdAt: 1, updatedAt: 1 },
      { key: 'auto_backup_interval_min', value: '30', createdAt: 1, updatedAt: 1 },
      { key: 'last_auto_backup_at', value: '1700000000000', createdAt: 1, updatedAt: 1 },
      { key: 'last_restore_at', value: '1700000000000', createdAt: 1, updatedAt: 1 },
    ];
    const r = MmwsBackupFileSchema.safeParse(sample);
    expect(r.success).toBe(true);
  });

  it('rejects unknown app_meta key', () => {
    const sample = makeValidBackupFile();
    const obj = sample as { data: { app_meta: unknown[] } };
    obj.data.app_meta = [{ key: 'somethingSecret', value: 'x', createdAt: 1, updatedAt: 1 }];
    const r = MmwsBackupFileSchema.safeParse(sample);
    expect(r.success).toBe(false);
  });

  it('rejects extra fields in app_meta row', () => {
    const sample = makeValidBackupFile();
    const obj = sample as { data: { app_meta: unknown[] } };
    obj.data.app_meta = [
      { key: 'schemaVersion', value: '6', createdAt: 1, updatedAt: 1, apiKey: 'x' },
    ];
    const r = MmwsBackupFileSchema.safeParse(sample);
    expect(r.success).toBe(false);
  });
});

// ============================================================
//  业务表 row schemas（每个字段类型检查）
// ============================================================

describe('BackupDataSchema business row types', () => {
  it('rejects project with wrong archived type', () => {
    const sample = makeValidBackupFile();
    const obj = sample as { data: { projects: unknown[] } };
    obj.data.projects = [
      {
        id: 'P1',
        name: 'p',
        description: null,
        color: null,
        archived: 'not-0-or-1', // 错
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    expect(MmwsBackupFileSchema.safeParse(sample).success).toBe(false);
  });

  it('rejects note with extra field', () => {
    const sample = makeValidBackupFile();
    const obj = sample as { data: { notes: unknown[] } };
    obj.data.notes = [
      {
        id: 'N1',
        title: 'n',
        content: 'b',
        tags: [],
        linkedTaskIds: [],
        projectId: null,
        source: 'manual',
        archived: 0,
        createdAt: 1,
        updatedAt: 1,
        apiKey: 'leak',
      },
    ];
    expect(MmwsBackupFileSchema.safeParse(sample).success).toBe(false);
  });

  it('rejects note with wrong source enum', () => {
    const sample = makeValidBackupFile();
    const obj = sample as { data: { notes: unknown[] } };
    obj.data.notes = [
      {
        id: 'N1',
        title: 'n',
        content: 'b',
        tags: [],
        linkedTaskIds: [],
        projectId: null,
        source: 'unknown',
        archived: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    expect(MmwsBackupFileSchema.safeParse(sample).success).toBe(false);
  });
});

// ============================================================
//  BackupInfoSchema
// ============================================================

describe('BackupInfoSchema', () => {
  it('accepts a valid BackupInfo', () => {
    expect(
      BackupInfoSchema.safeParse({
        filename: 'auto-20260809-100000.mmws.json',
        path: 'C:\\Users\\test\\backups\\auto-20260809-100000.mmws.json',
        size: 1024,
        createdAt: 1700000000000,
      }).success,
    ).toBe(true);
  });

  it('rejects empty filename', () => {
    expect(
      BackupInfoSchema.safeParse({
        filename: '',
        path: '/x',
        size: 1,
        createdAt: 1,
      }).success,
    ).toBe(false);
  });

  it('rejects negative size', () => {
    expect(
      BackupInfoSchema.safeParse({
        filename: 'x',
        path: '/x',
        size: -1,
        createdAt: 1,
      }).success,
    ).toBe(false);
  });

  it('rejects non-positive createdAt', () => {
    expect(
      BackupInfoSchema.safeParse({
        filename: 'x',
        path: '/x',
        size: 0,
        createdAt: 0,
      }).success,
    ).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(
      BackupInfoSchema.safeParse({
        filename: 'x',
        path: '/x',
        size: 0,
        createdAt: 1,
        extra: 'no',
      }).success,
    ).toBe(false);
  });
});

// ============================================================
//  RestoreBackupInputSchema
// ============================================================

describe('RestoreBackupInputSchema', () => {
  it('accepts uppercase RESTORE', () => {
    expect(
      RestoreBackupInputSchema.safeParse({ path: '/x', confirm: 'RESTORE' }).success,
    ).toBe(true);
  });

  it('rejects lowercase restore', () => {
    expect(
      RestoreBackupInputSchema.safeParse({ path: '/x', confirm: 'restore' }).success,
    ).toBe(false);
  });

  it('rejects other strings', () => {
    expect(
      RestoreBackupInputSchema.safeParse({ path: '/x', confirm: 'yes' }).success,
    ).toBe(false);
  });

  it('rejects extra fields', () => {
    expect(
      RestoreBackupInputSchema.safeParse({ path: '/x', confirm: 'RESTORE', extra: 1 }).success,
    ).toBe(false);
  });
});

// ============================================================
//  ResetDataInputSchema
// ============================================================

describe('ResetDataInputSchema', () => {
  it('accepts uppercase RESET', () => {
    expect(ResetDataInputSchema.safeParse({ confirm: 'RESET' }).success).toBe(true);
  });

  it('rejects lowercase reset', () => {
    expect(ResetDataInputSchema.safeParse({ confirm: 'reset' }).success).toBe(false);
  });
});

// ============================================================
//  BackupNowInputSchema / Response
// ============================================================

describe('BackupNowInputSchema', () => {
  it('accepts empty', () => {
    expect(BackupNowInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts destPath', () => {
    expect(BackupNowInputSchema.safeParse({ destPath: '/x' }).success).toBe(true);
  });

  it('rejects extra fields', () => {
    expect(BackupNowInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('BackupNowResponseSchema', () => {
  it('accepts valid', () => {
    expect(
      BackupNowResponseSchema.safeParse({
        path: '/x',
        size: 100,
        createdAt: 1700000000000,
      }).success,
    ).toBe(true);
  });

  it('rejects negative size', () => {
    expect(
      BackupNowResponseSchema.safeParse({
        path: '/x',
        size: -1,
        createdAt: 1700000000000,
      }).success,
    ).toBe(false);
  });
});

// ============================================================
//  ExportDataInputSchema
// ============================================================

describe('ExportDataInputSchema', () => {
  it('requires destPath', () => {
    expect(ExportDataInputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts destPath', () => {
    expect(ExportDataInputSchema.safeParse({ destPath: '/x' }).success).toBe(true);
  });
});

describe('ExportDataResponseSchema', () => {
  it('accepts valid', () => {
    expect(
      ExportDataResponseSchema.safeParse({ path: '/x', size: 0, createdAt: 1 }).success,
    ).toBe(true);
  });
});

// ============================================================
//  ImportDataInputSchema (同 Restore)
// ============================================================

describe('ImportDataInputSchema', () => {
  it('requires RESTORE confirm', () => {
    expect(ImportDataInputSchema.safeParse({ path: '/x', confirm: 'no' }).success).toBe(false);
  });
});

// ============================================================
//  DeleteBackupInputSchema
// ============================================================

describe('DeleteBackupInputSchema', () => {
  it('accepts path', () => {
    expect(DeleteBackupInputSchema.safeParse({ path: '/x' }).success).toBe(true);
  });

  it('rejects extra fields', () => {
    expect(DeleteBackupInputSchema.safeParse({ path: '/x', extra: 1 }).success).toBe(false);
  });
});

describe('DeleteBackupResponseSchema', () => {
  it('accepts deleted: true literal', () => {
    expect(DeleteBackupResponseSchema.safeParse({ deleted: true }).success).toBe(true);
  });

  it('rejects deleted: false', () => {
    expect(DeleteBackupResponseSchema.safeParse({ deleted: false }).success).toBe(false);
  });
});

// ============================================================
//  RestoreBackupResponseSchema / ResetDataResponseSchema
// ============================================================

describe('RestoreBackupResponseSchema', () => {
  it('accepts ok: true, restartRequired: true', () => {
    expect(
      RestoreBackupResponseSchema.safeParse({ ok: true, restartRequired: true }).success,
    ).toBe(true);
  });

  it('rejects restartRequired: false', () => {
    expect(
      RestoreBackupResponseSchema.safeParse({ ok: true, restartRequired: false }).success,
    ).toBe(false);
  });
});

describe('ResetDataResponseSchema', () => {
  it('accepts ok: true, restartRequired: true', () => {
    expect(
      ResetDataResponseSchema.safeParse({ ok: true, restartRequired: true }).success,
    ).toBe(true);
  });
});

// ============================================================
//  GetPathsResponseSchema
// ============================================================

describe('GetPathsResponseSchema', () => {
  it('accepts valid paths', () => {
    expect(
      GetPathsResponseSchema.safeParse({
        userData: 'C:\\Users\\test',
        db: 'C:\\Users\\test\\workstation.db',
        backups: 'C:\\Users\\test\\backups',
      }).success,
    ).toBe(true);
  });
});

// ============================================================
//  ListBackupsResponseSchema
// ============================================================

describe('ListBackupsResponseSchema', () => {
  it('accepts empty list', () => {
    expect(ListBackupsResponseSchema.safeParse([]).success).toBe(true);
  });

  it('accepts a list of BackupInfo', () => {
    expect(
      ListBackupsResponseSchema.safeParse([
        {
          filename: 'a.mmws.json',
          path: '/x/a.mmws.json',
          size: 100,
          createdAt: 1,
        },
      ]).success,
    ).toBe(true);
  });
});

// ============================================================
//  Dialog schemas (cross-import test for completeness)
// ============================================================

describe('DialogFilterSchema', () => {
  it('accepts valid filter', () => {
    expect(
      DialogFilterSchema.safeParse({ name: 'Backup', extensions: ['mmws.json'] }).success,
    ).toBe(true);
  });

  it('rejects empty extensions', () => {
    expect(
      DialogFilterSchema.safeParse({ name: 'B', extensions: [] }).success,
    ).toBe(false);
  });
});

describe('DialogPropertySchema', () => {
  it('accepts known values', () => {
    expect(DialogPropertySchema.safeParse('openFile').success).toBe(true);
    expect(DialogPropertySchema.safeParse('openDirectory').success).toBe(true);
    expect(DialogPropertySchema.safeParse('multiSelections').success).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(DialogPropertySchema.safeParse('unknown').success).toBe(false);
  });
});

describe('ShowSaveDialogInputSchema', () => {
  it('accepts empty', () => {
    expect(ShowSaveDialogInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts full', () => {
    expect(
      ShowSaveDialogInputSchema.safeParse({
        title: 't',
        defaultPath: '/x',
        filters: [{ name: 'B', extensions: ['mmws.json'] }],
      }).success,
    ).toBe(true);
  });

  it('rejects extra fields', () => {
    expect(ShowSaveDialogInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('ShowOpenDialogInputSchema', () => {
  it('accepts empty', () => {
    expect(ShowOpenDialogInputSchema.safeParse({}).success).toBe(true);
  });

  it('rejects extra fields', () => {
    expect(ShowOpenDialogInputSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('ShowSaveDialogResponseSchema', () => {
  it('accepts null path (cancel)', () => {
    expect(ShowSaveDialogResponseSchema.safeParse({ path: null }).success).toBe(true);
  });

  it('accepts string path', () => {
    expect(ShowSaveDialogResponseSchema.safeParse({ path: '/x' }).success).toBe(true);
  });
});

describe('ShowOpenDialogResponseSchema', () => {
  it('accepts cancel state', () => {
    expect(
      ShowOpenDialogResponseSchema.safeParse({ path: null, paths: [] }).success,
    ).toBe(true);
  });

  it('accepts single selection', () => {
    expect(
      ShowOpenDialogResponseSchema.safeParse({ path: '/x', paths: ['/x'] }).success,
    ).toBe(true);
  });

  it('accepts multi selection', () => {
    expect(
      ShowOpenDialogResponseSchema.safeParse({ path: '/x', paths: ['/x', '/y'] }).success,
    ).toBe(true);
  });
});

// ============================================================
//  AppSettings schemas
// ============================================================

describe('SettingsSchema', () => {
  it('accepts default settings', () => {
    expect(
      SettingsSchema.safeParse({
        autoBackupIntervalMin: 30,
        lastAutoBackupAt: null,
        lastRestoreAt: null,
      }).success,
    ).toBe(true);
  });

  it('rejects invalid interval (not 0/30/60/120)', () => {
    expect(
      SettingsSchema.safeParse({
        autoBackupIntervalMin: 15,
        lastAutoBackupAt: null,
        lastRestoreAt: null,
      }).success,
    ).toBe(false);
  });

  it('accepts 0 interval (off)', () => {
    expect(
      SettingsSchema.safeParse({
        autoBackupIntervalMin: 0,
        lastAutoBackupAt: null,
        lastRestoreAt: null,
      }).success,
    ).toBe(true);
  });

  it('rejects extra fields', () => {
    expect(
      SettingsSchema.safeParse({
        autoBackupIntervalMin: 30,
        lastAutoBackupAt: null,
        lastRestoreAt: null,
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

describe('SetSettingsInputSchema', () => {
  it('accepts empty patch', () => {
    expect(SetSettingsInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts one field', () => {
    expect(SetSettingsInputSchema.safeParse({ autoBackupIntervalMin: 60 }).success).toBe(true);
  });
});

describe('GetSettingsResponseSchema (alias)', () => {
  it('is same as SettingsSchema', () => {
    expect(GetSettingsResponseSchema.safeParse({
      autoBackupIntervalMin: 30,
      lastAutoBackupAt: 1,
      lastRestoreAt: null,
    }).success).toBe(true);
  });
});

describe('MaybeAutoBackupResponseSchema', () => {
  it('accepts triggered: false', () => {
    expect(MaybeAutoBackupResponseSchema.safeParse({ triggered: false }).success).toBe(true);
  });

  it('accepts triggered: true with path', () => {
    expect(
      MaybeAutoBackupResponseSchema.safeParse({ triggered: true, path: '/x' }).success,
    ).toBe(true);
  });

  it('rejects extra fields', () => {
    expect(
      MaybeAutoBackupResponseSchema.safeParse({ triggered: true, path: '/x', extra: 1 }).success,
    ).toBe(false);
  });
});

void BackupMetaSchema;
void BackupDataSchema;
