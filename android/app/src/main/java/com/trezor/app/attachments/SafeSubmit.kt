package com.trezor.app.attachments

import java.util.concurrent.Executor
import java.util.concurrent.RejectedExecutionException

/**
 * Hands work to an executor that may already be shut down (the native module after
 * `invalidate()`). Exactly one of [task] or [onRejected] runs, so a caller that settles its
 * promise in both always settles it once.
 *
 * The executor's own refusal is the signal, not a separate "shut down?" flag checked
 * beforehand, so a shutdown that races with the submission is handled too. Only
 * [RejectedExecutionException] is caught; any other failure propagates.
 */
object SafeSubmit {
  fun submit(executor: Executor, onRejected: () -> Unit, task: () -> Unit) {
    val accepted =
        try {
          executor.execute(task)
          true
        } catch (e: RejectedExecutionException) {
          false
        }
    if (!accepted) onRejected()
  }
}
