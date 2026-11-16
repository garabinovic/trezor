import {
  describeAttachment,
  formatDate,
  formatDue,
  formatFullDate,
  formatLongToday,
  itemSummary,
} from '../../src/data/format';
import type { Note } from '../../src/data/types';
import {
  LANGUAGES,
  languageNames,
  nativeTexts,
  slavic,
  stringsFor,
  withFallback,
} from '../../src/i18n';
import { en } from '../../src/i18n/en';
import { es } from '../../src/i18n/es';
import { ru } from '../../src/i18n/ru';
import { srCyrl } from '../../src/i18n/sr-Cyrl';
import { srLatn } from '../../src/i18n/sr-Latn';
import { setCurrentLanguage } from '../../src/i18n/strings';
import { backupErrorMessage } from '../../src/screens/backup/messages';

/** Every key path with the kind of its value ("string", "function", "array:12"). */
function shape(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return [`${path}:array:${value.length}`];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) =>
      shape(v, path ? `${path}.${k}` : k),
    );
  }
  return [`${path}:${typeof value}`];
}

/** Every plain string in a dictionary (function results aren't included). */
function texts(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(texts);
  }
  return [];
}

const dictionaries = { en, 'sr-Latn': srLatn, 'sr-Cyrl': srCyrl, ru, es };

afterEach(() => setCurrentLanguage('en'));

describe('dictionaries', () => {
  test('exactly five languages, named in their own language', () => {
    expect(LANGUAGES).toEqual(['en', 'sr-Latn', 'sr-Cyrl', 'ru', 'es']);
    expect(languageNames).toEqual({
      en: 'English',
      'sr-Latn': 'Srpski (latinica)',
      'sr-Cyrl': 'Српски (ћирилица)',
      ru: 'Русский',
      es: 'Español',
    });
  });

  test('every language has exactly the English keys, with the same kinds of values', () => {
    for (const [code, dictionary] of Object.entries(dictionaries)) {
      expect([code, shape(dictionary)]).toEqual([code, shape(en)]);
    }
  });

  test('no translation is empty or a raw key', () => {
    for (const [code, dictionary] of Object.entries(dictionaries)) {
      for (const text of texts(dictionary)) {
        // Russian groups digits with a no-break space; anything else must show.
        const visible = text === '\u00a0' || text.trim().length > 0;
        expect([code, visible]).toEqual([code, true]);
        expect([code, /^[a-z]+(\.[a-zA-Z]+)+$/.test(text)]).toEqual([
          code,
          false,
        ]);
      }
    }
  });

  test('a missing or malformed entry falls back to English', () => {
    const partial = withFallback({
      common: { back: 'Nazad', cancel: 42 as unknown as string },
      dates: { monthsShort: ['only one'] },
    });
    expect(partial.common.back).toBe('Nazad');
    expect(partial.common.cancel).toBe('Cancel');
    expect(partial.common.close).toBe('Close');
    expect(partial.dates.monthsShort).toEqual(en.dates.monthsShort);
    expect(partial.settings.title).toBe('Settings');
    expect(partial.counts.items(2)).toBe('2 items');
  });
});

describe('Serbian Latin and Cyrillic', () => {
  test('are distinct, and each is in its own script', () => {
    expect(stringsFor('sr-Latn').settings.title).toBe('Podešavanja');
    expect(stringsFor('sr-Cyrl').settings.title).toBe('Подешавања');
    expect(stringsFor('sr-Latn').lock.locked).toBe('Štek je zaključan');
    expect(stringsFor('sr-Cyrl').lock.locked).toBe('Штек је закључан');
    // Digraphs are single Cyrillic letters: lj → љ, nj → њ.
    expect(stringsFor('sr-Cyrl').backup.password).toBe(
      'Лозинка резервне копије',
    );
    // Only codes, formats and brand names stay in Latin script.
    const allowed =
      /\b(JPEG|PNG|WebP|HEIC|HEIF|PDF|MB|KB|RESTORE_UNAVAILABLE|Greenleaf|Rewards)\b/g;
    for (const text of texts(srCyrl)) {
      expect([text, /[A-Za-z]/.test(text.replace(allowed, ''))]).toEqual([
        text,
        false,
      ]);
    }
  });

  test('the Cyrillic file is up to date with the Latin one', () => {
    // Regenerate with tools/i18n/transliterate-sr.py after editing sr-Latn.ts.
    expect(srCyrl.common.settings).toBe('Подешавања');
    expect(shape(srCyrl)).toEqual(shape(srLatn));
    expect(texts(srCyrl)).toHaveLength(texts(srLatn).length);
  });
});

describe('the app name, in the language chosen in the app', () => {
  test.each([
    ['en', 'Stash', 'Stash is locked', 'About Stash', 'Unlock Stash'],
    [
      'es',
      'Stash',
      'Stash está bloqueado',
      'Acerca de Stash',
      'Desbloquear Stash',
    ],
    ['sr-Latn', 'Štek', 'Štek je zaključan', 'O Šteku', 'Otključajte Štek'],
    ['sr-Cyrl', 'Штек', 'Штек је закључан', 'О Штеку', 'Откључајте Штек'],
    [
      'ru',
      'Тайник',
      'Тайник заблокирован',
      'О Тайнике',
      'Разблокировать Тайник',
    ],
  ] as const)('%s', (language, name, locked, about, unlock) => {
    const t = stringsFor(language);
    expect(t.home.title).toBe(name);
    expect(t.lock.locked).toBe(locked);
    expect(t.settings.aboutTitle).toBe(about);
    expect(nativeTexts(language).unlockTitle).toBe(unlock);
    expect(nativeTexts(language).reminderTitle).toBe(name);
    // New backups are named after the app; the format stays .tzbk.
    expect(t.backup.fileName('2026-11-16')).toContain(
      language === 'ru' ? 'Тайника' : name,
    );
    expect(t.backup.fileName('2026-11-16')).toMatch(/ 2026-11-16\.tzbk$/);
  });

  test('the old name is gone from every dictionary, text and functions alike', () => {
    for (const [code, dictionary] of Object.entries(dictionaries)) {
      const all = JSON.stringify(dictionary, (_, v) =>
        typeof v === 'function' ? String(v) : v,
      );
      expect([code, /Trezor|Трезор/.test(all)]).toEqual([code, false]);
    }
  });
});

