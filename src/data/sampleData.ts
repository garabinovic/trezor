import { toIsoDate } from './format';
import { Item } from './types';

/**
 * Realistic sample content for Phase 0 previews.
 * Dates are relative to "now" so the overview always looks current.
 */
export function createSampleItems(now = new Date()): Item[] {
  const at = (days: number, hours = 0, minutes = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hours, minutes, 0, 0);
    return d.toISOString();
  };
  const ago = (days: number, hours = 0) =>
    new Date(
      now.getTime() - days * 86_400_000 - hours * 3_600_000,
    ).toISOString();
  const day = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return toIsoDate(d);
  };

  return [
    // Notes
    {
      id: 'n1',
      type: 'note',
      title: 'Wi-Fi at the cottage',
      body: 'Network: Lakeview-5G\nPassword: pinecone-harbor-42\n\nRouter is behind the bookshelf in the living room. Restart it if the connection drops.',
      pinned: true,
      createdAt: ago(40),
      updatedAt: ago(3),
    },
    {
      id: 'n2',
      type: 'note',
      title: 'Gift ideas',
      body: 'Mum — a good cast iron pan, the green one she liked.\nAlex — climbing shoes (size 42).\nSam — that photography book about lighthouses.',
      pinned: false,
      createdAt: ago(12),
      updatedAt: ago(0, 2),
    },
    {
      id: 'n3',
      type: 'note',
      title: 'Bike service notes',
      body: 'Chain replaced in March. Rear brake pads at about 40%. Ask about tubeless conversion next time.',
      pinned: false,
      createdAt: ago(60),
      updatedAt: ago(9),
    },
    {
      id: 'n4',
      type: 'note',
      title: 'Books to read',
      body: 'The Overstory\nPiranesi\nA Psalm for the Wild-Built\nFour Thousand Weeks',
      pinned: false,
      createdAt: ago(90),
      updatedAt: ago(21),
    },

    // Reminders
    {
      id: 'r1',
      type: 'reminder',
      title: 'Pay electricity bill',
      dueAt: at(-1, 18, 0),
      repeat: 'monthly',
      notes: 'Reference number is on the last invoice.',
      completed: false,
      pinned: false,
      createdAt: ago(30),
      updatedAt: ago(30),
    },
    {
      id: 'r2',
      type: 'reminder',
      title: 'Dentist appointment',
      dueAt: at(0, 16, 30),
      repeat: 'none',
      notes: 'Dr. Ellis, 2nd floor. Bring the insurance card.',
      completed: false,
      pinned: false,
      createdAt: ago(14),
      updatedAt: ago(14),
    },
    {
      id: 'r3',
      type: 'reminder',
      title: 'Renew car registration',
      dueAt: at(5, 9, 0),
      repeat: 'yearly',
      notes: '',
      completed: false,
      pinned: false,
      createdAt: ago(20),
      updatedAt: ago(20),
    },
    {
      id: 'r4',
      type: 'reminder',
      title: 'Water the plants',
      dueAt: at(2, 8, 0),
      repeat: 'weekly',
      notes: '',
      completed: false,
      pinned: false,
      createdAt: ago(50),
      updatedAt: ago(2),
    },
    {
      id: 'r5',
      type: 'reminder',
      title: 'Return library books',
      dueAt: at(-4, 12, 0),
      repeat: 'none',
      notes: '',
      completed: true,
      pinned: false,
      createdAt: ago(25),
      updatedAt: ago(4),
    },

    // Cards
    {
      id: 'c1',
      type: 'card',
      title: 'Greenleaf Market',
      cardNumber: '6044 1290 3381 4821',
      codeFormat: 'barcode',
      holderName: 'Jordan Hale',
      notes: 'Points reset every January.',
      pinned: true,
      createdAt: ago(200),
      updatedAt: ago(200),
    },
    {
      id: 'c2',
      type: 'card',
      title: 'City Library',
      cardNumber: '2100 0458 7712',
      codeFormat: 'barcode',
      holderName: 'Jordan Hale',
      notes: '',
      pinned: false,
      createdAt: ago(320),
      updatedAt: ago(320),
    },
    {
      id: 'c3',
      type: 'card',
      title: 'Northside Pharmacy',
      cardNumber: '880142276',
      codeFormat: 'qr',
      holderName: '',
      notes: '',
      pinned: false,
      createdAt: ago(80),
      updatedAt: ago(80),
    },
    {
      id: 'c4',
      type: 'card',
      title: 'Ridge Fitness',
      cardNumber: 'RF-20931',
      codeFormat: 'qr',
      holderName: 'Jordan Hale',
      notes: 'Membership renews on the 1st.',
      pinned: false,
      createdAt: ago(45),
      updatedAt: ago(45),
    },

    // Documents
    {
      id: 'd1',
      type: 'document',
      kind: 'warranty',
      title: 'Washing machine',
      merchant: 'HomeTech',
      date: day(-410),
      expiresOn: day(320),
      amount: 549,
      currency: 'EUR',
      notes: 'Model WM-8400. Two-year extended warranty included.',
      attachment: { fileName: 'warranty-wm8400.pdf', sizeKb: 312 },
      pinned: false,
      createdAt: ago(410),
      updatedAt: ago(410),
    },
    {
      id: 'd2',
      type: 'document',
      kind: 'receipt',
      title: 'Winter jacket',
      merchant: 'Outpost Outdoor',
      date: day(-6),
      expiresOn: null,
      amount: 189.9,
      currency: 'EUR',
      notes: '30-day return window.',
      attachment: { fileName: 'receipt-outpost.jpg', sizeKb: 846 },
      pinned: false,
      createdAt: ago(6),
      updatedAt: ago(6),
    },
    {
      id: 'd3',
      type: 'document',
      kind: 'warranty',
      title: 'Laptop',
      merchant: 'Circuit Store',
      date: day(-700),
      expiresOn: day(30),
      amount: 1249,
      currency: 'EUR',
      notes: '',
      attachment: { fileName: 'laptop-invoice.pdf', sizeKb: 1520 },
      pinned: false,
      createdAt: ago(700),
      updatedAt: ago(15),
    },
    {
      id: 'd4',
      type: 'document',
      kind: 'image',
      title: 'Passport photo page',
      merchant: '',
      date: day(-120),
      expiresOn: null,
      amount: null,
      currency: 'EUR',
      notes: 'Expires in 2031.',
      attachment: { fileName: 'passport.jpg', sizeKb: 2310 },
      pinned: true,
      createdAt: ago(120),
      updatedAt: ago(120),
    },
    {
      id: 'd5',
      type: 'document',
      kind: 'document',
      title: 'Apartment lease',
      merchant: '',
      date: day(-250),
      expiresOn: null,
      amount: null,
      currency: 'EUR',
      notes: '',
      attachment: { fileName: 'lease-2026.pdf', sizeKb: 640 },
      pinned: false,
      createdAt: ago(250),
      updatedAt: ago(250),
    },
  ];
}
