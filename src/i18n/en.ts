// English: the source language and the fallback for anything missing in
// another language. Every other language has exactly these keys (the
// `Strings` type checks that). Text with values is a function, so word
// order and plural forms can differ per language. User content (titles,
// notes, file names) is only ever passed in, never translated.

const pad = (n: number) => String(n).padStart(2, '0');

const plural = (n: number, one: string, other: string) =>
  `${n} ${n === 1 ? one : other}`;

export const en = {
  common: {
    back: 'Back',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    done: 'Done',
    edit: 'Edit',
    delete: 'Delete',
    remove: 'Remove',
    replace: 'Replace',
    tryAgain: 'Try again',
    ok: 'OK',
    notSet: 'Not set',
    search: 'Search',
    settings: 'Settings',
    clearSearch: 'Clear search',
    closeDialog: 'Close dialog',
    clear: (label: string) => `Clear ${label.toLowerCase()}`,
    /** "2 of 5" (files in the viewer). */
    position: (index: number, count: number) => `${index} of ${count}`,
  },

  numbers: {
    decimal: '.',
    group: ',',
    kb: 'KB',
    mb: 'MB',
  },

  /** Strings Android shows on the app's behalf (see NativeText.kt). */
  native: {
    reminderTitle: 'Stash',
    reminderBody: 'You have a reminder.',
    channelName: 'Reminders',
    channelDescription: 'Reminders you set in Stash',
    unlockTitle: 'Unlock Stash',
    confirmSubtitle: 'Confirm it’s you',
    appLockOnTitle: 'Turn on App Lock',
    appLockOffTitle: 'Turn off App Lock',
  },

  dates: {
    monthsShort: [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ],
    monthsLong: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    weekdays: [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ],
    weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    /** "12 Oct" (month 0–11) */
    dayMonth: (day: number, month: number) =>
      `${day} ${en.dates.monthsShort[month]}`,
    /** "12 Oct 2026" */
    dayMonthYear: (day: number, month: number, year: number) =>
      `${day} ${en.dates.monthsShort[month]} ${year}`,
    /** "Thursday, 30 October" */
    longDate: (weekday: number, day: number, month: number) =>
      `${en.dates.weekdays[weekday]}, ${day} ${en.dates.monthsLong[month]}`,
    time: (hours: number, minutes: number) => `${pad(hours)}:${pad(minutes)}`,
    /** "Today, 09:00" */
    dayAndTime: (day: string, time: string) => `${day}, ${time}`,
    today: 'Today',
    tomorrow: 'Tomorrow',
    yesterday: 'Yesterday',
    justNow: 'Just now',
    minutesAgo: (n: number) => `${n} min ago`,
    hoursAgo: (n: number) => `${n} h ago`,
    /** "Edited just now", "Edited yesterday", "Edited 12 Oct" */
    editedJustNow: 'Edited just now',
    editedYesterday: 'Edited yesterday',
    edited: (when: string) => `Edited ${when}`,
  },

  tabs: {
    home: 'Home',
    notes: 'Notes',
    reminders: 'Reminders',
    cards: 'Cards',
    /** Short: a fifth of the screen. */
    documents: 'Docs',
    documentsAccessibility: 'Documents, tab',
  },

  categories: {
    note: {
      singular: 'Note',
      plural: 'Notes',
      emptyTitle: 'No notes yet',
      emptyMessage:
        'Write down ideas, lists and anything you want to remember.',
      newTitle: 'New note',
      editTitle: 'Edit note',
      add: 'Add note',
      deleteTitle: 'Delete note?',
      discardMessage: 'Your changes to this note will not be saved.',
      filterLabel: 'Filter notes',
      description: 'Text, lists and ideas',
      starter: 'Write a note',
    },
    reminder: {
      singular: 'Reminder',
      plural: 'Reminders',
      emptyTitle: 'No reminders yet',
      emptyMessage: 'Add reminders for renewals, appointments and small tasks.',
      newTitle: 'New reminder',
      editTitle: 'Edit reminder',
      add: 'Add reminder',
      deleteTitle: 'Delete reminder?',
      discardMessage: 'Your changes to this reminder will not be saved.',
      filterLabel: 'Filter reminders',
      description: 'Something to do at a set time',
      starter: 'Add a reminder',
    },
    card: {
      singular: 'Card',
      plural: 'Cards',
      emptyTitle: 'No cards yet',
      emptyMessage: 'Keep your loyalty and membership cards ready at checkout.',
      newTitle: 'New card',
      editTitle: 'Edit card',
      add: 'Add card',
      deleteTitle: 'Delete card?',
      discardMessage: 'Your changes to this card will not be saved.',
      filterLabel: 'Filter cards',
      description: 'Loyalty or membership card',
      starter: 'Add a loyalty card',
    },
    document: {
      singular: 'Document',
      plural: 'Documents',
      emptyTitle: 'No documents yet',
      emptyMessage:
        'Store receipts, warranties and important papers in one place.',
      newTitle: 'New document',
      editTitle: 'Edit document',
      add: 'Add document',
      deleteTitle: 'Delete document?',
      discardMessage: 'Your changes to this document will not be saved.',
      filterLabel: 'Filter documents',
      description: 'Receipt, warranty or file',
      starter: 'Save a receipt or warranty',
    },
  },

  documentKinds: {
    receipt: 'Receipt',
    warranty: 'Warranty',
    image: 'Image',
    document: 'Document',
  },

  filters: {
    all: 'All',
    upcoming: 'Upcoming',
    done: 'Done',
    upcomingEmpty: 'You are all caught up.',
    doneEmpty: 'Completed reminders will appear here.',
    receipts: 'Receipts',
    warranties: 'Warranties',
    images: 'Images',
    files: 'Files',
    receiptsEmpty: 'No receipts saved.',
    warrantiesEmpty: 'No warranties saved.',
    imagesEmpty: 'No images saved.',
    filesEmpty: 'No other documents saved.',
    nothingHere: 'Nothing here',
  },

  counts: {
    items: (n: number) => plural(n, 'item', 'items'),
    upcoming: (n: number) => `${n} upcoming`,
    nothingDue: 'Nothing due',
  },

  repeat: {
    once: 'Does not repeat',
    daily: 'Every day',
    weekly: 'Every week',
    monthly: 'Every month',
    yearly: 'Every year',
    interval: 'At an interval',
    everyHours: (hours: number) =>
      hours === 1 ? 'Every hour' : `Every ${hours} hours`,
    everyMinutes: (minutes: number) => `Every ${minutes} minutes`,
  },

  home: {
    title: 'Stash',
    searchPlaceholder: 'Search everything',
    countAccessibility: (category: string, count: number) =>
      `${category}, ${count}`,
    comingUp: 'Coming up',
    seeAll: 'See all',
    pinned: 'Pinned',
    recent: 'Recently updated',
    welcomeTitle: 'Welcome to Stash',
    welcomeMessage:
      'Keep notes, reminders, loyalty cards and important documents together in one private place.',
    welcomePrivacy:
      'Everything stays on this device. No account, no ads, no cloud.',
    getStarted: 'Get started',
    addNew: 'Add new',
  },

  search: {
    placeholder: 'Search everything',
    idleTitle: 'Search everything',
    idleMessage:
      'Find notes, reminders, cards and documents by title or content.',
    errorTitle: 'Search isn’t available',
    errorMessage:
      'Your items couldn’t be searched right now. Please try again.',
    noResults: 'No results',
    noMatch: (query: string) => `Nothing matches “${query}”.`,
  },

  items: {
    overdue: (summary: string) => `Overdue · ${summary}`,
    markDone: 'Mark as done',
    markNotDone: 'Mark as not done',
    writeErrorTitle: 'Couldn’t save your change',
    writeErrorMessage:
      'Your last change wasn’t saved. The list now shows what is stored on this device. Please try again.',
  },

  detail: {
    notFoundTitle: 'Item not found',
    notFoundMessage: 'It may have been deleted.',
    pin: 'Pin to Home',
    unpin: 'Unpin',
    pinnedSuffix: ' · Pinned',
    deleteMessage: (title: string) => `“${title}” will be permanently deleted.`,
    notes: 'Notes',
    due: 'Due',
    next: 'Next',
    repeat: 'Repeat',
    cardFront: 'Front',
    cardBack: 'Back',
    openFrontPhoto: 'Open front photo',
    openBackPhoto: 'Open back photo',
    frontPhoto: 'Photo of the front of the card',
    backPhoto: 'Photo of the back of the card',
    cardNumberCaption: 'Card number · No barcode saved',
    issuer: 'Issuer',
    cardholder: 'Cardholder',
    attachment: 'Attachment',
    attachments: 'Attachments',
    details: 'Details',
    storeOrIssuer: 'Store or issuer',
    purchaseDate: 'Purchase date',
    issueDate: 'Issue date',
    warrantyEnded: 'Warranty ended',
    warrantyUntil: 'Warranty until',
    expired: 'Expired',
    expiresOn: 'Expires on',
    amount: 'Amount',
  },

  summary: {
    expired: (date: string) => `Expired ${date}`,
    until: (date: string) => `Until ${date}`,
    expires: (date: string) => `Expires ${date}`,
  },

  attachmentTypes: {
    jpeg: 'JPEG image',
    png: 'PNG image',
    webp: 'WebP image',
    heic: 'HEIC image',
    heif: 'HEIF image',
    pdf: 'PDF',
    file: 'File',
  },

  editor: {
    discardTitle: 'Discard changes?',
    discard: 'Discard',
    keepEditing: 'Keep editing',
    optional: 'Optional',
    title: 'Title',
    note: 'Note',
    notes: 'Notes',
    noteTitlePlaceholder: 'e.g. Gift ideas',
    noteBodyPlaceholder: 'Write anything you want to keep',
    reminderTitlePlaceholder: 'e.g. Renew car insurance',
    date: 'Date',
    time: 'Time',
    repeat: 'Repeat',
    every: 'Every',
    interval: 'Interval',
    repeatOptions: {
      once: 'Once',
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
      yearly: 'Yearly',
      interval: 'Interval',
    },
    hours: (n: number) => (n === 1 ? '1 hour' : `${n} hours`),
    hint: {
      once: 'Notifies once at this time.',
      daily: (time: string) => `Notifies every day at ${time}.`,
      weekly: (weekday: number, time: string) =>
        `Notifies every ${en.dates.weekdays[weekday]} at ${time}.`,
      monthly: (day: number, time: string) =>
        `Notifies on day ${day} of every month at ${time}.`,
      monthlyShort: ' In shorter months, on the last day.',
      yearly: (date: string, time: string) =>
        `Notifies every year on ${date} at ${time}.`,
      leapDay: ' In other years, on 28 February.',
      interval: (every: string) =>
        `Notifies ${every.toLowerCase()}, starting at the date and time above.`,
    },
    batteryNote:
      'Notifications may arrive late as Android saves battery. Allow “Alarms & reminders” in Settings so they arrive on time.',
    cardName: 'Card name',
    cardNamePlaceholder: 'e.g. Greenleaf Rewards',
    issuer: 'Issuer',
    issuerPlaceholder: 'Store or programme, optional',
    cardNumber: 'Card number',
    cardNumberPlaceholder: 'As printed on the card',
    cardNumberHelper:
      'Scanning a card with the camera will come in a later version.',
    cardholder: 'Cardholder',
    cardPhotos: 'Card photos',
    front: 'Front',
    back: 'Back',
    frontPhoto: 'Photo of the front of the card',
    backPhoto: 'Photo of the back of the card',
    addFront: 'Add front',
    addBack: 'Add back',
    addFrontPhoto: 'Add front photo',
    addBackPhoto: 'Add back photo',
    replaceFrontPhoto: 'Replace front photo',
    replaceBackPhoto: 'Replace back photo',
    removeFrontPhoto: 'Remove front photo',
    removeBackPhoto: 'Remove back photo',
    addingPhoto: 'Adding photo…',
    photosNote: 'Optional. Photos are encrypted and stay on this device.',
    type: 'Type',
    documentType: 'Document type',
    purchaseTitlePlaceholder: 'e.g. Washing machine',
    documentTitlePlaceholder: 'e.g. Apartment lease',
    storeOrIssuer: 'Store or issuer',
    purchaseDate: 'Purchase date',
    issueDate: 'Issue date',
    warrantyUntil: 'Warranty until',
    expiresOn: 'Expires on',
    amount: 'Amount',
    currency: 'Currency',
    attachments: 'Attachments',
    fileOptions: (fileName: string) => `Options for ${fileName}`,
    addPhotos: 'Add photos',
    addFiles: 'Add files',
    addingFiles: 'Adding files…',
    attachmentsNote: (max: number) =>
      `Photos or PDFs, up to ${max} files of 25 MB each. Files are encrypted and stay on this device.`,
    attachmentsFull: (max: number) =>
      `${max} of ${max} files attached. Remove one to add another.`,
    moveUp: 'Move up',
    moveDown: 'Move down',
    replace: 'Replace',
    remove: 'Remove',
    replaceSubtitle: 'Choose another photo or PDF',
    validation: {
      cardName: 'Enter the card name.',
      title: 'Enter a title.',
      futureTime: 'Choose a time in the future.',
      interval: 'Choose how often to repeat.',
      cardNumber: 'Enter the card number.',
      tooManyAttachments: (max: number, extra: number) =>
        `A document can have at most ${max} attachments. Remove ${extra}.`,
      amount: 'Enter a valid amount, e.g. 24.90',
      warrantyEnd: 'Warranty end must be after the purchase date.',
      expiry: 'Expiry date must be after the issue date.',
    },
    importFailure: {
      tooLarge: (name: string) => `“${name}” is larger than 25 MB.`,
      unsupportedPhoto: (name: string) =>
        `“${name}” isn’t a supported photo. Use JPEG, PNG, WebP or HEIC.`,
      unsupportedFile: (name: string) =>
        `“${name}” isn’t supported. Use a photo (JPEG, PNG, WebP, HEIC) or a PDF.`,
      readFailed: (name: string) => `“${name}” couldn’t be read.`,
      importFailed: (name: string) => `“${name}” couldn’t be saved. Try again.`,
    },
    pickError: {
      photosKeyUnavailable:
        'Photos can’t be added: the encryption key is unavailable.',
      filesKeyUnavailable:
        'Files can’t be added: the encryption key is unavailable.',
      noPhotoPicker: 'No photo picker is available on this device.',
      noFilePicker: 'No file picker is available on this device.',
      photoFailed: 'The photo couldn’t be added. Try again.',
      fileFailed: 'The file couldn’t be added. Try again.',
    },
    skipped: (skipped: number, limit: number) =>
      `${skipped} ${
        skipped === 1 ? 'file wasn’t' : 'files weren’t'
      } added: a document can have at most ${limit} attachments.`,
  },

  viewer: {
    frontOfCard: 'Front of card',
    backOfCard: 'Back of card',
    previousFile: 'Previous file',
    nextFile: 'Next file',
    page: (index: number, count: number) => `Page ${index} of ${count}`,
    opening: 'Opening…',
    saveCopy: 'Save a copy',
    share: 'Share',
    copySaved: 'Copy saved.',
    notFoundTitle: 'File not found',
    notFoundMessage: 'It may have been removed.',
    zoomHint: 'Pinch or double-tap to zoom',
    pageUnavailable: 'This page can’t be shown',
    problems: {
      missingTitle: 'File is missing',
      missingMessage:
        'Its encrypted copy is no longer on this device. You can remove or replace it by editing.',
      damagedTitle: 'File is damaged',
      damagedMessage:
        'It doesn’t match the file that was saved, so it isn’t shown. You can remove or replace it by editing.',
      cantOpenTitle: 'File can’t be opened',
      keyMessage: 'Its encryption key is unavailable on this device.',
      passwordTitle: 'PDF is password-protected',
      passwordMessage: 'Stash can’t open PDFs that need a password.',
      pdfTitle: 'PDF can’t be shown',
      pdfMessage: 'Android can’t display this PDF.',
      imageTitle: 'Image can’t be shown',
      imageMessage:
        'This image format isn’t supported on this version of Android.',
      genericMessage: 'Something went wrong. Try again.',
    },
    photoProblems: {
      missing: 'Photo file is missing',
      damaged: 'Photo file is damaged',
      unsupported: 'This photo can’t be shown on this device',
      failed: 'Photo can’t be shown right now',
    },
    saveErrors: {
      missingSaved: 'The file is missing and can’t be saved.',
      missingShared: 'The file is missing and can’t be shared.',
      damagedSaved: 'The file is damaged and can’t be saved.',
      damagedShared: 'The file is damaged and can’t be shared.',
      keySaved: 'The file can’t be saved: its encryption key is unavailable.',
      keyShared: 'The file can’t be shared: its encryption key is unavailable.',
      notEmpty:
        'That file already exists and was left unchanged. Choose a new name.',
      unverified:
        'This location can’t confirm the file is new, so nothing was saved. An empty file may remain there. Choose another location.',
      failed: 'The copy couldn’t be saved. The incomplete copy was removed.',
      incomplete:
        'The copy couldn’t be saved. An incomplete file may remain where you chose to save it.',
      noSaver: 'No app on this device can save files.',
      noReceiver: 'No app on this device can receive this file.',
      genericSaved: 'The file couldn’t be saved. Try again.',
      genericShared: 'The file couldn’t be shared. Try again.',
    },
  },

  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    language: 'Language',
    notificationPrivacy: 'Notification privacy',
    scheduleFailed:
      'Reminders couldn’t be scheduled just now. Stash will try again automatically.',
    androidSettingsApply:
      'Android’s own notification and lock-screen settings always apply.',
    showDetails: 'Show reminder details',
    showDetailsSubtitle:
      'Allow reminder titles and descriptions to appear in notifications.',
    notificationsOff: 'Notifications are off',
    notificationsOffSubtitle:
      'Turn them on in Android settings to receive reminders.',
    remindersLate: 'Reminders may be late',
    remindersLateSubtitle:
      'Allow “Alarms & reminders” in Android settings so reminders arrive on time.',
    security: 'Security',
    appLockFooter:
      'App lock hides Stash whenever you leave it, until you unlock it with your fingerprint, face or screen lock. Your data is encrypted either way.',
    appLock: 'App lock',
    appLockSubtitle: 'Ask for your fingerprint, face or screen lock',
    appLockNeedsScreenLock: 'Set up a screen lock in Android settings first',
    data: 'Data',
    dataFooter:
      'Stash stores everything on this device. There is no account and no cloud sync. A backup is a file you keep yourself, encrypted with its own password.',
    backup: 'Back up to a file',
    backupSubtitle: 'Everything, encrypted with a password you choose',
    checkBackup: 'Check a backup',
    checkBackupSubtitle: 'Verify a backup file without changing anything',
    restore: 'Restore from a backup',
    restoreSubtitle: 'Replaces all data on this device',
    deleteAll: 'Delete all data',
    deleteAllSubtitle: 'Everything on this device; backup files are kept',
    deleteAllTitle: 'Delete all data?',
    deleteAllMessage:
      'All notes, reminders, cards, documents and attached files on this device are permanently deleted, and Stash starts empty. Backup files you saved outside Stash are not affected. This can’t be undone.',
    deleteEverything: 'Delete everything',
    backUpFirst: 'Back up first',
    deleting: 'Deleting…',
    deleteRestoreInProgress: 'A restore is in progress. Nothing was deleted.',
    deleteFailed: 'Nothing was deleted. Try again.',
    preview: 'Preview',
    previewFooter:
      'Development builds only. Sample data is kept in memory and is never mixed with your saved items.',
    sampleData: 'Show sample data',
    sampleDataSubtitle: 'Turn off to see the first-launch experience',
    about: 'About',
    version: 'Version',
    aboutTitle: 'About Stash',
    aboutParagraphs: [
      'Stash is a simple personal organizer designed to help you keep the important things in your life in one place.',
      'Store your notes, reminders, loyalty cards and documents, and keep your information organized and easy to access.',
      'Stash is built with privacy and simplicity in mind. Your data is stored locally on your device, protected with encryption, and remains under your control. You can create an encrypted backup to keep your data safe when changing or resetting your device.',
      'Our goal is simple: a useful, reliable space for your personal information, without unnecessary complexity.',
    ],
    feedbackTitle: 'Feedback & Suggestions',
    feedbackParagraphs: [
      'Have an idea that could make Stash better?',
      'We’d love to hear from you. Whether you have a suggestion, found an issue, or simply want to share your experience, feel free to get in touch.',
    ],
    email: 'Email: ',
    emailAccessibility: (address: string) => `Email ${address}`,
    noEmailApp: 'No email app is set up on this device.',
  },

  backup: {
    title: 'Back up',
    intro:
      'The backup file contains all your notes, reminders, cards, documents and attached files, encrypted with the password you choose here. Stash can’t recover a forgotten password.',
    password: 'Backup password',
    passwordHelper: '10 to 256 characters.',
    repeatPassword: 'Repeat password',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    chooseDestination: 'Choose where to save',
    running: 'Backing up…',
    runningMessage:
      'Your data is being written and then checked. Keep Stash open until this is done.',
    keepOpen: 'Keep Stash open until this is done.',
    savedTitle: 'Backup saved and verified',
    savedMessage: (size: string) =>
      `The backup file (${size}) was read back and checked. Keep it somewhere safe, together with its password: without the password it can’t be restored.`,
    incompleteTitle: 'An incomplete backup file may remain',
    incompleteMessage: (fileName: string) =>
      `A backup didn’t finish, and Stash couldn’t delete its file “${fileName}”. Delete it where you saved it; it can’t be restored.`,
    fileName: (date: string) => `Stash backup ${date}.tzbk`,
  },

  check: {
    title: 'Check a backup',
    intro:
      'Checks that a backup file is complete and that its password is right. Nothing on this device is changed.',
    chooseFile: 'Choose backup file',
    running: 'Checking the backup…',
    validTitle: 'The backup is complete',
    validMessage: (attachments: number) =>
      `Every part of the file was decrypted and verified${
        attachments > 0
          ? `, including ${plural(
              attachments,
              'attached file',
              'attached files',
            )}`
          : ''
      }. It can be restored with this password. Nothing on this device was changed.`,
  },

  restore: {
    title: 'Restore',
    warning:
      'Everything in Stash on this device is replaced by the contents of the backup: your current notes, reminders, cards, documents and attached files. This can’t be undone.',
    noDataFile:
      'There’s no data file on this device to restore over. Try again instead.',
    stopped: 'The restore was stopped. Your data is as it was before.',
    preparing: 'Preparing…',
    preparingMessage: 'Checking whether a restore is possible.',
    restoring: 'Restoring…',
    restoringMessage:
      'The backup is being read and checked. Keep Stash open until this is done.',
    sharingTitle: 'A file is still being shared',
    sharingMessage:
      'Stash is handing a file to another app. Wait until that has finished, or cancel the restore.',
    checkAgain: 'Check again',
    cancelRestore: 'Cancel restore',
    finishing: 'Finishing the restore…',
    finishingMessage:
      'Stash restarts by itself now. If it doesn’t: Restore isn’t finished yet. Close and reopen Stash to complete it.',
    cleaningUp: 'Putting your data back in order…',
    chooseFile: 'Choose backup file',
    chooseAnother: 'Choose another file',
    fileChosen: 'Backup file chosen.',
    restore: 'Restore',
    replaceTitle: 'Replace all data?',
    replace: 'Replace',
  },

  backupErrors: {
    PASSWORD_INVALID:
      'The password contains a character that can’t be used. Type it again.',
    PASSWORD_CHARACTER:
      'The password contains a character that can’t be used, such as a control or formatting character.',
    PASSWORD_LENGTH: 'The password must be 10 to 256 characters long.',
    PASSWORD_MISMATCH: 'The two passwords don’t match.',
    BACKUP_PASSWORD_OR_HEADER:
      'The password is wrong, or this isn’t a Stash backup file.',
    BACKUP_CORRUPT:
      'The backup file is damaged or incomplete. It can’t be used.',
    BACKUP_INCONSISTENT:
      'The backup file’s contents don’t match each other. It can’t be used.',
    BACKUP_UNSUPPORTED:
      'This backup was made by a different version of Stash and can’t be used here.',
    BACKUP_TOO_LARGE: 'The backup file is too large to use.',
    BACKUP_INSUFFICIENT_MEMORY:
      'There isn’t enough free memory right now. Close other apps and try again.',
    INSUFFICIENT_SPACE:
      'There isn’t enough free storage on this device. Free up some space and try again.',
    DESTINATION_NOT_EMPTY:
      'The chosen file isn’t empty. Choose a new file name instead.',
    DESTINATION_UNVERIFIED:
      'Stash couldn’t verify the backup in that location. Choose a folder on this device’s own storage instead (in the file picker’s menu, the device’s name), then copy the backup wherever you like.',
    KEY_UNAVAILABLE:
      'Your attached files can’t be read with this device’s key. Nothing was changed.',
    NO_ACTIVITY: 'Stash needs to be open in the foreground to choose a file.',
    BUSY: 'A file picker is already open.',
    PICKER_UNAVAILABLE: 'No app is available to choose a file.',
    BACKUP_CHANGED:
      'The backup file changed since it was checked. Choose it again and retry.',
    RESTORE_UNAVAILABLE:
      'Restoring isn’t possible: the encryption key on this device is missing or no longer valid. Nothing was changed.',
    RESTORE_STATE_UNKNOWN:
      'An earlier restore left files Stash can’t account for, so it won’t start another one. Nothing was changed.',
    RESTORE_IN_PROGRESS: 'A restore is already in progress.',
    RESTORE_CANCELLED: 'The restore was cancelled. Nothing was changed.',
    RESTORE_RECOVERY_RETRY:
      'The restore was stopped, but Stash couldn’t finish putting your data back in order. Try again.',
    STORAGE_ERROR:
      'Stash couldn’t read your attached files. Nothing was changed.',
    generic: 'Something went wrong. Nothing was changed.',
    /** BACKUP_ATTACHMENT_UNREADABLE names the item and file. */
    attachment: (
      fileName: string | null,
      itemTitle: string | null,
      reason: 'MISSING' | 'DAMAGED' | 'MISMATCH' | null,
    ) => {
      const what = fileName ? `The file “${fileName}”` : 'An attached file';
      const where = itemTitle ? ` in “${itemTitle}”` : '';
      const why =
        reason === 'MISSING'
          ? 'is missing'
          : reason === 'DAMAGED'
          ? 'is damaged'
          : reason === 'MISMATCH'
          ? 'doesn’t match its record'
          : 'can’t be read';
      return `${what}${where} ${why}. Open the item, remove or replace the file, then back up again.`;
    },
    destinationRemains:
      'An incomplete file may remain where you saved it; delete it there.',
  },

  storageError: {
    keepInstalled:
      'Please don’t uninstall Stash: that would permanently erase your data.',
    keyTitle: 'Stash can’t unlock your data',
    keyMessage:
      'The encryption key that protects your data on this device is missing or no longer valid. Nothing has been deleted.',
    newerTitle: 'Update Stash to continue',
    newerMessage:
      'Your data was saved by a newer version of Stash. Install the latest version to open it. Nothing has been changed.',
    corruptTitle: 'Your data couldn’t be opened',
    corruptMessage:
      'The data file appears to be damaged or doesn’t match its key. Nothing has been deleted.',
    genericTitle: 'Stash couldn’t open your data',
    genericMessage:
      'Something went wrong while opening secure storage. Nothing has been deleted.',
    migrationTitle: 'Stash couldn’t finish updating',
    migrationMessage:
      'Your data couldn’t be upgraded to this version, so it was left exactly as it was.',
    restoreUnfinishedTitle: 'The restore isn’t finished yet',
    restoreVerifyMessage:
      'Stash couldn’t check the restored data just now. Your data from before the restore is kept until it can.',
    restoreRetryMessage:
      'A step of the restore couldn’t be completed. Nothing has been lost; trying again continues where it stopped.',
    restoreUnknownTitle: 'An unfinished restore needs attention',
    restoreUnknownMessage:
      'Stash found restore files it can’t account for. To protect your data, nothing is changed automatically.',
    restoreKeyTitle: 'Stash can’t finish the restore',
    restoreKeyMessage:
      'The encryption key on this device is missing or no longer valid. All restore files are kept.',
    wipeTitle: 'Deleting your data didn’t finish',
    wipeMessage:
      'Some files couldn’t be removed yet. Try again to complete it; nothing is shown until it has.',
    restoreRunningTitle: 'A restore is still running',
    restoreRunningMessage: 'Wait a moment, then try again.',
    tryAgain: 'Try again',
    restore: 'Restore from a backup',
    restoreUnavailable:
      'Restoring a backup isn’t possible on this device while its key is missing or invalid (RESTORE_UNAVAILABLE).',
    cancelRestore: 'Cancel restore and return to previous data',
    cancelTitle: 'Cancel restore?',
    cancelMessage:
      'The restored data will be discarded and Stash returns to the data you had before the restore.',
    returnToPrevious: 'Return to previous data',
    errorCode: (code: string) => `Error code: ${code}`,
  },

  reminders: {
    permissionTitle: 'Allow reminder notifications?',
    permissionMessage:
      'Stash uses notifications to remind you at the time you set. Reminder details stay hidden unless you choose to show them in Settings.',
    continue: 'Continue',
    notNow: 'Not now',
    exactTitle: 'Deliver reminders on time?',
    exactMessage:
      'Without this, Android may delay reminders to save battery, and some phones hold them until you open Stash. Allow “Alarms & reminders” for Stash on the next screen.',
    openSettings: 'Open settings',
  },

  lock: {
    locked: 'Stash is locked',
    unlockHint: 'Unlock with your fingerprint, face or screen lock.',
    unlock: 'Unlock',
    noCredential:
      'This device no longer has a fingerprint, face or screen lock set up, so Stash can’t confirm it’s you. Set a screen lock in Android settings, or turn App Lock off.',
    turnOff: 'Turn off App Lock',
    lockout:
      'Too many attempts. Wait a moment, then try again, or use your screen lock.',
    unavailable:
      'No fingerprint, face or screen lock is set up on this device.',
    failed: 'Stash couldn’t confirm it’s you. Try again.',
    confirmDeleteAll: 'Delete all data',
  },
};

export type Strings = typeof en;
