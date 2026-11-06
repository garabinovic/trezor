package com.trezor.app.backup

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * A strict RFC 8259 JSON parser for the backup manifest (spec §3.8). Android's org.json is
 * lenient (it accepts unquoted names, single quotes, comments and duplicate-free merges),
 * so it is not used here. On top of RFC 8259 this parser rejects:
 * - bytes that are not well-formed UTF-8, and a BOM;
 * - duplicate object keys;
 * - `\u` escapes that leave an unpaired surrogate;
 * - numbers that aren't non-negative integers without leading zeros, or exceed 2^53 − 1;
 * - nesting deeper than [maxDepth].
 *
 * Values: [Map] (insertion order), [List], [String], [Long], [Boolean], or [NULL].
 * Every failure is BACKUP_CORRUPT.
 */
internal class StrictJson private constructor(private val text: String, private val maxDepth: Int) {

  object NULL

  private var at = 0

  companion object {
    const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L

    fun parse(utf8: ByteArray, maxDepth: Int): Any {
      val text =
          try {
            Charsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(utf8))
                .toString()
          } catch (e: CharacterCodingException) {
            throw BackupFormatException(BackupFormatException.Code.BACKUP_CORRUPT, "Manifest is not UTF-8", e)
          }
      if (text.startsWith('﻿')) corrupt("Manifest starts with a BOM")
      val parser = StrictJson(text, maxDepth)
      parser.skipWhitespace()
      val value = parser.value(0)
      parser.skipWhitespace()
      if (parser.at != text.length) corrupt("Data after the manifest")
      return value
    }
  }

  private fun value(depth: Int): Any {
    if (depth > maxDepth) corrupt("Manifest nested too deeply")
    if (at >= text.length) corrupt("Manifest truncated")
    return when (val c = text[at]) {
      '{' -> obj(depth)
      '[' -> array(depth)
      '"' -> string()
      't' -> literal("true", true)
      'f' -> literal("false", false)
      'n' -> literal("null", NULL)
      else -> if (c in '0'..'9' || c == '-') number() else corrupt("Unexpected character")
    }
  }

  private fun obj(depth: Int): Map<String, Any> {
    at++
    val map = LinkedHashMap<String, Any>()
    skipWhitespace()
    if (peek() == '}') {
      at++
      return map
    }
    while (true) {
      skipWhitespace()
      if (peek() != '"') corrupt("Expected a key")
      val key = string()
      skipWhitespace()
      expect(':')
      skipWhitespace()
      if (map.containsKey(key)) corrupt("Duplicate key")
      map[key] = value(depth + 1)
      skipWhitespace()
      when (next()) {
        ',' -> continue
        '}' -> return map
        else -> corrupt("Expected , or }")
      }
    }
  }

  private fun array(depth: Int): List<Any> {
    at++
    val list = ArrayList<Any>()
    skipWhitespace()
    if (peek() == ']') {
      at++
      return list
    }
    while (true) {
      skipWhitespace()
      list += value(depth + 1)
      skipWhitespace()
      when (next()) {
        ',' -> continue
        ']' -> return list
        else -> corrupt("Expected , or ]")
      }
    }
  }

  private fun string(): String {
    expect('"')
    val sb = StringBuilder()
    while (true) {
      val c = next()
      when {
        c == '"' -> break
        c == '\\' ->
            when (next()) {
              '"' -> sb.append('"')
              '\\' -> sb.append('\\')
              '/' -> sb.append('/')
              'b' -> sb.append('\b')
              'f' -> sb.append('\u000C')
              'n' -> sb.append('\n')
              'r' -> sb.append('\r')
              't' -> sb.append('\t')
              'u' -> sb.append(hex4())
              else -> corrupt("Invalid escape")
            }
        c < ' ' -> corrupt("Unescaped control character")
        else -> sb.append(c)
      }
    }
    // Every surrogate must be half of a valid pair (escaped or not).
    var i = 0
    while (i < sb.length) {
      val ch = sb[i]
      if (Character.isHighSurrogate(ch)) {
        if (i + 1 >= sb.length || !Character.isLowSurrogate(sb[i + 1])) corrupt("Unpaired surrogate")
        i += 2
      } else {
        if (Character.isLowSurrogate(ch)) corrupt("Unpaired surrogate")
        i++
      }
    }
    return sb.toString()
  }

  private fun hex4(): Char {
    if (at + 4 > text.length) corrupt("Manifest truncated")
    var v = 0
    repeat(4) {
      val d = Character.digit(text[at++], 16)
      if (d < 0) corrupt("Invalid \\u escape")
      v = v * 16 + d
    }
    return v.toChar()
  }

  private fun number(): Long {
    val start = at
    if (text[at] == '-') corrupt("Negative numbers are not allowed")
    while (at < text.length && text[at] in '0'..'9') at++
    if (at < text.length && (text[at] == '.' || text[at] == 'e' || text[at] == 'E')) {
      corrupt("Only integers are allowed")
    }
    val digits = text.substring(start, at)
    if (digits.length > 1 && digits[0] == '0') corrupt("Leading zero")
    if (digits.length > 16) corrupt("Number too large")
    val v = digits.toLong()
    if (v > MAX_SAFE_INTEGER) corrupt("Number too large")
    return v
  }

  private fun literal(word: String, value: Any): Any {
    if (!text.startsWith(word, at)) corrupt("Invalid literal")
    at += word.length
    return value
  }

  private fun skipWhitespace() {
    while (at < text.length && text[at] in " \t\n\r") at++
  }

  private fun peek(): Char = if (at < text.length) text[at] else corrupt("Manifest truncated")

  private fun next(): Char = peek().also { at++ }

  private fun expect(c: Char) {
    if (next() != c) corrupt("Expected $c")
  }
}
