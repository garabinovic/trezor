import type { Strings } from './en';
import { slavic } from './plural';

// Serbian, Latin script (ekavian). sr-Cyrl.ts is generated from this file by
// tools/i18n/transliterate-sr.py: edit here, then regenerate.

const pad = (n: number) => String(n).padStart(2, '0');

const monthsShort = [
  'jan',
  'feb',
  'mar',
  'apr',
  'maj',
  'jun',
  'jul',
  'avg',
  'sep',
  'okt',
  'nov',
  'dec',
];
const monthsLong = [
  'januar',
  'februar',
  'mart',
  'april',
  'maj',
  'jun',
  'jul',
  'avgust',
  'septembar',
  'oktobar',
  'novembar',
  'decembar',
];
const weekdays = [
  'nedelja',
  'ponedeljak',
  'utorak',
  'sreda',
  'četvrtak',
  'petak',
  'subota',
];
/** "svakog ponedeljka", "svake srede" (genitive of time). */
const everyWeekday = [
  'svake nedelje',
  'svakog ponedeljka',
  'svakog utorka',
  'svake srede',
  'svakog četvrtka',
  'svakog petka',
  'svake subote',
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const srLatn: Strings = {
  common: {
    back: 'Nazad',
    cancel: 'Otkaži',
    close: 'Zatvori',
    save: 'Sačuvaj',
    done: 'Gotovo',
    edit: 'Izmeni',
    delete: 'Obriši',
    remove: 'Ukloni',
    replace: 'Zameni',
    tryAgain: 'Pokušaj ponovo',
    ok: 'U redu',
    notSet: 'Nije podešeno',
    search: 'Pretraga',
    settings: 'Podešavanja',
    clearSearch: 'Obriši pretragu',
    closeDialog: 'Zatvori dijalog',
    clear: (label: string) => `Obriši polje „${label}“`,
    position: (index: number, count: number) => `${index} od ${count}`,
  },

  numbers: {
    decimal: ',',
    group: '.',
    kb: 'KB',
    mb: 'MB',
  },

  native: {
    reminderTitle: 'Štek',
    reminderBody: 'Imate podsetnik.',
    channelName: 'Podsetnici',
    channelDescription: 'Podsetnici koje ste podesili u aplikaciji Štek',
    unlockTitle: 'Otključajte Štek',
    confirmSubtitle: 'Potvrdite da ste to vi',
    appLockOnTitle: 'Uključi zaključavanje aplikacije',
    appLockOffTitle: 'Isključi zaključavanje aplikacije',
  },

  dates: {
    monthsShort,
    monthsLong,
    weekdays,
    weekdaysShort: ['Ned', 'Pon', 'Uto', 'Sre', 'Čet', 'Pet', 'Sub'],
    dayMonth: (day: number, month: number) => `${day}. ${monthsShort[month]}`,
    dayMonthYear: (day: number, month: number, year: number) =>
      `${day}. ${monthsShort[month]} ${year}.`,
    longDate: (weekday: number, day: number, month: number) =>
      `${capitalize(weekdays[weekday])}, ${day}. ${monthsLong[month]}`,
    time: (hours: number, minutes: number) => `${pad(hours)}:${pad(minutes)}`,
    dayAndTime: (day: string, time: string) => `${day}, ${time}`,
    today: 'Danas',
    tomorrow: 'Sutra',
    yesterday: 'Juče',
    justNow: 'Upravo sada',
    minutesAgo: (n: number) => `pre ${n} min`,
    hoursAgo: (n: number) => `pre ${n} h`,
    editedJustNow: 'Izmenjeno upravo sada',
    editedYesterday: 'Izmenjeno juče',
    edited: (when: string) => `Izmenjeno ${when}`,
  },

  tabs: {
    home: 'Početna',
    notes: 'Beleške',
    reminders: 'Podsetnici',
    cards: 'Kartice',
    documents: 'Dokumenti',
    documentsAccessibility: 'Dokumenti, kartica',
  },

  categories: {
    note: {
      singular: 'Beleška',
      plural: 'Beleške',
      emptyTitle: 'Još nema beležaka',
      emptyMessage: 'Zapišite ideje, spiskove i sve što želite da zapamtite.',
      newTitle: 'Nova beleška',
      editTitle: 'Izmena beleške',
      add: 'Dodaj belešku',
      deleteTitle: 'Obrisati belešku?',
      discardMessage: 'Izmene ove beleške neće biti sačuvane.',
      filterLabel: 'Filtriraj beleške',
      description: 'Tekst, spiskovi i ideje',
      starter: 'Napišite belešku',
    },
    reminder: {
      singular: 'Podsetnik',
      plural: 'Podsetnici',
      emptyTitle: 'Još nema podsetnika',
      emptyMessage: 'Dodajte podsetnike za obnove, termine i sitne obaveze.',
      newTitle: 'Novi podsetnik',
      editTitle: 'Izmena podsetnika',
      add: 'Dodaj podsetnik',
      deleteTitle: 'Obrisati podsetnik?',
      discardMessage: 'Izmene ovog podsetnika neće biti sačuvane.',
      filterLabel: 'Filtriraj podsetnike',
      description: 'Nešto što treba uraditi u određeno vreme',
      starter: 'Dodajte podsetnik',
    },
    card: {
      singular: 'Kartica',
      plural: 'Kartice',
      emptyTitle: 'Još nema kartica',
      emptyMessage:
        'Neka vam kartice lojalnosti i članske kartice budu pri ruci na kasi.',
      newTitle: 'Nova kartica',
      editTitle: 'Izmena kartice',
      add: 'Dodaj karticu',
      deleteTitle: 'Obrisati karticu?',
      discardMessage: 'Izmene ove kartice neće biti sačuvane.',
      filterLabel: 'Filtriraj kartice',
      description: 'Kartica lojalnosti ili članska kartica',
      starter: 'Dodajte karticu lojalnosti',
    },
    document: {
      singular: 'Dokument',
      plural: 'Dokumenti',
      emptyTitle: 'Još nema dokumenata',
      emptyMessage: 'Čuvajte račune, garancije i važne papire na jednom mestu.',
      newTitle: 'Novi dokument',
      editTitle: 'Izmena dokumenta',
      add: 'Dodaj dokument',
      deleteTitle: 'Obrisati dokument?',
      discardMessage: 'Izmene ovog dokumenta neće biti sačuvane.',
      filterLabel: 'Filtriraj dokumente',
      description: 'Račun, garancija ili datoteka',
      starter: 'Sačuvajte račun ili garanciju',
    },
  },

  documentKinds: {
    receipt: 'Račun',
    warranty: 'Garancija',
    image: 'Slika',
    document: 'Datoteka',
  },

  filters: {
    all: 'Sve',
    upcoming: 'Predstojeći',
    done: 'Završeni',
    upcomingEmpty: 'Sve je završeno.',
    doneEmpty: 'Ovde će se pojaviti završeni podsetnici.',
    receipts: 'Računi',
    warranties: 'Garancije',
    images: 'Slike',
    files: 'Datoteke',
    receiptsEmpty: 'Nema sačuvanih računa.',
    warrantiesEmpty: 'Nema sačuvanih garancija.',
    imagesEmpty: 'Nema sačuvanih slika.',
    filesEmpty: 'Nema sačuvanih datoteka.',
    nothingHere: 'Ovde nema ničega',
  },

  counts: {
    items: (n: number) =>
      slavic(n, `${n} stavka`, `${n} stavke`, `${n} stavki`),
    upcoming: (n: number) => `Predstojećih: ${n}`,
    nothingDue: 'Ništa nije na redu',
  },

  repeat: {
    once: 'Ne ponavlja se',
    daily: 'Svakog dana',
    weekly: 'Svake nedelje',
    monthly: 'Svakog meseca',
    yearly: 'Svake godine',
    interval: 'U intervalima',
    everyHours: (hours: number) =>
      hours === 1
        ? 'Svakog sata'
        : slavic(
            hours,
            `Svaki ${hours} sat`,
            `Svaka ${hours} sata`,
            `Svakih ${hours} sati`,
          ),
    everyMinutes: (minutes: number) =>
      slavic(
        minutes,
        `Svaki ${minutes} minut`,
        `Svaka ${minutes} minuta`,
        `Svakih ${minutes} minuta`,
      ),
  },

  home: {
    title: 'Štek',
    searchPlaceholder: 'Pretraži sve',
    countAccessibility: (category: string, count: number) =>
      `${category}, ${count}`,
    comingUp: 'Uskoro',
    seeAll: 'Prikaži sve',
    pinned: 'Zakačeno',
    recent: 'Nedavno izmenjeno',
    welcomeTitle: 'Dobro došli u Štek',
    welcomeMessage:
      'Čuvajte beleške, podsetnike, kartice lojalnosti i važne dokumente zajedno, na jednom privatnom mestu.',
    welcomePrivacy:
      'Sve ostaje na ovom uređaju. Bez naloga, bez reklama, bez oblaka.',
    getStarted: 'Za početak',
    addNew: 'Dodaj novo',
  },

  search: {
    placeholder: 'Pretraži sve',
    idleTitle: 'Pretraži sve',
    idleMessage:
      'Pronađite beleške, podsetnike, kartice i dokumente po naslovu ili sadržaju.',
    errorTitle: 'Pretraga nije dostupna',
    errorMessage: 'Stavke trenutno nije moguće pretražiti. Pokušajte ponovo.',
    noResults: 'Nema rezultata',
    noMatch: (query: string) => `Ništa ne odgovara upitu „${query}“.`,
  },

  items: {
    overdue: (summary: string) => `Zakasnelo · ${summary}`,
    markDone: 'Označi kao završeno',
    markNotDone: 'Označi kao nezavršeno',
    writeErrorTitle: 'Izmena nije sačuvana',
    writeErrorMessage:
      'Vaša poslednja izmena nije sačuvana. Spisak sada prikazuje ono što je sačuvano na ovom uređaju. Pokušajte ponovo.',
  },

  detail: {
    notFoundTitle: 'Stavka nije pronađena',
    notFoundMessage: 'Možda je obrisana.',
    pin: 'Zakači na Početnu',
    unpin: 'Otkači',
    pinnedSuffix: ' · Zakačeno',
    deleteMessage: (title: string) => `„${title}“ će biti trajno obrisano.`,
    notes: 'Napomene',
    due: 'Rok',
    next: 'Sledeći put',
    repeat: 'Ponavljanje',
    cardFront: 'Prednja strana',
    cardBack: 'Zadnja strana',
    openFrontPhoto: 'Otvori fotografiju prednje strane',
    openBackPhoto: 'Otvori fotografiju zadnje strane',
    frontPhoto: 'Fotografija prednje strane kartice',
    backPhoto: 'Fotografija zadnje strane kartice',
    cardNumberCaption: 'Broj kartice · Bar-kod nije sačuvan',
    issuer: 'Izdavalac',
    cardholder: 'Vlasnik kartice',
    attachment: 'Prilog',
    attachments: 'Prilozi',
    details: 'Detalji',
    storeOrIssuer: 'Prodavnica ili izdavalac',
    purchaseDate: 'Datum kupovine',
    issueDate: 'Datum izdavanja',
    warrantyEnded: 'Garancija je istekla',
    warrantyUntil: 'Garancija važi do',
    expired: 'Isteklo',
    expiresOn: 'Ističe',
    amount: 'Iznos',
  },

  summary: {
    expired: (date: string) => `Isteklo ${date}`,
    until: (date: string) => `Važi do ${date}`,
    expires: (date: string) => `Ističe ${date}`,
  },

  attachmentTypes: {
    jpeg: 'JPEG slika',
    png: 'PNG slika',
    webp: 'WebP slika',
    heic: 'HEIC slika',
    heif: 'HEIF slika',
    pdf: 'PDF',
    file: 'Datoteka',
  },

  editor: {
    discardTitle: 'Odbaciti izmene?',
    discard: 'Odbaci',
    keepEditing: 'Nastavi uređivanje',
    optional: 'Opciono',
    title: 'Naslov',
    note: 'Beleška',
    notes: 'Napomene',
    noteTitlePlaceholder: 'npr. Ideje za poklone',
    noteBodyPlaceholder: 'Zapišite sve što želite da sačuvate',
    reminderTitlePlaceholder: 'npr. Obnovi osiguranje automobila',
    date: 'Datum',
    time: 'Vreme',
    repeat: 'Ponavljanje',
    every: 'Na svakih',
    interval: 'Interval',
    repeatOptions: {
      once: 'Jednom',
      daily: 'Dnevno',
      weekly: 'Nedeljno',
      monthly: 'Mesečno',
      yearly: 'Godišnje',
      interval: 'Interval',
    },
    hours: (n: number) => slavic(n, `${n} sat`, `${n} sata`, `${n} sati`),
    hint: {
      once: 'Obaveštenje stiže jednom, u ovo vreme.',
      daily: (time: string) => `Obaveštenje stiže svakog dana u ${time}.`,
      weekly: (weekday: number, time: string) =>
        `Obaveštenje stiže ${everyWeekday[weekday]} u ${time}.`,
      monthly: (day: number, time: string) =>
        `Obaveštenje stiže ${day}. dana svakog meseca u ${time}.`,
      monthlyShort: ' U kraćim mesecima, poslednjeg dana.',
      yearly: (date: string, time: string) =>
        `Obaveštenje stiže svake godine ${date} u ${time}.`,
      leapDay: ' Ostalih godina, 28. februara.',
      interval: (every: string) =>
        `Obaveštenje stiže ${every.toLowerCase()}, počev od datuma i vremena iznad.`,
    },
    batteryNote:
      'Obaveštenja mogu da kasne jer Android štedi bateriju. Dozvolite „Alarme i podsetnike“ u Podešavanjima da bi stizala na vreme.',
    cardName: 'Naziv kartice',
    cardNamePlaceholder: 'npr. Greenleaf Rewards',
    issuer: 'Izdavalac',
    issuerPlaceholder: 'Prodavnica ili program, opciono',
    cardNumber: 'Broj kartice',
    cardNumberPlaceholder: 'Kako je odštampan na kartici',
    cardNumberHelper:
      'Skeniranje kartice kamerom stiže u nekoj od narednih verzija.',
    cardholder: 'Vlasnik kartice',
    cardPhotos: 'Fotografije kartice',
    front: 'Prednja strana',
    back: 'Zadnja strana',
    frontPhoto: 'Fotografija prednje strane kartice',
    backPhoto: 'Fotografija zadnje strane kartice',
    addFront: 'Dodaj prednju',
    addBack: 'Dodaj zadnju',
    addFrontPhoto: 'Dodaj fotografiju prednje strane',
    addBackPhoto: 'Dodaj fotografiju zadnje strane',
    replaceFrontPhoto: 'Zameni fotografiju prednje strane',
    replaceBackPhoto: 'Zameni fotografiju zadnje strane',
    removeFrontPhoto: 'Ukloni fotografiju prednje strane',
    removeBackPhoto: 'Ukloni fotografiju zadnje strane',
    addingPhoto: 'Dodavanje fotografije…',
    photosNote: 'Opciono. Fotografije su šifrovane i ostaju na ovom uređaju.',
    type: 'Vrsta',
    documentType: 'Vrsta dokumenta',
    purchaseTitlePlaceholder: 'npr. Mašina za veš',
    documentTitlePlaceholder: 'npr. Ugovor o zakupu stana',
    storeOrIssuer: 'Prodavnica ili izdavalac',
    purchaseDate: 'Datum kupovine',
    issueDate: 'Datum izdavanja',
    warrantyUntil: 'Garancija važi do',
    expiresOn: 'Ističe',
    amount: 'Iznos',
    currency: 'Valuta',
    attachments: 'Prilozi',
    fileOptions: (fileName: string) => `Opcije za ${fileName}`,
    addPhotos: 'Dodaj fotografije',
    addFiles: 'Dodaj datoteke',
    addingFiles: 'Dodavanje datoteka…',
    attachmentsNote: (max: number) =>
      `Fotografije ili PDF datoteke, najviše ${max} datoteka do 25 MB. Datoteke su šifrovane i ostaju na ovom uređaju.`,
    attachmentsFull: (max: number) =>
      `Priloženo je ${max} od ${max} datoteka. Uklonite jednu da biste dodali drugu.`,
    moveUp: 'Pomeri gore',
    moveDown: 'Pomeri dole',
    replace: 'Zameni',
    remove: 'Ukloni',
    replaceSubtitle: 'Izaberite drugu fotografiju ili PDF',
    validation: {
      cardName: 'Unesite naziv kartice.',
      title: 'Unesite naslov.',
      futureTime: 'Izaberite vreme u budućnosti.',
      interval: 'Izaberite koliko često da se ponavlja.',
      cardNumber: 'Unesite broj kartice.',
      tooManyAttachments: (max: number, extra: number) =>
        `Dokument može imati najviše ${max} priloga. Uklonite ${extra}.`,
      amount: 'Unesite ispravan iznos, npr. 24,90',
      warrantyEnd: 'Kraj garancije mora biti posle datuma kupovine.',
      expiry: 'Datum isteka mora biti posle datuma izdavanja.',
    },
    importFailure: {
      tooLarge: (name: string) => `„${name}“ je veće od 25 MB.`,
      unsupportedPhoto: (name: string) =>
        `„${name}“ nije podržana fotografija. Koristite JPEG, PNG, WebP ili HEIC.`,
      unsupportedFile: (name: string) =>
        `„${name}“ nije podržano. Koristite fotografiju (JPEG, PNG, WebP, HEIC) ili PDF.`,
      readFailed: (name: string) => `„${name}“ nije moguće pročitati.`,
      importFailed: (name: string) =>
        `„${name}“ nije moguće sačuvati. Pokušajte ponovo.`,
    },
    pickError: {
      photosKeyUnavailable:
        'Fotografije nije moguće dodati: ključ za šifrovanje nije dostupan.',
      filesKeyUnavailable:
        'Datoteke nije moguće dodati: ključ za šifrovanje nije dostupan.',
      noPhotoPicker: 'Na ovom uređaju nema aplikacije za izbor fotografija.',
      noFilePicker: 'Na ovom uređaju nema aplikacije za izbor datoteka.',
      photoFailed: 'Fotografiju nije moguće dodati. Pokušajte ponovo.',
      fileFailed: 'Datoteku nije moguće dodati. Pokušajte ponovo.',
    },
    skipped: (skipped: number, limit: number) =>
      `${slavic(
        skipped,
        `${skipped} datoteka nije dodata`,
        `${skipped} datoteke nisu dodate`,
        `${skipped} datoteka nije dodato`,
      )}: dokument može imati najviše ${limit} priloga.`,
  },

  viewer: {
    frontOfCard: 'Prednja strana kartice',
    backOfCard: 'Zadnja strana kartice',
    previousFile: 'Prethodna datoteka',
    nextFile: 'Sledeća datoteka',
    page: (index: number, count: number) => `Strana ${index} od ${count}`,
    opening: 'Otvaranje…',
    saveCopy: 'Sačuvaj kopiju',
    share: 'Podeli',
    copySaved: 'Kopija je sačuvana.',
    notFoundTitle: 'Datoteka nije pronađena',
    notFoundMessage: 'Možda je uklonjena.',
    zoomHint: 'Raširite prste ili dodirnite dvaput za uvećanje',
    pageUnavailable: 'Ovu stranu nije moguće prikazati',
    problems: {
      missingTitle: 'Datoteka nedostaje',
      missingMessage:
        'Njena šifrovana kopija više nije na ovom uređaju. Možete je ukloniti ili zameniti u izmeni stavke.',
      damagedTitle: 'Datoteka je oštećena',
      damagedMessage:
        'Ne odgovara datoteci koja je sačuvana, pa se ne prikazuje. Možete je ukloniti ili zameniti u izmeni stavke.',
      cantOpenTitle: 'Datoteku nije moguće otvoriti',
      keyMessage: 'Njen ključ za šifrovanje nije dostupan na ovom uređaju.',
      passwordTitle: 'PDF je zaštićen lozinkom',
      passwordMessage:
        'Štek ne može da otvori PDF datoteke koje traže lozinku.',
      pdfTitle: 'PDF nije moguće prikazati',
      pdfMessage: 'Android ne može da prikaže ovaj PDF.',
      imageTitle: 'Sliku nije moguće prikazati',
      imageMessage: 'Ovaj format slike nije podržan na ovoj verziji Androida.',
      genericMessage: 'Nešto nije u redu. Pokušajte ponovo.',
    },
    photoProblems: {
      missing: 'Datoteka fotografije nedostaje',
      damaged: 'Datoteka fotografije je oštećena',
      unsupported: 'Ova fotografija ne može da se prikaže na ovom uređaju',
      failed: 'Fotografiju trenutno nije moguće prikazati',
    },
    saveErrors: {
      missingSaved: 'Datoteka nedostaje i ne može da se sačuva.',
      missingShared: 'Datoteka nedostaje i ne može da se podeli.',
      damagedSaved: 'Datoteka je oštećena i ne može da se sačuva.',
      damagedShared: 'Datoteka je oštećena i ne može da se podeli.',
      keySaved:
        'Datoteka ne može da se sačuva: njen ključ za šifrovanje nije dostupan.',
      keyShared:
        'Datoteka ne može da se podeli: njen ključ za šifrovanje nije dostupan.',
      notEmpty: 'Ta datoteka već postoji i nije menjana. Izaberite novo ime.',
      unverified:
        'Ova lokacija ne može da potvrdi da je datoteka nova, pa ništa nije sačuvano. Tamo može da ostane prazna datoteka. Izaberite drugu lokaciju.',
      failed: 'Kopiju nije moguće sačuvati. Nepotpuna kopija je uklonjena.',
      incomplete:
        'Kopiju nije moguće sačuvati. Tamo gde ste izabrali da je sačuvate može da ostane nepotpuna datoteka.',
      noSaver: 'Nijedna aplikacija na ovom uređaju ne može da sačuva datoteke.',
      noReceiver:
        'Nijedna aplikacija na ovom uređaju ne može da primi ovu datoteku.',
      genericSaved: 'Datoteku nije moguće sačuvati. Pokušajte ponovo.',
      genericShared: 'Datoteku nije moguće podeliti. Pokušajte ponovo.',
    },
  },

  settings: {
    title: 'Podešavanja',
    appearance: 'Izgled',
    theme: 'Tema',
    themeSystem: 'Sistemska',
    themeLight: 'Svetla',
    themeDark: 'Tamna',
    language: 'Jezik',
    notificationPrivacy: 'Privatnost obaveštenja',
    scheduleFailed:
      'Podsetnike trenutno nije moguće zakazati. Štek će automatski pokušati ponovo.',
    androidSettingsApply:
      'Uvek važe Androidova podešavanja obaveštenja i zaključanog ekrana.',
    showDetails: 'Prikaži detalje podsetnika',
    showDetailsSubtitle:
      'Dozvoli da se naslovi i opisi podsetnika prikazuju u obaveštenjima.',
    notificationsOff: 'Obaveštenja su isključena',
    notificationsOffSubtitle:
      'Uključite ih u Android podešavanjima da biste dobijali podsetnike.',
    remindersLate: 'Podsetnici mogu da kasne',
    remindersLateSubtitle:
      'Dozvolite „Alarme i podsetnike“ u Android podešavanjima da bi podsetnici stizali na vreme.',
    security: 'Bezbednost',
    appLockFooter:
      'Zaključavanje aplikacije skriva Štek kad god ga napustite, dok ga ne otključate otiskom prsta, licem ili zaključavanjem ekrana. Vaši podaci su šifrovani u svakom slučaju.',
    appLock: 'Zaključavanje aplikacije',
    appLockSubtitle: 'Traži otisak prsta, lice ili zaključavanje ekrana',
    appLockNeedsScreenLock:
      'Prvo podesite zaključavanje ekrana u Android podešavanjima',
    data: 'Podaci',
    dataFooter:
      'Štek čuva sve na ovom uređaju. Nema naloga ni sinhronizacije sa oblakom. Rezervna kopija je datoteka koju sami čuvate, šifrovana sopstvenom lozinkom.',
    backup: 'Napravi rezervnu kopiju',
    backupSubtitle: 'Sve, šifrovano lozinkom koju izaberete',
    checkBackup: 'Proveri rezervnu kopiju',
    checkBackupSubtitle:
      'Proverite datoteku rezervne kopije bez ikakvih izmena',
    restore: 'Vrati iz rezervne kopije',
    restoreSubtitle: 'Zamenjuje sve podatke na ovom uređaju',
    deleteAll: 'Obriši sve podatke',
    deleteAllSubtitle:
      'Sve na ovom uređaju; datoteke rezervnih kopija se čuvaju',
    deleteAllTitle: 'Obrisati sve podatke?',
    deleteAllMessage:
      'Sve beleške, podsetnici, kartice, dokumenti i priložene datoteke na ovom uređaju biće trajno obrisani, a Štek će početi prazan. Rezervne kopije koje ste sačuvali van Šteka ostaju netaknute. Ovo se ne može poništiti.',
    deleteEverything: 'Obriši sve',
    backUpFirst: 'Prvo napravi kopiju',
    deleting: 'Brisanje…',
    deleteRestoreInProgress: 'Vraćanje je u toku. Ništa nije obrisano.',
    deleteFailed: 'Ništa nije obrisano. Pokušajte ponovo.',
    preview: 'Pregled',
    previewFooter:
      'Samo u razvojnim verzijama. Primeri podataka se čuvaju u memoriji i nikad se ne mešaju sa vašim sačuvanim stavkama.',
    sampleData: 'Prikaži primere podataka',
    sampleDataSubtitle: 'Isključite da biste videli prvo pokretanje',
    about: 'O aplikaciji',
    version: 'Verzija',
    aboutTitle: 'O Šteku',
    aboutParagraphs: [
      'Štek je jednostavan lični organizator koji vam pomaže da važne stvari u životu držite na jednom mestu.',
      'Čuvajte beleške, podsetnike, kartice lojalnosti i dokumente, a svoje podatke držite uređenim i lako dostupnim.',
      'Štek je napravljen sa idejom privatnosti i jednostavnosti. Vaši podaci se čuvaju lokalno na vašem uređaju, zaštićeni šifrovanjem, i ostaju pod vašom kontrolom. Možete napraviti šifrovanu rezervnu kopiju da biste sačuvali podatke kada menjate ili resetujete uređaj.',
      'Naš cilj je jednostavan: korisno i pouzdano mesto za vaše lične podatke, bez nepotrebne složenosti.',
    ],
    feedbackTitle: 'Utisci i predlozi',
    feedbackParagraphs: [
      'Imate ideju kako da Štek bude bolji?',
      'Rado ćemo vas saslušati. Bilo da imate predlog, naišli ste na problem ili samo želite da podelite svoje iskustvo, slobodno nam se javite.',
    ],
    email: 'E-pošta: ',
    emailAccessibility: (address: string) => `Pošalji e-poštu na ${address}`,
    noEmailApp: 'Na ovom uređaju nije podešena aplikacija za e-poštu.',
  },

  backup: {
    title: 'Rezervna kopija',
    intro:
      'Datoteka rezervne kopije sadrži sve vaše beleške, podsetnike, kartice, dokumente i priložene datoteke, šifrovane lozinkom koju ovde izaberete. Štek ne može da povrati zaboravljenu lozinku.',
    password: 'Lozinka rezervne kopije',
    passwordHelper: 'Od 10 do 256 znakova.',
    repeatPassword: 'Ponovite lozinku',
    showPassword: 'Prikaži lozinku',
    hidePassword: 'Sakrij lozinku',
    chooseDestination: 'Izaberi gde da se sačuva',
    running: 'Pravljenje rezervne kopije…',
    runningMessage:
      'Vaši podaci se upisuju, a zatim proveravaju. Ne zatvarajte Štek dok se ovo ne završi.',
    keepOpen: 'Ne zatvarajte Štek dok se ovo ne završi.',
    savedTitle: 'Rezervna kopija je sačuvana i proverena',
    savedMessage: (size: string) =>
      `Datoteka rezervne kopije (${size}) je ponovo pročitana i proverena. Čuvajte je na sigurnom, zajedno sa lozinkom: bez lozinke ne može da se vrati.`,
    incompleteTitle: 'Možda je ostala nepotpuna rezervna kopija',
    incompleteMessage: (fileName: string) =>
      `Pravljenje rezervne kopije nije završeno i Štek nije mogao da obriše njenu datoteku „${fileName}“. Obrišite je tamo gde ste je sačuvali; ne može da se vrati.`,
    fileName: (date: string) => `Štek rezervna kopija ${date}.tzbk`,
  },

  check: {
    title: 'Provera rezervne kopije',
    intro:
      'Proverava da li je datoteka rezervne kopije potpuna i da li je lozinka ispravna. Ništa se na ovom uređaju ne menja.',
    chooseFile: 'Izaberi datoteku kopije',
    running: 'Provera rezervne kopije…',
    validTitle: 'Rezervna kopija je potpuna',
    validMessage: (attachments: number) =>
      `Svaki deo datoteke je dešifrovan i proveren${
        attachments > 0
          ? `, uključujući ${slavic(
              attachments,
              `${attachments} priloženu datoteku`,
              `${attachments} priložene datoteke`,
              `${attachments} priloženih datoteka`,
            )}`
          : ''
      }. Može se vratiti ovom lozinkom. Ništa na ovom uređaju nije promenjeno.`,
  },

  restore: {
    title: 'Vraćanje',
    warning:
      'Sve u Šteku na ovom uređaju biće zamenjeno sadržajem rezervne kopije: vaše trenutne beleške, podsetnici, kartice, dokumenti i priložene datoteke. Ovo se ne može poništiti.',
    noDataFile:
      'Na ovom uređaju ne postoji datoteka sa podacima preko koje bi se vratila kopija. Umesto toga pokušajte ponovo.',
    stopped: 'Vraćanje je zaustavljeno. Vaši podaci su kao i pre.',
    preparing: 'Priprema…',
    preparingMessage: 'Proverava se da li je vraćanje moguće.',
    restoring: 'Vraćanje…',
    restoringMessage:
      'Rezervna kopija se čita i proverava. Ne zatvarajte Štek dok se ovo ne završi.',
    sharingTitle: 'Datoteka se još deli',
    sharingMessage:
      'Štek predaje datoteku drugoj aplikaciji. Sačekajte da se to završi ili otkažite vraćanje.',
    checkAgain: 'Proveri ponovo',
    cancelRestore: 'Otkaži vraćanje',
    finishing: 'Završavanje vraćanja…',
    finishingMessage:
      'Štek se sada sam ponovo pokreće. Ako se to ne desi: vraćanje još nije završeno. Zatvorite i ponovo otvorite Štek da biste ga dovršili.',
    cleaningUp: 'Dovođenje vaših podataka u red…',
    chooseFile: 'Izaberi datoteku kopije',
    chooseAnother: 'Izaberi drugu datoteku',
    fileChosen: 'Datoteka rezervne kopije je izabrana.',
    restore: 'Vrati',
    replaceTitle: 'Zameniti sve podatke?',
    replace: 'Zameni',
  },

  backupErrors: {
    PASSWORD_INVALID:
      'Lozinka sadrži znak koji ne može da se koristi. Unesite je ponovo.',
    PASSWORD_CHARACTER:
      'Lozinka sadrži znak koji ne može da se koristi, na primer kontrolni ili znak za formatiranje.',
    PASSWORD_LENGTH: 'Lozinka mora imati od 10 do 256 znakova.',
    PASSWORD_MISMATCH: 'Lozinke se ne podudaraju.',
    BACKUP_PASSWORD_OR_HEADER:
      'Lozinka nije ispravna ili ovo nije Štek rezervna kopija.',
    BACKUP_CORRUPT:
      'Datoteka rezervne kopije je oštećena ili nepotpuna. Ne može da se koristi.',
    BACKUP_INCONSISTENT:
      'Delovi datoteke rezervne kopije se međusobno ne slažu. Ne može da se koristi.',
    BACKUP_UNSUPPORTED:
      'Ovu rezervnu kopiju je napravila druga verzija Šteka i ovde ne može da se koristi.',
    BACKUP_TOO_LARGE: 'Datoteka rezervne kopije je prevelika.',
    BACKUP_INSUFFICIENT_MEMORY:
      'Trenutno nema dovoljno slobodne memorije. Zatvorite druge aplikacije i pokušajte ponovo.',
    INSUFFICIENT_SPACE:
      'Na ovom uređaju nema dovoljno slobodnog prostora. Oslobodite malo prostora i pokušajte ponovo.',
    DESTINATION_NOT_EMPTY:
      'Izabrana datoteka nije prazna. Umesto toga izaberite novo ime datoteke.',
    DESTINATION_UNVERIFIED:
      'Štek nije mogao da proveri rezervnu kopiju na toj lokaciji. Izaberite folder u memoriji samog uređaja (u meniju birača datoteka, naziv uređaja), a zatim kopirajte rezervnu kopiju gde god želite.',
    KEY_UNAVAILABLE:
      'Vaše priložene datoteke ne mogu da se pročitaju ključem ovog uređaja. Ništa nije promenjeno.',
    NO_ACTIVITY:
      'Štek mora biti otvoren u prvom planu da biste izabrali datoteku.',
    BUSY: 'Birač datoteka je već otvoren.',
    PICKER_UNAVAILABLE: 'Nema aplikacije za izbor datoteke.',
    BACKUP_CHANGED:
      'Datoteka rezervne kopije se promenila od provere. Izaberite je ponovo i pokušajte još jednom.',
    RESTORE_UNAVAILABLE:
      'Vraćanje nije moguće: ključ za šifrovanje na ovom uređaju nedostaje ili više ne važi. Ništa nije promenjeno.',
    RESTORE_STATE_UNKNOWN:
      'Prethodno vraćanje je ostavilo datoteke koje Štek ne može da objasni, pa neće pokrenuti novo. Ništa nije promenjeno.',
    RESTORE_IN_PROGRESS: 'Vraćanje je već u toku.',
    RESTORE_CANCELLED: 'Vraćanje je otkazano. Ništa nije promenjeno.',
    RESTORE_RECOVERY_RETRY:
      'Vraćanje je zaustavljeno, ali Štek nije uspeo da do kraja dovede vaše podatke u red. Pokušajte ponovo.',
    STORAGE_ERROR:
      'Štek nije mogao da pročita vaše priložene datoteke. Ništa nije promenjeno.',
    generic: 'Nešto nije u redu. Ništa nije promenjeno.',
    attachment: (
      fileName: string | null,
      itemTitle: string | null,
      reason: 'MISSING' | 'DAMAGED' | 'MISMATCH' | null,
    ) => {
      const what = fileName ? `Datoteka „${fileName}“` : 'Priložena datoteka';
      const where = itemTitle ? ` u stavci „${itemTitle}“` : '';
      const why =
        reason === 'MISSING'
          ? 'nedostaje'
          : reason === 'DAMAGED'
          ? 'je oštećena'
          : reason === 'MISMATCH'
          ? 'ne odgovara svom zapisu'
          : 'ne može da se pročita';
      return `${what}${where} ${why}. Otvorite stavku, uklonite ili zamenite datoteku, pa ponovo napravite rezervnu kopiju.`;
    },
    destinationRemains:
      'Tamo gde ste sačuvali kopiju može da ostane nepotpuna datoteka; obrišite je tamo.',
  },

  storageError: {
    keepInstalled:
      'Nemojte deinstalirati Štek: time biste trajno izbrisali svoje podatke.',
    keyTitle: 'Štek ne može da otključa vaše podatke',
    keyMessage:
      'Ključ za šifrovanje koji štiti vaše podatke na ovom uređaju nedostaje ili više ne važi. Ništa nije obrisano.',
    newerTitle: 'Ažurirajte Štek da biste nastavili',
    newerMessage:
      'Vaše podatke je sačuvala novija verzija Šteka. Instalirajte najnoviju verziju da biste ih otvorili. Ništa nije promenjeno.',
    corruptTitle: 'Vaše podatke nije moguće otvoriti',
    corruptMessage:
      'Datoteka sa podacima izgleda oštećeno ili ne odgovara svom ključu. Ništa nije obrisano.',
    genericTitle: 'Štek nije mogao da otvori vaše podatke',
    genericMessage:
      'Nešto nije u redu prilikom otvaranja bezbednog skladišta. Ništa nije obrisano.',
    migrationTitle: 'Štek nije mogao da završi ažuriranje',
    migrationMessage:
      'Vaše podatke nije bilo moguće prilagoditi ovoj verziji, pa su ostali tačno onakvi kakvi su bili.',
    restoreUnfinishedTitle: 'Vraćanje još nije završeno',
    restoreVerifyMessage:
      'Štek trenutno nije mogao da proveri vraćene podatke. Vaši podaci od pre vraćanja čuvaju se dok to ne bude moguće.',
    restoreRetryMessage:
      'Jedan korak vraćanja nije mogao da se završi. Ništa nije izgubljeno; ponovni pokušaj nastavlja tamo gde je stalo.',
    restoreUnknownTitle: 'Nedovršeno vraćanje traži pažnju',
    restoreUnknownMessage:
      'Štek je pronašao datoteke vraćanja koje ne može da objasni. Da bi zaštitio vaše podatke, ništa ne menja automatski.',
    restoreKeyTitle: 'Štek ne može da završi vraćanje',
    restoreKeyMessage:
      'Ključ za šifrovanje na ovom uređaju nedostaje ili više ne važi. Sve datoteke vraćanja se čuvaju.',
    wipeTitle: 'Brisanje vaših podataka nije završeno',
    wipeMessage:
      'Neke datoteke još nisu uklonjene. Pokušajte ponovo da biste ga završili; ništa se ne prikazuje dok se to ne desi.',
    restoreRunningTitle: 'Vraćanje je još u toku',
    restoreRunningMessage: 'Sačekajte trenutak, pa pokušajte ponovo.',
    tryAgain: 'Pokušaj ponovo',
    restore: 'Vrati iz rezervne kopije',
    restoreUnavailable:
      'Vraćanje rezervne kopije nije moguće na ovom uređaju dok njegov ključ nedostaje ili ne važi (RESTORE_UNAVAILABLE).',
    cancelRestore: 'Otkaži vraćanje i vrati prethodne podatke',
    cancelTitle: 'Otkazati vraćanje?',
    cancelMessage:
      'Vraćeni podaci biće odbačeni, a Štek se vraća na podatke koje ste imali pre vraćanja.',
    returnToPrevious: 'Vrati prethodne podatke',
    errorCode: (code: string) => `Kôd greške: ${code}`,
  },

  reminders: {
    permissionTitle: 'Dozvoliti obaveštenja za podsetnike?',
    permissionMessage:
      'Štek koristi obaveštenja da vas podseti u vreme koje ste podesili. Detalji podsetnika ostaju skriveni osim ako ne izaberete da ih prikažete u Podešavanjima.',
    continue: 'Nastavi',
    notNow: 'Ne sada',
    exactTitle: 'Isporučivati podsetnike na vreme?',
    exactMessage:
      'Bez ovoga Android može da odloži podsetnike radi uštede baterije, a neki telefoni ih zadržavaju dok ne otvorite Štek. Na sledećem ekranu dozvolite „Alarme i podsetnike“ za Štek.',
    openSettings: 'Otvori podešavanja',
  },

  lock: {
    locked: 'Štek je zaključan',
    unlockHint: 'Otključajte otiskom prsta, licem ili zaključavanjem ekrana.',
    unlock: 'Otključaj',
    noCredential:
      'Na ovom uređaju više nije podešen otisak prsta, lice ni zaključavanje ekrana, pa Štek ne može da potvrdi da ste to vi. Podesite zaključavanje ekrana u Android podešavanjima ili isključite zaključavanje aplikacije.',
    turnOff: 'Isključi zaključavanje aplikacije',
    lockout:
      'Previše pokušaja. Sačekajte trenutak, pa pokušajte ponovo ili upotrebite zaključavanje ekrana.',
    unavailable:
      'Na ovom uređaju nije podešen otisak prsta, lice ni zaključavanje ekrana.',
    failed: 'Štek nije mogao da potvrdi da ste to vi. Pokušajte ponovo.',
    confirmDeleteAll: 'Brisanje svih podataka',
  },
};
