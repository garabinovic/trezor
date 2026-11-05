package com.trezor.app.attachments

import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The attachment module's background work, on two single-thread lanes: [Lane.WORKER]
 * (imports, deletes, views, export, share and cleanup never overlap) and [Lane.RENDERER]
 * (PDF pages, so scrolling isn't held up by an import). The module owns no executor of its
 * own, so every task goes through [submit].
 *
 * [submit] always settles through [submit]'s `reject` when the task can't: a lane that has
 * shut down refuses the task ([SafeSubmit]), and anything the task throws, including an
 * [Error] such as [OutOfMemoryError], rejects with IO_FAILED instead of escaping to the
 * thread's uncaught-exception handler (which would kill the process and leave the promise
 * unsettled). React Native ignores a second settlement, so a task that already settled
 * and then threw stays settled once.
 *
 * For an [OutOfMemoryError] this, and the cleanup the attachment classes attempt on an
 * [Error], is best effort: the rejection and the cleanup need memory too and may fail
 * themselves, other threads (the React Native bridge or JS runtime included) can fail on
 * the same shortage, and the process may still be killed. Nothing here claims the app
 * recovers from running out of memory; it only avoids turning a failure this code could
 * report into a certain crash with the promise left unsettled.
 */
class ModuleTasks(
    private val worker: ExecutorService = Executors.newSingleThreadExecutor(),
    private val renderer: ExecutorService = Executors.newSingleThreadExecutor(),
) {

  enum class Lane {
    WORKER,
    RENDERER,
  }

  private val shutDown = AtomicBoolean(false)

  fun submit(lane: Lane, reject: (code: String, message: String) -> Unit, task: () -> Unit) =
      SafeSubmit.submit(
          if (lane == Lane.WORKER) worker else renderer,
          onRejected = { reject("IO_FAILED", "Attachment service is not available") },
      ) {
        try {
          task()
        } catch (e: Throwable) {
          reject("IO_FAILED", "Attachment operation failed")
        }
      }

  /**
   * Stops both lanes, once: a second call does nothing and returns false. [last] runs on
   * the renderer after pages still rendering (inline if the renderer already refuses).
   * Work already accepted still runs and settles; new work is refused.
   */
  fun shutdown(last: () -> Unit): Boolean {
    if (!shutDown.compareAndSet(false, true)) return false
    SafeSubmit.submit(renderer, onRejected = last, task = last)
    renderer.shutdown()
    worker.shutdown()
    return true
  }
}
