/** Pick black or white text, whichever is easier to read on the given "#rrggbb" background. */
export function readableTextColor(hex) {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  // Perceived brightness: the eye is most sensitive to green, least to blue.
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 150 ? '#111827' : '#ffffff';
}
