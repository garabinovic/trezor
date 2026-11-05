package com.trezor.app.attachments

import com.trezor.app.attachments.ModuleTasks.Lane
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** How the attachment module's tasks settle (review L3, and the shutdown rules). */
class ModuleTasksTest {

  /** A promise as React Native implements it: only the first settlement counts. */
  private class Promise {
    val settlements = mutableListOf<String>()
    @Volatile var settled: String? = null
    val done = CountDownLatch(1)

    @Synchronized
    fun settle(how: String) {
      settlements += how
      if (settled == null) {
        settled = how
        done.countDown()
      }
    }

    fun reject(code: String, message: String) = settle("reject:$code")

    fun await(): String? {
      done.await(5, TimeUnit.SECONDS)
      return settled
    }
  }

  private val worker = Executors.newSingleThreadExecutor()
  private val renderer = Executors.newSingleThreadExecutor()
  private val tasks = ModuleTasks(worker, renderer)

  private fun submit(lane: Lane, promise: Promise, task: () -> Unit) = tasks.submit(lane, promise::reject, task)

  @Test
  fun aTaskThatThrowsAnErrorRejectsItsPromiseAndTheLaneKeepsWorking() {
    for (lane in Lane.values()) {
      val failed = Promise()
      submit(lane, failed) { throw OutOfMemoryError("simulated") }
      assertEquals("reject:IO_FAILED", failed.await())

      val next = Promise()
      submit(lane, next) { next.settle("resolve") }
      assertEquals("resolve", next.await())
    }
  }

  @Test
  fun anExceptionThatEscapesATaskRejectsToo() {
    val promise = Promise()
    submit(Lane.WORKER, promise) { throw IllegalStateException("bug") }
    assertEquals("reject:IO_FAILED", promise.await())
  }

  @Test
  fun aTaskThatSettledAndThenThrewStaysSettledOnce() {
    val promise = Promise()
    submit(Lane.WORKER, promise) {
      promise.settle("resolve")
      throw OutOfMemoryError("simulated")
    }
    assertEquals("resolve", promise.await())
    worker.shutdown()
    assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS))
    // The extra rejection is offered, and ignored as React Native's promise does.
    assertEquals(listOf("resolve", "reject:IO_FAILED"), promise.settlements)
  }

  @Test
  fun afterShutdownNewTasksAreRejectedWithoutRunning() {
    assertTrue(tasks.shutdown {})
    val ran = AtomicInteger()
    for (lane in Lane.values()) {
      val promise = Promise()
      submit(lane, promise) { ran.incrementAndGet() }
      assertEquals("reject:IO_FAILED", promise.settled)
    }
    assertEquals(0, ran.get())
  }

  @Test
  fun shutdownRunsOnceAndAfterPagesStillRendering() {
    val gate = CountDownLatch(1)
    val order = mutableListOf<String>()
    val page = Promise()
    submit(Lane.RENDERER, page) {
      gate.await()
      synchronized(order) { order += "page" }
      page.settle("resolve")
    }
    val closes = AtomicInteger()
    assertTrue(tasks.shutdown { closes.incrementAndGet(); synchronized(order) { order += "closeAll" } })
    assertFalse("a second shutdown does nothing", tasks.shutdown { closes.incrementAndGet() })
    gate.countDown()
    assertTrue(renderer.awaitTermination(5, TimeUnit.SECONDS))
    assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS))
    assertEquals("resolve", page.settled)
    assertEquals(1, closes.get())
    assertEquals(listOf("page", "closeAll"), order)
  }

  @Test
  fun workAcceptedBeforeShutdownStillRunsAndSettles() {
    val gate = CountDownLatch(1)
    val first = Promise()
    val queued = Promise()
    submit(Lane.WORKER, first) { gate.await(); first.settle("resolve") }
    submit(Lane.WORKER, queued) { queued.settle("resolve") }
    tasks.shutdown {}
    gate.countDown()
    assertTrue(worker.awaitTermination(5, TimeUnit.SECONDS))
    assertEquals("resolve", first.settled)
    assertEquals("resolve", queued.settled)
  }
}
