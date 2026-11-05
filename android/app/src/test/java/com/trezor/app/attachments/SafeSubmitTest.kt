package com.trezor.app.attachments

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Promise settlement around executor shutdown (ModuleTasks after invalidate). */
class SafeSubmitTest {

  /** Stands in for a promise: counts how often it was settled, and how. */
  private class Settled {
    val resolved = AtomicInteger()
    val rejected = AtomicInteger()
    val total get() = resolved.get() + rejected.get()
  }

  private fun submit(executor: Executor, settled: Settled) =
      SafeSubmit.submit(executor, onRejected = { settled.rejected.incrementAndGet() }) {
        settled.resolved.incrementAndGet()
      }

  @Test
  fun workSubmittedBeforeShutdownRunsAndSettlesOnce() {
    val executor = Executors.newSingleThreadExecutor()
    val settled = Settled()
    submit(executor, settled)
    executor.shutdown()
    assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
    assertEquals(1, settled.resolved.get())
    assertEquals(0, settled.rejected.get())
  }

  @Test
  fun workSubmittedAfterShutdownIsRejectedOnceWithoutRunning() {
    val executor = Executors.newSingleThreadExecutor()
    executor.shutdown()
    val settled = Settled()
    submit(executor, settled)
    assertEquals(0, settled.resolved.get())
    assertEquals(1, settled.rejected.get())
  }

  @Test
  fun acceptedWorkStillSettlesWhenShutdownComesWhileItWaits() {
    val executor = Executors.newSingleThreadExecutor()
    val gate = CountDownLatch(1)
    executor.execute { gate.await() } // keeps the next task queued
    val settled = Settled()
    submit(executor, settled)
    executor.shutdown() // not shutdownNow: queued work is kept
    gate.countDown()
    assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
    assertEquals(1, settled.resolved.get())
    assertEquals(0, settled.rejected.get())
  }

  @Test
  fun aShutdownRacingWithSubmissionsSettlesEveryOneExactlyOnce() {
    repeat(20) {
      val executor = Executors.newFixedThreadPool(2)
      val calls = List(200) { Settled() }
      val start = CountDownLatch(1)
      val submitters =
          (0 until 4).map { t ->
            Thread {
              start.await()
              for (i in t until calls.size step 4) submit(executor, calls[i])
            }
          }
      submitters.forEach(Thread::start)
      start.countDown()
      Thread.sleep(1)
      executor.shutdown() // while submissions are still coming in
      submitters.forEach { it.join(5_000) }
      assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
      calls.forEachIndexed { i, c -> assertEquals("call $i", 1, c.total) }
    }
  }

  @Test
  fun otherExecutorFailuresAreNotSwallowed() {
    val broken = Executor { throw IllegalStateException("broken") }
    val settled = Settled()
    try {
      submit(broken, settled)
      fail("an unrelated failure must propagate")
    } catch (e: IllegalStateException) {
      // expected
    }
    assertEquals(0, settled.total)
  }
}
