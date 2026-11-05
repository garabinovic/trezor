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
) {

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
  }
}
