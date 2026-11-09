# Installation reference illustration refinement

The 9 November 2026 owner request was to make the installation references closer to the five supplied source images. The reusable SVG renderer in `src/sheets/install-reference-illustrations.mjs` replaces the generic silhouettes with source-shaped linework: hatched ceiling and wall sections, the TVA fitting bracket and grille profile, flanged Q mounting-set bodies, AeroFresh service panels and port faces, condensate drains, and the AF300 overhead duct break.

The source dimension endpoints and values remain the same. Unknown Q drain allowance and all AF300 assembly dimensions stay blank, with explicit notes. No electrical terminals, cable ratings or wiring specification have been inferred. The source screenshots remain outside the repository. These pictorial references do not change model geometry, quantities, clearance requirements, equipment selection or installation approval.

The existing A3 reference band is retained. The illustrations are separate from the card layout so they can be reused in a dedicated detail sheet after the owner chooses that layout. No additional detail panels or insulation specification have been added to a plan.

Verification uses the full repository checks, build and `scripts/browser-plan-details.mjs`. That script checks the real PDF renderer, vector text, A3 landscape/portrait and A4 page sizes, and text bounds in the five-reference stress layout in both orientations. Its synthetic fixtures are not a real design validation.
