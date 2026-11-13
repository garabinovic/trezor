import type { Strings } from './en';

// Spanish (neutral, informal "tú" as usual in apps).

const pad = (n: number) => String(n).padStart(2, '0');

const plural = (n: number, one: string, other: string) =>
  `${n} ${n === 1 ? one : other}`;

const monthsShort = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];
const monthsLong = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const weekdays = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];
/** "todos los lunes", "todos los sábados". */
const everyWeekday = [
  'todos los domingos',
  'todos los lunes',
  'todos los martes',
  'todos los miércoles',
  'todos los jueves',
  'todos los viernes',
  'todos los sábados',
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const es: Strings = {
  common: {
    back: 'Atrás',
    cancel: 'Cancelar',
    close: 'Cerrar',
    save: 'Guardar',
    done: 'Listo',
    edit: 'Editar',
    delete: 'Eliminar',
    remove: 'Quitar',
    replace: 'Reemplazar',
    tryAgain: 'Reintentar',
    ok: 'Aceptar',
    notSet: 'Sin definir',
    search: 'Buscar',
    settings: 'Ajustes',
    clearSearch: 'Borrar búsqueda',
    closeDialog: 'Cerrar diálogo',
    clear: (label: string) => `Borrar “${label}”`,
    position: (index: number, count: number) => `${index} de ${count}`,
  },

  numbers: {
    decimal: ',',
    group: '.',
    kb: 'KB',
    mb: 'MB',
  },

  native: {
    reminderBody: 'Tienes un recordatorio.',
    channelName: 'Recordatorios',
    channelDescription: 'Recordatorios que creaste en Trezor',
    unlockTitle: 'Desbloquear Trezor',
    confirmSubtitle: 'Confirma que eres tú',
    appLockOnTitle: 'Activar el bloqueo de la app',
    appLockOffTitle: 'Desactivar el bloqueo de la app',
  },

  dates: {
    monthsShort,
    monthsLong,
    weekdays,
    weekdaysShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
    dayMonth: (day: number, month: number) => `${day} ${monthsShort[month]}`,
    dayMonthYear: (day: number, month: number, year: number) =>
      `${day} ${monthsShort[month]} ${year}`,
    longDate: (weekday: number, day: number, month: number) =>
      `${capitalize(weekdays[weekday])}, ${day} de ${monthsLong[month]}`,
    time: (hours: number, minutes: number) => `${pad(hours)}:${pad(minutes)}`,
    dayAndTime: (day: string, time: string) => `${day}, ${time}`,
    today: 'Hoy',
    tomorrow: 'Mañana',
    yesterday: 'Ayer',
    justNow: 'Ahora mismo',
    minutesAgo: (n: number) => `hace ${n} min`,
    hoursAgo: (n: number) => `hace ${n} h`,
    editedJustNow: 'Editado ahora mismo',
    editedYesterday: 'Editado ayer',
    edited: (when: string) => `Editado ${when}`,
  },

  tabs: {
    home: 'Inicio',
    notes: 'Notas',
    reminders: 'Recordatorios',
    cards: 'Tarjetas',
    documents: 'Docs',
    documentsAccessibility: 'Documentos, pestaña',
  },

  categories: {
    note: {
      singular: 'Nota',
      plural: 'Notas',
      emptyTitle: 'Aún no hay notas',
      emptyMessage: 'Apunta ideas, listas y todo lo que quieras recordar.',
      newTitle: 'Nueva nota',
      editTitle: 'Editar nota',
      add: 'Añadir nota',
      deleteTitle: '¿Eliminar la nota?',
      discardMessage: 'Los cambios en esta nota no se guardarán.',
      filterLabel: 'Filtrar notas',
      description: 'Texto, listas e ideas',
      starter: 'Escribe una nota',
    },
    reminder: {
      singular: 'Recordatorio',
      plural: 'Recordatorios',
      emptyTitle: 'Aún no hay recordatorios',
      emptyMessage:
        'Añade recordatorios para renovaciones, citas y pequeñas tareas.',
      newTitle: 'Nuevo recordatorio',
      editTitle: 'Editar recordatorio',
      add: 'Añadir recordatorio',
      deleteTitle: '¿Eliminar el recordatorio?',
      discardMessage: 'Los cambios en este recordatorio no se guardarán.',
      filterLabel: 'Filtrar recordatorios',
      description: 'Algo que hacer a una hora concreta',
      starter: 'Añade un recordatorio',
    },
    card: {
      singular: 'Tarjeta',
      plural: 'Tarjetas',
      emptyTitle: 'Aún no hay tarjetas',
      emptyMessage:
        'Ten a mano en la caja tus tarjetas de fidelidad y de socio.',
      newTitle: 'Nueva tarjeta',
      editTitle: 'Editar tarjeta',
      add: 'Añadir tarjeta',
      deleteTitle: '¿Eliminar la tarjeta?',
      discardMessage: 'Los cambios en esta tarjeta no se guardarán.',
      filterLabel: 'Filtrar tarjetas',
      description: 'Tarjeta de fidelidad o de socio',
      starter: 'Añade una tarjeta de fidelidad',
    },
    document: {
      singular: 'Documento',
      plural: 'Documentos',
      emptyTitle: 'Aún no hay documentos',
      emptyMessage:
        'Guarda tickets, garantías y papeles importantes en un solo lugar.',
      newTitle: 'Nuevo documento',
      editTitle: 'Editar documento',
      add: 'Añadir documento',
      deleteTitle: '¿Eliminar el documento?',
      discardMessage: 'Los cambios en este documento no se guardarán.',
      filterLabel: 'Filtrar documentos',
      description: 'Ticket, garantía o archivo',
      starter: 'Guarda un ticket o una garantía',
    },
  },

  documentKinds: {
    receipt: 'Ticket',
    warranty: 'Garantía',
    image: 'Imagen',
    document: 'Archivo',
  },

  filters: {
    all: 'Todo',
    upcoming: 'Pendientes',
    done: 'Hechos',
    upcomingEmpty: 'Lo tienes todo al día.',
    doneEmpty: 'Aquí aparecerán los recordatorios completados.',
    receipts: 'Tickets',
    warranties: 'Garantías',
    images: 'Imágenes',
    files: 'Archivos',
    receiptsEmpty: 'No hay tickets guardados.',
    warrantiesEmpty: 'No hay garantías guardadas.',
    imagesEmpty: 'No hay imágenes guardadas.',
    filesEmpty: 'No hay archivos guardados.',
    nothingHere: 'No hay nada aquí',
  },

  counts: {
    items: (n: number) => plural(n, 'elemento', 'elementos'),
    upcoming: (n: number) => plural(n, 'pendiente', 'pendientes'),
    nothingDue: 'Nada pendiente',
  },

  repeat: {
    once: 'No se repite',
    daily: 'Cada día',
    weekly: 'Cada semana',
    monthly: 'Cada mes',
    yearly: 'Cada año',
    interval: 'A intervalos',
    everyHours: (hours: number) =>
      hours === 1 ? 'Cada hora' : `Cada ${hours} horas`,
    everyMinutes: (minutes: number) => `Cada ${minutes} minutos`,
  },

  home: {
    title: 'Trezor',
    searchPlaceholder: 'Buscar en todo',
    countAccessibility: (category: string, count: number) =>
      `${category}, ${count}`,
    comingUp: 'Próximamente',
    seeAll: 'Ver todo',
    pinned: 'Fijados',
    recent: 'Actualizados recientemente',
    welcomeTitle: 'Te damos la bienvenida a Trezor',
    welcomeMessage:
      'Guarda notas, recordatorios, tarjetas de fidelidad y documentos importantes juntos, en un único lugar privado.',
    welcomePrivacy:
      'Todo se queda en este dispositivo. Sin cuenta, sin anuncios, sin nube.',
    getStarted: 'Para empezar',
    addNew: 'Añadir',
  },

  search: {
    placeholder: 'Buscar en todo',
    idleTitle: 'Buscar en todo',
    idleMessage:
      'Encuentra notas, recordatorios, tarjetas y documentos por título o contenido.',
    errorTitle: 'La búsqueda no está disponible',
    errorMessage:
      'Ahora mismo no se pueden buscar tus elementos. Vuelve a intentarlo.',
    noResults: 'Sin resultados',
    noMatch: (query: string) => `Nada coincide con “${query}”.`,
  },

  items: {
    overdue: (summary: string) => `Vencido · ${summary}`,
    markDone: 'Marcar como hecho',
    markNotDone: 'Marcar como no hecho',
    writeErrorTitle: 'No se pudo guardar el cambio',
    writeErrorMessage:
      'Tu último cambio no se guardó. La lista muestra ahora lo que hay guardado en este dispositivo. Vuelve a intentarlo.',
  },

  detail: {
    notFoundTitle: 'Elemento no encontrado',
    notFoundMessage: 'Puede que se haya eliminado.',
    pin: 'Fijar en Inicio',
    unpin: 'Dejar de fijar',
    pinnedSuffix: ' · Fijado',
    deleteMessage: (title: string) =>
      `“${title}” se eliminará de forma permanente.`,
    notes: 'Notas',
    due: 'Vence',
    next: 'Próximo',
    repeat: 'Repetición',
    cardFront: 'Anverso',
    cardBack: 'Reverso',
    openFrontPhoto: 'Abrir foto del anverso',
    openBackPhoto: 'Abrir foto del reverso',
    frontPhoto: 'Foto del anverso de la tarjeta',
    backPhoto: 'Foto del reverso de la tarjeta',
    cardNumberCaption: 'Número de tarjeta · Sin código de barras',
    issuer: 'Emisor',
    cardholder: 'Titular',
    attachment: 'Adjunto',
    attachments: 'Adjuntos',
    details: 'Detalles',
    storeOrIssuer: 'Tienda o emisor',
    purchaseDate: 'Fecha de compra',
    issueDate: 'Fecha de emisión',
    warrantyEnded: 'Garantía terminada',
    warrantyUntil: 'Garantía hasta',
    expired: 'Caducó',
    expiresOn: 'Caduca',
    amount: 'Importe',
  },

  summary: {
    expired: (date: string) => `Caducó el ${date}`,
    until: (date: string) => `Hasta el ${date}`,
    expires: (date: string) => `Caduca el ${date}`,
  },

  attachmentTypes: {
    jpeg: 'Imagen JPEG',
    png: 'Imagen PNG',
    webp: 'Imagen WebP',
    heic: 'Imagen HEIC',
    heif: 'Imagen HEIF',
    pdf: 'PDF',
    file: 'Archivo',
  },

  editor: {
    discardTitle: '¿Descartar los cambios?',
    discard: 'Descartar',
    keepEditing: 'Seguir editando',
    optional: 'Opcional',
    title: 'Título',
    note: 'Nota',
    notes: 'Notas',
    noteTitlePlaceholder: 'p. ej., Ideas de regalos',
    noteBodyPlaceholder: 'Escribe lo que quieras guardar',
    reminderTitlePlaceholder: 'p. ej., Renovar el seguro del coche',
    date: 'Fecha',
    time: 'Hora',
    repeat: 'Repetir',
    every: 'Cada',
    interval: 'Intervalo',
    repeatOptions: {
      once: 'Una vez',
      daily: 'Diario',
      weekly: 'Semanal',
      monthly: 'Mensual',
      yearly: 'Anual',
      interval: 'Intervalo',
    },
    hours: (n: number) => (n === 1 ? '1 hora' : `${n} horas`),
    hint: {
      once: 'Avisa una vez a esta hora.',
      daily: (time: string) => `Avisa cada día a las ${time}.`,
      weekly: (weekday: number, time: string) =>
        `Avisa ${everyWeekday[weekday]} a las ${time}.`,
      monthly: (day: number, time: string) =>
        `Avisa el día ${day} de cada mes a las ${time}.`,
      monthlyShort: ' En los meses más cortos, el último día.',
      yearly: (date: string, time: string) =>
        `Avisa cada año el ${date} a las ${time}.`,
      leapDay: ' Los demás años, el 28 de febrero.',
      interval: (every: string) =>
        `Avisa ${every.toLowerCase()}, a partir de la fecha y la hora indicadas arriba.`,
    },
    batteryNote:
      'Los avisos pueden llegar tarde porque Android ahorra batería. Permite “Alarmas y recordatorios” en Ajustes para que lleguen a tiempo.',
    cardName: 'Nombre de la tarjeta',
    cardNamePlaceholder: 'p. ej., Greenleaf Rewards',
    issuer: 'Emisor',
    issuerPlaceholder: 'Tienda o programa, opcional',
    cardNumber: 'Número de tarjeta',
    cardNumberPlaceholder: 'Tal como aparece en la tarjeta',
    cardNumberHelper:
      'Escanear una tarjeta con la cámara llegará en una versión posterior.',
    cardholder: 'Titular',
    cardPhotos: 'Fotos de la tarjeta',
    front: 'Anverso',
    back: 'Reverso',
    frontPhoto: 'Foto del anverso de la tarjeta',
    backPhoto: 'Foto del reverso de la tarjeta',
    addFront: 'Añadir anverso',
    addBack: 'Añadir reverso',
    addFrontPhoto: 'Añadir foto del anverso',
    addBackPhoto: 'Añadir foto del reverso',
    replaceFrontPhoto: 'Reemplazar foto del anverso',
    replaceBackPhoto: 'Reemplazar foto del reverso',
    removeFrontPhoto: 'Quitar foto del anverso',
    removeBackPhoto: 'Quitar foto del reverso',
    addingPhoto: 'Añadiendo foto…',
    photosNote:
      'Opcional. Las fotos están cifradas y se quedan en este dispositivo.',
    type: 'Tipo',
    documentType: 'Tipo de documento',
    purchaseTitlePlaceholder: 'p. ej., Lavadora',
    documentTitlePlaceholder: 'p. ej., Contrato de alquiler',
    storeOrIssuer: 'Tienda o emisor',
    purchaseDate: 'Fecha de compra',
    issueDate: 'Fecha de emisión',
    warrantyUntil: 'Garantía hasta',
    expiresOn: 'Caduca el',
    amount: 'Importe',
    currency: 'Moneda',
    attachments: 'Adjuntos',
    fileOptions: (fileName: string) => `Opciones de ${fileName}`,
    addPhotos: 'Añadir fotos',
    addFiles: 'Añadir archivos',
    addingFiles: 'Añadiendo archivos…',
    attachmentsNote: (max: number) =>
      `Fotos o PDF, hasta ${max} archivos de 25 MB cada uno. Los archivos están cifrados y se quedan en este dispositivo.`,
    attachmentsFull: (max: number) =>
      `${max} de ${max} archivos adjuntos. Quita uno para añadir otro.`,
    moveUp: 'Subir',
    moveDown: 'Bajar',
    replace: 'Reemplazar',
    remove: 'Quitar',
    replaceSubtitle: 'Elige otra foto u otro PDF',
    validation: {
      cardName: 'Escribe el nombre de la tarjeta.',
      title: 'Escribe un título.',
      futureTime: 'Elige una hora futura.',
      interval: 'Elige cada cuánto se repite.',
      cardNumber: 'Escribe el número de la tarjeta.',
      tooManyAttachments: (max: number, extra: number) =>
        `Un documento puede tener como máximo ${max} adjuntos. Quita ${extra}.`,
      amount: 'Escribe un importe válido, p. ej., 24,90',
      warrantyEnd:
        'El fin de la garantía debe ser posterior a la fecha de compra.',
      expiry: 'La caducidad debe ser posterior a la fecha de emisión.',
    },
    importFailure: {
      tooLarge: (name: string) => `“${name}” ocupa más de 25 MB.`,
      unsupportedPhoto: (name: string) =>
        `“${name}” no es una foto compatible. Usa JPEG, PNG, WebP o HEIC.`,
      unsupportedFile: (name: string) =>
        `“${name}” no es compatible. Usa una foto (JPEG, PNG, WebP, HEIC) o un PDF.`,
      readFailed: (name: string) => `No se pudo leer “${name}”.`,
      importFailed: (name: string) =>
        `No se pudo guardar “${name}”. Vuelve a intentarlo.`,
    },
    pickError: {
      photosKeyUnavailable:
        'No se pueden añadir fotos: la clave de cifrado no está disponible.',
      filesKeyUnavailable:
        'No se pueden añadir archivos: la clave de cifrado no está disponible.',
      noPhotoPicker: 'Este dispositivo no tiene un selector de fotos.',
      noFilePicker: 'Este dispositivo no tiene un selector de archivos.',
      photoFailed: 'No se pudo añadir la foto. Vuelve a intentarlo.',
      fileFailed: 'No se pudo añadir el archivo. Vuelve a intentarlo.',
    },
    skipped: (skipped: number, limit: number) =>
      `${
        skipped === 1
          ? '1 archivo no se añadió'
          : `${skipped} archivos no se añadieron`
      }: un documento puede tener como máximo ${limit} adjuntos.`,
  },

  viewer: {
    frontOfCard: 'Anverso de la tarjeta',
    backOfCard: 'Reverso de la tarjeta',
    previousFile: 'Archivo anterior',
    nextFile: 'Archivo siguiente',
    page: (index: number, count: number) => `Página ${index} de ${count}`,
    opening: 'Abriendo…',
    saveCopy: 'Guardar una copia',
    share: 'Compartir',
    copySaved: 'Copia guardada.',
    notFoundTitle: 'Archivo no encontrado',
    notFoundMessage: 'Puede que se haya quitado.',
    zoomHint: 'Pellizca o toca dos veces para hacer zoom',
    pageUnavailable: 'Esta página no se puede mostrar',
    problems: {
      missingTitle: 'Falta el archivo',
      missingMessage:
        'Su copia cifrada ya no está en este dispositivo. Puedes quitarlo o reemplazarlo al editar.',
      damagedTitle: 'El archivo está dañado',
      damagedMessage:
        'No coincide con el archivo que se guardó, así que no se muestra. Puedes quitarlo o reemplazarlo al editar.',
      cantOpenTitle: 'No se puede abrir el archivo',
      keyMessage: 'Su clave de cifrado no está disponible en este dispositivo.',
      passwordTitle: 'El PDF está protegido con contraseña',
      passwordMessage: 'Trezor no puede abrir PDF que piden contraseña.',
      pdfTitle: 'No se puede mostrar el PDF',
      pdfMessage: 'Android no puede mostrar este PDF.',
      imageTitle: 'No se puede mostrar la imagen',
      imageMessage:
        'Este formato de imagen no es compatible con esta versión de Android.',
      genericMessage: 'Algo salió mal. Vuelve a intentarlo.',
    },
    photoProblems: {
      missing: 'Falta el archivo de la foto',
      damaged: 'El archivo de la foto está dañado',
      unsupported: 'Esta foto no se puede mostrar en este dispositivo',
      failed: 'Ahora no se puede mostrar la foto',
    },
    saveErrors: {
      missingSaved: 'Falta el archivo y no se puede guardar.',
      missingShared: 'Falta el archivo y no se puede compartir.',
      damagedSaved: 'El archivo está dañado y no se puede guardar.',
      damagedShared: 'El archivo está dañado y no se puede compartir.',
      keySaved:
        'El archivo no se puede guardar: su clave de cifrado no está disponible.',
      keyShared:
        'El archivo no se puede compartir: su clave de cifrado no está disponible.',
      notEmpty:
        'Ese archivo ya existe y no se ha modificado. Elige otro nombre.',
      unverified:
        'Esta ubicación no puede confirmar que el archivo sea nuevo, así que no se guardó nada. Puede quedar allí un archivo vacío. Elige otra ubicación.',
      failed: 'No se pudo guardar la copia. Se eliminó la copia incompleta.',
      incomplete:
        'No se pudo guardar la copia. Puede quedar un archivo incompleto donde elegiste guardarla.',
      noSaver: 'Ninguna app de este dispositivo puede guardar archivos.',
      noReceiver: 'Ninguna app de este dispositivo puede recibir este archivo.',
      genericSaved: 'No se pudo guardar el archivo. Vuelve a intentarlo.',
      genericShared: 'No se pudo compartir el archivo. Vuelve a intentarlo.',
    },
  },

  settings: {
    title: 'Ajustes',
    appearance: 'Apariencia',
    theme: 'Tema',
    themeSystem: 'Sistema',
    themeLight: 'Claro',
    themeDark: 'Oscuro',
    language: 'Idioma',
    notificationPrivacy: 'Privacidad de las notificaciones',
    scheduleFailed:
      'Ahora no se pudieron programar los recordatorios. Trezor lo volverá a intentar automáticamente.',
    androidSettingsApply:
      'Siempre se aplican los ajustes de notificaciones y de pantalla de bloqueo de Android.',
    showDetails: 'Mostrar detalles',
    showDetailsSubtitle:
      'Permite que los títulos y descripciones de los recordatorios aparezcan en las notificaciones.',
    notificationsOff: 'Las notificaciones están desactivadas',
    notificationsOffSubtitle:
      'Actívalas en los ajustes de Android para recibir los recordatorios.',
    remindersLate: 'Los recordatorios pueden llegar tarde',
    remindersLateSubtitle:
      'Permite “Alarmas y recordatorios” en los ajustes de Android para que lleguen a tiempo.',
    security: 'Seguridad',
    appLockFooter:
      'El bloqueo de la app oculta Trezor cada vez que sales de ella, hasta que la desbloqueas con tu huella, tu cara o el bloqueo de pantalla. Tus datos están cifrados en cualquier caso.',
    appLock: 'Bloqueo de la app',
    appLockSubtitle: 'Pedir huella, cara o bloqueo de pantalla',
    appLockNeedsScreenLock:
      'Primero configura un bloqueo de pantalla en los ajustes de Android',
    data: 'Datos',
    dataFooter:
      'Trezor guarda todo en este dispositivo. No hay cuenta ni sincronización en la nube. Una copia de seguridad es un archivo que guardas tú, cifrado con su propia contraseña.',
    backup: 'Hacer una copia de seguridad',
    backupSubtitle: 'Todo, cifrado con la contraseña que elijas',
    checkBackup: 'Comprobar una copia',
    checkBackupSubtitle: 'Verifica un archivo de copia sin cambiar nada',
    restore: 'Restaurar una copia',
    restoreSubtitle: 'Reemplaza todos los datos de este dispositivo',
    deleteAll: 'Eliminar todos los datos',
    deleteAllSubtitle:
      'Todo lo de este dispositivo; los archivos de copia se conservan',
    deleteAllTitle: '¿Eliminar todos los datos?',
    deleteAllMessage:
      'Todas las notas, recordatorios, tarjetas, documentos y archivos adjuntos de este dispositivo se eliminarán de forma permanente y Trezor empezará vacío. Las copias de seguridad que guardaste fuera de Trezor no se ven afectadas. No se puede deshacer.',
    deleteEverything: 'Eliminar todo',
    backUpFirst: 'Hacer copia antes',
    deleting: 'Eliminando…',
    deleteRestoreInProgress:
      'Hay una restauración en curso. No se eliminó nada.',
    deleteFailed: 'No se eliminó nada. Vuelve a intentarlo.',
    preview: 'Vista previa',
    previewFooter:
      'Solo en versiones de desarrollo. Los datos de ejemplo se guardan en memoria y nunca se mezclan con tus elementos guardados.',
    sampleData: 'Mostrar datos de ejemplo',
    sampleDataSubtitle: 'Desactívalo para ver la primera ejecución',
    about: 'Acerca de',
    version: 'Versión',
    aboutTitle: 'Acerca de Trezor',
    aboutParagraphs: [
      'Trezor es un organizador personal sencillo, pensado para ayudarte a tener en un solo lugar las cosas importantes de tu vida.',
      'Guarda tus notas, recordatorios, tarjetas de fidelidad y documentos, y mantén tu información ordenada y a mano.',
      'Trezor está hecho pensando en la privacidad y la sencillez. Tus datos se guardan localmente en tu dispositivo, protegidos con cifrado, y siguen bajo tu control. Puedes crear una copia de seguridad cifrada para proteger tus datos cuando cambies o restablezcas tu dispositivo.',
      'Nuestro objetivo es sencillo: un espacio útil y fiable para tu información personal, sin complicaciones innecesarias.',
    ],
    feedbackTitle: 'Opiniones y sugerencias',
    feedbackParagraphs: [
      '¿Tienes una idea para mejorar Trezor?',
      'Nos encantará saber de ti. Si tienes una sugerencia, encontraste un problema o simplemente quieres contarnos tu experiencia, escríbenos.',
    ],
    email: 'Correo: ',
    emailAccessibility: (address: string) => `Escribir a ${address}`,
    noEmailApp: 'No hay ninguna app de correo configurada en este dispositivo.',
  },

  backup: {
    title: 'Copia de seguridad',
    intro:
      'El archivo de copia contiene todas tus notas, recordatorios, tarjetas, documentos y archivos adjuntos, cifrados con la contraseña que elijas aquí. Trezor no puede recuperar una contraseña olvidada.',
    password: 'Contraseña de la copia',
    passwordHelper: 'De 10 a 256 caracteres.',
    repeatPassword: 'Repite la contraseña',
    showPassword: 'Mostrar contraseña',
    hidePassword: 'Ocultar contraseña',
    chooseDestination: 'Elegir dónde guardar',
    running: 'Haciendo la copia…',
    runningMessage:
      'Tus datos se están escribiendo y después se comprobarán. Mantén Trezor abierto hasta que termine.',
    keepOpen: 'Mantén Trezor abierto hasta que termine.',
    savedTitle: 'Copia guardada y verificada',
    savedMessage: (size: string) =>
      `El archivo de copia (${size}) se volvió a leer y se comprobó. Guárdalo en un lugar seguro junto con su contraseña: sin ella no se puede restaurar.`,
    incompleteTitle: 'Puede quedar un archivo de copia incompleto',
    incompleteMessage: (fileName: string) =>
      `Una copia no terminó y Trezor no pudo eliminar su archivo “${fileName}”. Elimínalo donde lo guardaste; no se puede restaurar.`,
    fileName: (date: string) => `Copia de Trezor ${date}.tzbk`,
  },

  check: {
    title: 'Comprobar una copia',
    intro:
      'Comprueba que un archivo de copia está completo y que su contraseña es correcta. No se cambia nada en este dispositivo.',
    chooseFile: 'Elegir archivo de copia',
    running: 'Comprobando la copia…',
    validTitle: 'La copia está completa',
    validMessage: (attachments: number) =>
      `Cada parte del archivo se descifró y se verificó${
        attachments > 0
          ? `, incluidos ${plural(
              attachments,
              'archivo adjunto',
              'archivos adjuntos',
            )}`
          : ''
      }. Se puede restaurar con esta contraseña. No se cambió nada en este dispositivo.`,
  },

  restore: {
    title: 'Restaurar',
    warning:
      'Todo lo que hay en Trezor en este dispositivo se reemplazará por el contenido de la copia: tus notas, recordatorios, tarjetas, documentos y archivos adjuntos actuales. No se puede deshacer.',
    noDataFile:
      'No hay ningún archivo de datos en este dispositivo sobre el que restaurar. Vuelve a intentarlo en su lugar.',
    stopped: 'La restauración se detuvo. Tus datos están como antes.',
    preparing: 'Preparando…',
    preparingMessage: 'Comprobando si se puede restaurar.',
    restoring: 'Restaurando…',
    restoringMessage:
      'La copia se está leyendo y comprobando. Mantén Trezor abierto hasta que termine.',
    sharingTitle: 'Aún se está compartiendo un archivo',
    sharingMessage:
      'Trezor está pasando un archivo a otra app. Espera a que termine o cancela la restauración.',
    checkAgain: 'Volver a comprobar',
    cancelRestore: 'Cancelar la restauración',
    finishing: 'Terminando la restauración…',
    finishingMessage:
      'Trezor se reinicia solo ahora. Si no lo hace, la restauración aún no ha terminado: cierra y vuelve a abrir Trezor para completarla.',
    cleaningUp: 'Poniendo tus datos en orden…',
    chooseFile: 'Elegir archivo de copia',
    chooseAnother: 'Elegir otro archivo',
    fileChosen: 'Archivo de copia elegido.',
    restore: 'Restaurar',
    replaceTitle: '¿Reemplazar todos los datos?',
    replace: 'Reemplazar',
  },

  backupErrors: {
    PASSWORD_INVALID:
      'La contraseña contiene un carácter que no se puede usar. Vuelve a escribirla.',
    PASSWORD_CHARACTER:
      'La contraseña contiene un carácter que no se puede usar, como un carácter de control o de formato.',
    PASSWORD_LENGTH: 'La contraseña debe tener entre 10 y 256 caracteres.',
    PASSWORD_MISMATCH: 'Las dos contraseñas no coinciden.',
    BACKUP_PASSWORD_OR_HEADER:
      'La contraseña es incorrecta o este no es un archivo de copia de Trezor.',
    BACKUP_CORRUPT:
      'El archivo de copia está dañado o incompleto. No se puede usar.',
    BACKUP_INCONSISTENT:
      'El contenido del archivo de copia no es coherente. No se puede usar.',
    BACKUP_UNSUPPORTED:
      'Esta copia se hizo con otra versión de Trezor y no se puede usar aquí.',
    BACKUP_TOO_LARGE: 'El archivo de copia es demasiado grande.',
    BACKUP_INSUFFICIENT_MEMORY:
      'Ahora no hay suficiente memoria libre. Cierra otras apps y vuelve a intentarlo.',
    INSUFFICIENT_SPACE:
      'No hay suficiente espacio libre en este dispositivo. Libera algo de espacio y vuelve a intentarlo.',
    DESTINATION_NOT_EMPTY:
      'El archivo elegido no está vacío. Elige un nombre de archivo nuevo.',
    DESTINATION_UNVERIFIED:
      'Trezor no pudo verificar la copia en esa ubicación. Elige una carpeta del almacenamiento propio del dispositivo (en el menú del selector de archivos, el nombre del dispositivo) y después copia la copia de seguridad donde quieras.',
    KEY_UNAVAILABLE:
      'Tus archivos adjuntos no se pueden leer con la clave de este dispositivo. No se cambió nada.',
    NO_ACTIVITY:
      'Trezor debe estar abierto en primer plano para elegir un archivo.',
    BUSY: 'Ya hay un selector de archivos abierto.',
    PICKER_UNAVAILABLE: 'No hay ninguna app para elegir un archivo.',
    BACKUP_CHANGED:
      'El archivo de copia cambió después de comprobarlo. Vuelve a elegirlo e inténtalo de nuevo.',
    RESTORE_UNAVAILABLE:
      'No se puede restaurar: la clave de cifrado de este dispositivo falta o ya no es válida. No se cambió nada.',
    RESTORE_STATE_UNKNOWN:
      'Una restauración anterior dejó archivos que Trezor no puede explicar, así que no empezará otra. No se cambió nada.',
    RESTORE_IN_PROGRESS: 'Ya hay una restauración en curso.',
    RESTORE_CANCELLED: 'La restauración se canceló. No se cambió nada.',
    RESTORE_RECOVERY_RETRY:
      'La restauración se detuvo, pero Trezor no pudo terminar de poner tus datos en orden. Vuelve a intentarlo.',
    STORAGE_ERROR:
      'Trezor no pudo leer tus archivos adjuntos. No se cambió nada.',
    generic: 'Algo salió mal. No se cambió nada.',
    attachment: (
      fileName: string | null,
      itemTitle: string | null,
      reason: 'MISSING' | 'DAMAGED' | 'MISMATCH' | null,
    ) => {
      const what = fileName ? `El archivo “${fileName}”` : 'Un archivo adjunto';
      const where = itemTitle ? ` de “${itemTitle}”` : '';
      const why =
        reason === 'MISSING'
          ? 'falta'
          : reason === 'DAMAGED'
          ? 'está dañado'
          : reason === 'MISMATCH'
          ? 'no coincide con su registro'
          : 'no se puede leer';
      return `${what}${where} ${why}. Abre el elemento, quita o reemplaza el archivo y vuelve a hacer la copia.`;
    },
    destinationRemains:
      'Puede quedar un archivo incompleto donde lo guardaste; elimínalo allí.',
  },

  storageError: {
    keepInstalled:
      'No desinstales Trezor: borrarías tus datos de forma permanente.',
    keyTitle: 'Trezor no puede desbloquear tus datos',
    keyMessage:
      'La clave de cifrado que protege tus datos en este dispositivo falta o ya no es válida. No se ha eliminado nada.',
    newerTitle: 'Actualiza Trezor para continuar',
    newerMessage:
      'Tus datos los guardó una versión más reciente de Trezor. Instala la última versión para abrirlos. No se ha cambiado nada.',
    corruptTitle: 'No se pudieron abrir tus datos',
    corruptMessage:
      'El archivo de datos parece estar dañado o no coincide con su clave. No se ha eliminado nada.',
    genericTitle: 'Trezor no pudo abrir tus datos',
    genericMessage:
      'Algo salió mal al abrir el almacenamiento seguro. No se ha eliminado nada.',
    migrationTitle: 'Trezor no pudo terminar de actualizarse',
    migrationMessage:
      'Tus datos no se pudieron adaptar a esta versión, así que se dejaron exactamente como estaban.',
    restoreUnfinishedTitle: 'La restauración aún no ha terminado',
    restoreVerifyMessage:
      'Trezor no pudo comprobar ahora los datos restaurados. Tus datos de antes de la restauración se conservan hasta que pueda hacerlo.',
    restoreRetryMessage:
      'No se pudo completar un paso de la restauración. No se ha perdido nada; al reintentar se continúa donde se quedó.',
    restoreUnknownTitle: 'Una restauración sin terminar requiere atención',
    restoreUnknownMessage:
      'Trezor encontró archivos de restauración que no puede explicar. Para proteger tus datos, no se cambia nada automáticamente.',
    restoreKeyTitle: 'Trezor no puede terminar la restauración',
    restoreKeyMessage:
      'La clave de cifrado de este dispositivo falta o ya no es válida. Se conservan todos los archivos de restauración.',
    wipeTitle: 'La eliminación de tus datos no terminó',
    wipeMessage:
      'Aún no se han podido quitar algunos archivos. Reinténtalo para completarla; no se mostrará nada hasta entonces.',
    restoreRunningTitle: 'Una restauración sigue en curso',
    restoreRunningMessage: 'Espera un momento y vuelve a intentarlo.',
    tryAgain: 'Reintentar',
    restore: 'Restaurar una copia',
    restoreUnavailable:
      'No se puede restaurar una copia en este dispositivo mientras su clave falte o no sea válida (RESTORE_UNAVAILABLE).',
    cancelRestore: 'Cancelar la restauración y volver a los datos anteriores',
    cancelTitle: '¿Cancelar la restauración?',
    cancelMessage:
      'Los datos restaurados se descartarán y Trezor volverá a los datos que tenías antes de la restauración.',
    returnToPrevious: 'Volver a los datos anteriores',
    errorCode: (code: string) => `Código de error: ${code}`,
  },

  reminders: {
    permissionTitle: '¿Permitir notificaciones de recordatorios?',
    permissionMessage:
      'Trezor usa notificaciones para avisarte a la hora que elijas. Los detalles de los recordatorios permanecen ocultos salvo que decidas mostrarlos en Ajustes.',
    continue: 'Continuar',
    notNow: 'Ahora no',
    exactTitle: '¿Entregar los recordatorios a tiempo?',
    exactMessage:
      'Sin esto, Android puede retrasar los recordatorios para ahorrar batería y algunos teléfonos los retienen hasta que abres Trezor. En la siguiente pantalla, permite “Alarmas y recordatorios” para Trezor.',
    openSettings: 'Abrir ajustes',
  },

  lock: {
    locked: 'Trezor está bloqueado',
    unlockHint: 'Desbloquea con tu huella, tu cara o el bloqueo de pantalla.',
    unlock: 'Desbloquear',
    noCredential:
      'Este dispositivo ya no tiene configurada una huella, cara ni bloqueo de pantalla, así que Trezor no puede confirmar que eres tú. Configura un bloqueo de pantalla en los ajustes de Android o desactiva el bloqueo de la app.',
    turnOff: 'Desactivar el bloqueo de la app',
    lockout:
      'Demasiados intentos. Espera un momento y vuelve a intentarlo, o usa el bloqueo de pantalla.',
    unavailable:
      'Este dispositivo no tiene configurada una huella, cara ni bloqueo de pantalla.',
    failed: 'Trezor no pudo confirmar que eres tú. Vuelve a intentarlo.',
    confirmDeleteAll: 'Eliminar todos los datos',
  },
};
