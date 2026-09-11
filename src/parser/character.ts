/** Returns whether a string consists only of XML whitespace characters. */
export const isXmlWhitespace = (value: string) => {
  for (const character of value) {
    if (character !== " " && character !== "\t" && character !== "\n" && character !== "\r") {
      return false;
    }
  }
  return true;
};

/** Returns whether a Unicode code point is permitted by XML 1.0 Fifth Edition. */
export const isXml10Char = (codePoint: number) =>
  codePoint === 0x9 ||
  codePoint === 0xa ||
  codePoint === 0xd ||
  (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0x10ffff);

/** Returns whether a Unicode code point is an XML 1.0 NameStartChar. */
export const isXml10NameStart = (codePoint: number) =>
  codePoint === 0x3a ||
  codePoint === 0x5f ||
  (codePoint >= 0x41 && codePoint <= 0x5a) ||
  (codePoint >= 0x61 && codePoint <= 0x7a) ||
  (codePoint >= 0xc0 && codePoint <= 0xd6) ||
  (codePoint >= 0xd8 && codePoint <= 0xf6) ||
  (codePoint >= 0xf8 && codePoint <= 0x2ff) ||
  (codePoint >= 0x370 && codePoint <= 0x37d) ||
  (codePoint >= 0x37f && codePoint <= 0x1fff) ||
  (codePoint >= 0x200c && codePoint <= 0x200d) ||
  (codePoint >= 0x2070 && codePoint <= 0x218f) ||
  (codePoint >= 0x2c00 && codePoint <= 0x2fef) ||
  (codePoint >= 0x3001 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xf900 && codePoint <= 0xfdcf) ||
  (codePoint >= 0xfdf0 && codePoint <= 0xfffd) ||
  (codePoint >= 0x10000 && codePoint <= 0xeffff);

/** Returns whether a Unicode code point is an XML 1.0 NameChar. */
export const isXml10NameChar = (codePoint: number) =>
  isXml10NameStart(codePoint) ||
  codePoint === 0x2d ||
  codePoint === 0x2e ||
  codePoint === 0xb7 ||
  (codePoint >= 0x30 && codePoint <= 0x39) ||
  (codePoint >= 0x300 && codePoint <= 0x36f) ||
  (codePoint >= 0x203f && codePoint <= 0x2040);

/** Returns whether a string is a non-colonized XML 1.0 name. */
export const isNcName = (value: string) => {
  let first = true;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint === 0x3a ||
      (first ? !isXml10NameStart(codePoint) : !isXml10NameChar(codePoint))
    ) {
      return false;
    }
    first = false;
  }
  return !first;
};
