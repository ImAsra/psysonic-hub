/** How far a range input is filled, as a CSS percentage. */
export function sliderFill(value: number, min: number, max: number): string {
  const ratio = max > min ? (value - min) / (max - min) : 0;
  return `${Math.min(100, Math.max(0, ratio * 100)) || 0}%`;
}
