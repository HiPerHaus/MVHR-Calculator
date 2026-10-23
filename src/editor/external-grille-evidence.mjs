export const EXTERNAL_GRILLE_EVIDENCE = Object.freeze({
  single: {
    sourceId:"zehnder-external-wall-grille-TS093", revision:"Z-SI-V0220-CSY-TES-TS093", pages:[2,3],
    variants:{125:{manufacturerArticle:"990430250",widthMm:267,heightMm:248,overallDepthMm:73},160:{manufacturerArticle:"990430584",widthMm:280,heightMm:281,overallDepthMm:73}},
    note:"37 mm connector projection shown. Nominal size is not verified EPP mating geometry.",
  },
  combined: {
    sourceId:"zehnder-combined-external-wall-grille-TS096",revision:"Z-SI-V0220-CSY-TES-TS096",pages:[2,3],
    variants:{125:{rightArticle:"990430591",leftArticle:"990430592",drawingWidthMm:400,drawingHeightMm:224,portPitchMm:164},160:{rightArticle:"990430594",leftArticle:"990430595",drawingWidthMm:590,drawingHeightMm:299,portPitchMm:280.5}},
    orientationDefinition:"Outdoor air connection on left/right in manufacturer front view",
    unresolved:"DN160 page 2 H/W labels reverse the page 3 drawing dimensions. Do not promote to physical plan setout until resolved. Generic combined drawing remains available.",
  },
});
