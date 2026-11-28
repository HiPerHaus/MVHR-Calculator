// Manufacturer articles, not verified Fantech ordering codes or local stock.
export const LINEA_SERIES = Object.freeze({
  400: Object.freeze({ size: 400, faceLengthMm: 436, faceWidthMm: 76, faceArticle: "990321791", housingArticle: "990321745", feedCount: 1, filterArticle: "990321768",
    faceSource: "https://www.zehnder.co.uk/en/productsceletons/comfogrid-csb-design-line/slot-diffuser-comfogrid-linea-400-for-csb-p-400-white",
    housingSource: "https://www.zehnder.nl/nl/ventilatie/luchtverdeelsysteem/ventielen-en-roosters/zehnder-comfocase-csb-p/roosterbox-lijnrooster-type-csb/p-2dn75/dn90-b-l410" }),
  600: Object.freeze({ size: 600, faceLengthMm: 636, faceWidthMm: 76, faceArticle: "990321794", housingArticle: "990321746", feedCount: 2, filterArticle: "990321769",
    faceSource: "https://www.zehnder.co.uk/en/productsceletons/comfogrid-csb-design-line/slot-diffuser-comfogrid-linea-600-for-csb-p-600-white",
    housingSource: "https://www.zehnder.nl/nl/ventilatie/luchtverdeelsysteem/ventielen-en-roosters/zehnder-comfocase-csb-p/roosterbox-lijnrooster-type-csb/p-2dn90-dn110-b-610-1" }),
});

export function lineaRecordId(size, stream) {
  return `zehnder-linea-${size}-${stream}`;
}

export function lineaPlacementSize(shape) {
  return shape === "linea-400" ? 400 : shape === "linea-600" ? 600 : null;
}
