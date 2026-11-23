// Use coordinates from the same rendered PDF page for both dimensions.
export function checkedPlanScale(dimensions, relativeTolerance) {
  if (dimensions.length < 2 || !Number.isFinite(relativeTolerance) || relativeTolerance < 0 || relativeTolerance >= 1) {
    throw new Error("Supply two printed dimensions and a scale tolerance.");
  }
  const scales = dimensions.map(({start, end, metres}) => {
    const pixels = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(pixels) || pixels <= 0 || !Number.isFinite(metres) || metres <= 0) {
      throw new Error("Check the dimension endpoints and length.");
    }
    return metres / pixels;
  });
  const metresPerPixel = scales[0];
  if (scales.some(scale => Math.abs(scale / metresPerPixel - 1) > relativeTolerance)) {
    throw new Error("The dimensions disagree on scale.");
  }
  return metresPerPixel;
}
