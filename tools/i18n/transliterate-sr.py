#!/usr/bin/env python3
"""Generates src/i18n/sr-Cyrl.ts from src/i18n/sr-Latn.ts.

Serbian Latin and Cyrillic map one to one (lj, nj, dž are single Cyrillic
letters), so the Cyrillic dictionary is generated rather than kept by hand.
Only text inside string and template literals is transliterated: code, import
paths and interpolated expressions are copied as they are (strings nested in
an interpolation are text again). All-caps tokens (MISSING, PDF,
RESTORE_UNAVAILABLE) and the names in KEEP stay Latin.

    python3 tools/i18n/transliterate-sr.py      # then: npx prettier --write src/i18n/sr-Cyrl.ts
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src/i18n/sr-Latn.ts"
TARGET = ROOT / "src/i18n/sr-Cyrl.ts"

# Brand and format names that stay in Latin script.
KEEP = {"WebP", "Greenleaf", "Rewards", "tzbk"}

DIGRAPHS = {
    "lj": "љ", "Lj": "Љ", "LJ": "Љ",
    "nj": "њ", "Nj": "Њ", "NJ": "Њ",
    "dž": "џ", "Dž": "Џ", "DŽ": "Џ",
}
LETTERS = dict(
    zip(
        "abcčćdđefghijklmnoprsštuvzžô",
        "абцчћдђефгхијклмнопрсштувзжо",
    )
)
LETTERS.update({k.upper(): v.upper() for k, v in LETTERS.items() if k != "ô"})

WORD = re.compile(r"[A-Za-zČĆĐŠŽčćđšžô]+")


def word(w: str) -> str:
    if w in KEEP or re.fullmatch(r"[A-Z0-9_]{2,}", w):
        return w
    out, i = [], 0
    while i < len(w):
        pair = w[i : i + 2]
        if pair in DIGRAPHS:
            out.append(DIGRAPHS[pair])
            i += 2
        else:
            out.append(LETTERS.get(w[i], w[i]))
            i += 1
    return "".join(out)


def text(s: str) -> str:
    return WORD.sub(lambda m: word(m.group(0)), s)


class Converter:
    def __init__(self, src: str):
        self.s = src
        self.i = 0
        self.out: list[str] = []

    def emit(self, chunk: str) -> None:
        self.out.append(chunk)

    def code(self, until_brace: bool = False) -> None:
        depth = 0
        s = self.s
        while self.i < len(s):
            c = s[self.i]
            if s.startswith("//", self.i):
                end = s.find("\n", self.i)
                end = len(s) if end < 0 else end
                self.emit(s[self.i : end])
                self.i = end
            elif s.startswith("/*", self.i):
                end = s.index("*/", self.i) + 2
                self.emit(s[self.i : end])
                self.i = end
            elif c in "'\"":
                self.string(c)
            elif c == "`":
                self.template()
            elif c == "{":
                depth += 1
                self.emit(c)
                self.i += 1
            elif c == "}":
                if until_brace and depth == 0:
                    return
                depth -= 1
                self.emit(c)
                self.i += 1
            else:
                self.emit(c)
                self.i += 1

    def string(self, quote: str) -> None:
        s = self.s
        start = self.i
        self.i += 1
        buf = []
        while s[self.i] != quote:
            if s[self.i] == "\\":
                buf.append(s[self.i : self.i + 2])
                self.i += 2
            else:
                buf.append(s[self.i])
                self.i += 1
        self.i += 1
        content = "".join(buf)
        line_start = s.rfind("\n", 0, start) + 1
        is_import = s[line_start:start].lstrip().startswith(("import", "} from", "from"))
        self.emit(quote + (content if is_import else text(content)) + quote)

    def template(self) -> None:
        s = self.s
        self.emit("`")
        self.i += 1
        buf = []
        while s[self.i] != "`":
            if s[self.i] == "\\":
                buf.append(s[self.i : self.i + 2])
                self.i += 2
            elif s.startswith("${", self.i):
                self.emit(text("".join(buf)))
                buf = []
                self.emit("${")
                self.i += 2
                self.code(until_brace=True)
                self.emit("}")
                self.i += 1
            else:
                buf.append(s[self.i])
                self.i += 1
        self.emit(text("".join(buf)) + "`")
        self.i += 1


def main() -> int:
    src = SOURCE.read_text(encoding="utf-8")
    header, body = src.split("export const srLatn", 1)
    converter = Converter("export const srCyrl" + body)
    converter.code()
    helpers_start = header.index("const pad")
    imports = header[: header.index("// Serbian")]
    helpers = Converter(header[helpers_start:])
    helpers.code()
    result = (
        imports
        + "// Serbian, Cyrillic script. GENERATED from sr-Latn.ts by\n"
        + "// tools/i18n/transliterate-sr.py: don't edit by hand.\n\n"
        + "".join(helpers.out)
        + "".join(converter.out)
    )
    TARGET.write_text(result, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
