package com.trezor.app.attachments

import java.util.concurrent.atomic.AtomicBoolean

/**
 * Attachment storage cleanup around opening the database.
 *
 * - [beforeDatabaseCreated]: the database file is missing and is about to be created. Any
 *   `.tza` file that exists now may be all that is left of a missing original database
 *   (still decryptable with the existing key), so its id is recorded durably with
 *   [AttachmentStore.keepUnreferenced] **before** the new database exists. A crash
 *   afterwards can't expose those files to a later [atStartup]. On a genuine first launch
 *   there are no files and nothing is written.
 * - [atModuleStart]: removes decrypted view copies (whole attachments, PDF copies, rendered
 *   pages) left by an earlier process, **without the database**, at most once per process
 *   ([viewsDone]). The module runs it as its first task, so no view of this process can
 *   exist yet; files handed out are kept anyway ([AttachmentViews.purgeInactive]). It runs
 *   even when the database can't be opened, so a killed process's plaintext copies don't
 *   wait for a launch that succeeds. Expired share copies (older than
 *   [ShareFiles.RETENTION_MS]) go too, for the same reason; active and recent shares are
 *   kept ([ShareFiles.purgeExpired]). Encrypted files are not touched.
 * - [atStartup]: removes view copies, expired shares, unfinished imports and `.tza` files
 *   no database row refers to (except kept ones), **at most once per process** ([done] is
 *   process-wide in production). Removing files without a row is only safe while no import
 *   awaits its row; a second React root (the Activity recreated while the process and the
 *   JS runtime live on) must not run it while the first tree may still be saving freshly
 *   imported files. Expired shares are purged on every call: active and recent shares are
 *   always kept.
 */
class AttachmentCleanup(
    private val store: AttachmentStore,
    private val views: AttachmentViews,
    private val shares: ShareFiles,
    private val done: AtomicBoolean = PROCESS_DONE,
    private val viewsDone: AtomicBoolean = PROCESS_VIEWS_DONE,
) {

  /** View files and expired shares removed, or null when this already ran in this process. */
  fun atModuleStart(): Int? {
    if (!viewsDone.compareAndSet(false, true)) return null
    return views.purgeInactive() + shares.purgeExpired()
  }

  /** Returns how many ids are kept. Throws [AttachmentStore.StoreException]. */
  fun beforeDatabaseCreated(): Int = store.keepUnreferenced(emptySet())

  /** Files removed, or null when cleanup already ran in this process. */
  fun atStartup(knownIds: Set<String>): Int? {
    shares.purgeExpired()
    // Claimed before any work: a failure is retried by the next process, never by a
    // later root of this one.
    if (!done.compareAndSet(false, true)) return null
    views.purge()
    return store.collectGarbage(knownIds)
  }

  companion object {
    private val PROCESS_DONE = AtomicBoolean(false)
    private val PROCESS_VIEWS_DONE = AtomicBoolean(false)
  }
}
