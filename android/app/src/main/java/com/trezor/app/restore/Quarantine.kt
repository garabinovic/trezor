package com.trezor.app.restore

import com.trezor.app.attachments.AttachmentStore
import java.io.File

/**
 * Retained (kept) attachment files and their quarantine (Phase 6 spec v2.4 §8.2 step 7,
 * §9.2, L7, decision 6).
 *
 * The retained set comes from `L_att/kept-ids`:
 * - absent: nothing is retained;
 * - valid: the listed ids (an id without a file is skipped and counted);
 * - present but unreadable or damaged: **every** `.tza` file in `L_att` (fail closed);
 * - `L_att` itself can't be listed: `STORAGE_ERROR`, a pre-swap failure.
 *
 * Each retained file is hard-linked (or copied) to `N/quarantine/<restoreId>/<id>.tza`; the
 * original stays in `L_att` untouched. Quarantine has no automatic cleanup: only this
 * restore's pre-swap failure and its `rolledback` row delete `N/quarantine/<restoreId>/`.
 */
class Quarantine(private val layout: RestoreLayout, private val ops: RestoreFileOps) {

  class Retained(val ids: Set<String>, val failClosed: Boolean)

  class Outcome(val linked: Int, val copied: Int, val missing: Int, val failClosed: Boolean)

  fun retained(): Retained {
    val root = layout.liveAttachments
    if (!root.exists()) return Retained(emptySet(), false)
    val entries =
        (if (root.isDirectory) root.listFiles() else null)
            ?: throw RestoreException(RestoreException.STORAGE_ERROR, "Attachment directory can't be listed")
    // keptIds() reads only kept-ids; the key supplier is never called.
    val store = AttachmentStore(root) { throw IllegalStateException("No key needed") }
    return try {
      Retained(store.keptIds(), false)
    } catch (e: AttachmentStore.StoreException) {
      val all =
          entries
              .filter { it.isFile && it.name.endsWith(AttachmentStore.SUFFIX) }
              .map { it.name.removeSuffix(AttachmentStore.SUFFIX) }
              .filter(AttachmentStore.ID_PATTERN::matches)
              .toSet()
      Retained(all, true)
    }
  }

  /** Step 7: links or copies every retained file into this restore's quarantine. */
  fun preserve(restoreId: String): Outcome {
    val retained = retained()
    val target = layout.quarantine(restoreId)
    var linked = 0
    var copied = 0
    var missing = 0
    if (retained.ids.isNotEmpty()) {
      ops.mkdirDurable(layout.quarantineRoot)
      ops.mkdirDurable(target)
    }
    for (id in retained.ids.sorted()) {
      val src = File(layout.liveAttachments, "$id${AttachmentStore.SUFFIX}")
      if (!src.isFile) {
        missing++
        continue
      }
      if (ops.linkOrCopyDurable(src, File(target, "$id${AttachmentStore.SUFFIX}"))) linked++ else copied++
    }
    return Outcome(linked, copied, missing, retained.failClosed)
  }
}