describe('plural forms', () => {
  test('Russian and Serbian: one, few, many', () => {
    const form = (n: number) => slavic(n, 'one', 'few', 'many');
    expect([0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(form)).toEqual(
      [
        'many',
        'one',
        'few',
        'few',
        'many',
        'many',
        'many',
        'many',
        'one',
        'few',
        'many',
        'one',
        'many',
      ],
    );
    expect(stringsFor('ru').counts.items(1)).toBe('1 запись');
    expect(stringsFor('ru').counts.items(3)).toBe('3 записи');
    expect(stringsFor('ru').counts.items(11)).toBe('11 записей');
    expect(stringsFor('sr-Latn').counts.items(21)).toBe('21 stavka');
    expect(stringsFor('sr-Latn').counts.items(5)).toBe('5 stavki');
    expect(stringsFor('es').counts.items(1)).toBe('1 elemento');
    expect(stringsFor('es').counts.items(2)).toBe('2 elementos');
  });
});

describe('dates in the selected language', () => {
  const thursday = new Date(2026, 9, 29, 9, 5); // Thu 29 Oct 2026, 09:05
  const now = new Date(2026, 9, 28, 12, 0);

  test.each([
    ['en', '29 Oct', '29 Oct 2026', 'Thursday, 29 October', 'Tomorrow, 09:05'],
    [
      'sr-Latn',
      '29. okt',
      '29. okt 2026.',
      'Četvrtak, 29. oktobar',
      'Sutra, 09:05',
    ],
    [
      'sr-Cyrl',
      '29. окт',
      '29. окт 2026.',
      'Четвртак, 29. октобар',
      'Сутра, 09:05',
    ],
    ['ru', '29 окт', '29 окт 2026', 'Четверг, 29 октября', 'Завтра, 09:05'],
    ['es', '29 oct', '29 oct 2026', 'Jueves, 29 de octubre', 'Mañana, 09:05'],
  ] as const)('%s', (language, short, full, long, due) => {
    setCurrentLanguage(language);
    expect(formatDate(thursday, now)).toBe(short);
    expect(formatFullDate(thursday)).toBe(full);
    expect(formatLongToday(thursday)).toBe(long);
    expect(formatDue(thursday.toISOString(), now)).toBe(due);
  });
});

describe('user content is passed through, never translated', () => {
  const note: Note = {
    id: 'n1',
    type: 'note',
    title: 'Ljubav i njiva',
    body: 'Kupiti mleko\nDžem',
    pinned: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  test.each(LANGUAGES)('%s', language => {
    setCurrentLanguage(language);
    expect(itemSummary(note)).toBe('Kupiti mleko · Džem');
    // The file name is kept; only the type label is translated.
    const message = backupErrorMessage(
      {
        code: 'BACKUP_ATTACHMENT_UNREADABLE',
        // As native sends it: the details as JSON in the message.
        message: JSON.stringify({
          itemId: 'n1',
          attachmentId: 'a1',
          reason: 'MISSING',
        }),
      },
      [
        {
          ...note,
          type: 'document',
          kind: 'document',
          merchant: '',
          date: null,
          expiresOn: null,
          amount: null,
          currency: 'EUR',
          notes: '',
          attachments: [
            {
              id: 'a1',
              fileName: 'njiva-ljeto.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 2048,
              sha256: 'a'.repeat(64),
              formatVersion: 1,
              createdAt: '2026-10-01T00:00:00.000Z',
            },
          ],
        } as never,
      ],
    );
    expect(message).toContain('njiva-ljeto.pdf');
    expect(message).toContain('Ljubav i njiva');
    expect(
      describeAttachment({ mimeType: 'application/pdf', sizeBytes: 2048 }),
    ).toBe(`PDF · 2 ${stringsFor(language).numbers.kb}`);
  });
});

describe('native strings (notifications, system prompt)', () => {
  // Node APIs as in the other tests (no Node types in the app's tsconfig).
  const kotlin: string = require('fs').readFileSync(
    'android/app/src/main/java/com/trezor/app/locale/NativeText.kt',
    'utf8',
  );
  const entries = [...kotlin.matchAll(/[A-Z_]+\("(\w+)", "([^"]*)"\)/g)].map(
    m => [m[1], m[2]],
  );

  test('the keys JavaScript hands over are exactly the ones Kotlin reads', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const language of LANGUAGES) {
      expect(Object.keys(nativeTexts(language)).sort()).toEqual(
        entries.map(([key]) => key).sort(),
      );
    }
  });

  test('the Kotlin defaults are the English strings', () => {
    expect(Object.fromEntries(entries)).toEqual(en.native);
  });

  test('each language has its own notification text', () => {
    expect(nativeTexts('en').reminderBody).toBe('You have a reminder.');
    expect(nativeTexts('sr-Latn').reminderBody).toBe('Imate podsetnik.');
    expect(nativeTexts('sr-Cyrl').reminderBody).toBe('Имате подсетник.');
    expect(nativeTexts('ru').reminderBody).toBe('У вас есть напоминание.');
    expect(nativeTexts('es').reminderBody).toBe('Tienes un recordatorio.');
  });
});
