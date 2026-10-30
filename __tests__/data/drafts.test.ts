import type { DocumentItem, Item } from '../../src/data/types';
import {
  createBlankItem,
  normalize,
  validate,
} from '../../src/screens/editor/drafts';

const doc = (patch: Partial<DocumentItem>): DocumentItem => ({
  ...(createBlankItem('document') as DocumentItem),
  title: 'Doc',
  ...patch,
});

describe('createBlankItem', () => {
  test.each(['note', 'reminder', 'card', 'document'] as const)(
    'creates a %s with a UUIDv7 id and matching timestamps',
    type => {
      const item = createBlankItem(type);
      expect(item.type).toBe(type);
      expect(item.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(item.createdAt).toBe(item.updatedAt);
      expect(item.pinned).toBe(false);
    },
  );

  test('ids are unique', () => {
    const ids = new Set(
      Array.from({ length: 50 }, () => createBlankItem('note').id),
    );
    expect(ids.size).toBe(50);
  });
});

describe('validate', () => {
  test('requires a title for every type', () => {
    for (const type of ['note', 'reminder', 'document'] as const) {
      expect(validate(createBlankItem(type)).title).toBe('Enter a title.');
    }
    expect(validate(createBlankItem('card')).title).toBe(
      'Enter the store or card name.',
    );
  });

  test('whitespace-only titles are rejected', () => {
    expect(validate({ ...createBlankItem('note'), title: '   ' }).title).toBe(
      'Enter a title.',
    );
  });

  test('cards require a card number', () => {
    const card = { ...createBlankItem('card'), title: 'Shop' } as Item;
    expect(validate(card)).toEqual({ cardNumber: 'Enter the card number.' });
  });

  test('documents reject an invalid amount', () => {
    expect(validate(doc({ amount: Number.NaN })).amount).toBeDefined();
    expect(validate(doc({ amount: 12.5 }))).toEqual({});
  });

  test('expiry before the issue or purchase date is rejected for every kind', () => {
    const early = { date: '2026-05-01', expiresOn: '2026-01-01' };
    expect(validate(doc({ ...early, kind: 'warranty' })).expiresOn).toBe(
      'Warranty end must be after the purchase date.',
    );
    expect(validate(doc({ ...early, kind: 'document' })).expiresOn).toBe(
      'Expiry date must be after the issue date.',
    );
    expect(
      validate(doc({ date: '2026-01-01', expiresOn: '2027-01-01' })),
    ).toEqual({});
  });
});

describe('normalize', () => {
  test('trims text fields and bumps updatedAt, keeping createdAt', () => {
    const item = {
      ...createBlankItem('card'),
      title: '  Shop  ',
      cardNumber: ' 123 ',
      holderName: ' Ana ',
      notes: ' x ',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Item;
    const out = normalize(item);
    expect(out).toMatchObject({
      title: 'Shop',
      cardNumber: '123',
      holderName: 'Ana',
      notes: 'x',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(out.updatedAt > item.updatedAt).toBe(true);
  });

  test('keeps the expiry date for non-warranty documents', () => {
    const out = normalize(
      doc({ kind: 'document', expiresOn: '2030-01-01' }),
    ) as DocumentItem;
    expect(out.expiresOn).toBe('2030-01-01');
  });

  test('upper-cases the currency and defaults it', () => {
    expect(
      (normalize(doc({ currency: ' rsd ' })) as DocumentItem).currency,
    ).toBe('RSD');
    expect((normalize(doc({ currency: '  ' })) as DocumentItem).currency).toBe(
      'EUR',
    );
  });
});
