// api/ai/building-volume.js
// POST /api/ai/building-volume
//
// Reads a floor plan image/PDF with Claude Vision and extracts the internal
// airtightness-envelope geometry needed for blower-door volume calculation.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { rateLimit, applyRateLimit } from '../../lib/rate-limit.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MODEL = 'claude-sonnet-4-6';
const CLASSIFICATION_MODEL = 'claude-haiku-4-5-20251001';
const BUCKET = 'plan-uploads';
const MAX_SPACES = 80;
const MAX_PDF_CLASSIFY_PAGES = 24;
const MAX_PDF_ANALYSIS_PAGES = 12;
const PAGE_CLASSIFICATION_BATCH_SIZE = 4;
const PDF_RENDER_DPI = 144;
const PDF_MAX_IMAGE_EDGE = 2400;
const PDF_STANDARD_FONT_DATA_URL = new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).toString();
const limiter = rateLimit({ windowMs: 60_000, max: 8 });

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://hiper-studio.au');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

async function getUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  return error ? null : user;
}

function stripMarkdown(text) {
  return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

function extractJson(text) {
  const raw = stripMarkdown(text);
  try { return JSON.parse(raw); } catch (_) {}

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first === -1 || last <= first) throw new SyntaxError('No JSON object found in model response');
  return JSON.parse(raw.slice(first, last + 1));
}

async function repairAndParseJson(text, context) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 5000,
    temperature: 0,
    system: 'You repair malformed JSON. Return only valid JSON. Do not add markdown, commentary, or new information.',
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: `Repair this malformed JSON from ${context}. Preserve the same schema and values. Return only valid JSON.\n\n${String(text || '').slice(0, 30000)}`,
      }],
    }],
  });
  const repaired = message.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
  return extractJson(repaired);
}

async function parseModelJson(text, context) {
  try {
    return extractJson(text);
  } catch (err) {
    console.warn(`building-volume ${context} JSON parse failed; attempting repair:`, err.message);
    return repairAndParseJson(text, context);
  }
}

function clampNumber(value, min = 0, max = 9999) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

function cleanText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : fallback;
}

function normaliseSpace(space, index) {
  const area = clampNumber(space?.areaM2);
  const height = clampNumber(space?.heightM);
  const volume = clampNumber(space?.volumeM3 || area * height);
  return {
    id: cleanText(space?.id, `space-${index + 1}`).replace(/[^a-z0-9_-]/gi, '-').toLowerCase(),
    name: cleanText(space?.name, `Space ${index + 1}`),
    level: cleanText(space?.level, 'Unspecified level'),
    areaM2: area,
    heightM: height,
    volumeM3: volume,
    include: space?.include !== false,
    confidence: clampNumber(space?.confidence, 0, 1),
    heightSource: cleanText(space?.heightSource, space?.heightAssumed ? 'assumed default' : ''),
    heightMethod: cleanText(space?.heightMethod, 'single height'),
    heightAssumed: space?.heightAssumed === true,
    needsReview: space?.needsReview === true || space?.heightAssumed === true,
    warning: cleanText(space?.warning),
    evidence: cleanText(space?.evidence),
    heightZones: Array.isArray(space?.heightZones)
      ? space.heightZones.slice(0, 12).map(zone => ({
          areaM2: clampNumber(zone?.areaM2),
          heightM: clampNumber(zone?.heightM),
          volumeM3: clampNumber(zone?.volumeM3 || clampNumber(zone?.areaM2) * clampNumber(zone?.heightM)),
          evidence: cleanText(zone?.evidence),
        }))
      : [],
  };
}

function normaliseResult(parsed, airtightnessLayer) {
  const spaces = Array.isArray(parsed?.spaces)
    ? parsed.spaces.slice(0, MAX_SPACES).map(normaliseSpace)
    : [];

  const includedVolume = spaces
    .filter(space => space.include)
    .reduce((sum, space) => sum + space.volumeM3, 0);

  return {
    airtightnessLayer: cleanText(parsed?.airtightnessLayer, airtightnessLayer),
    totalVolumeM3: clampNumber(parsed?.totalVolumeM3 || includedVolume),
    totalAreaM2: clampNumber(parsed?.totalAreaM2 || spaces.filter(s => s.include).reduce((sum, s) => sum + s.areaM2, 0)),
    spaces,
    assumptions: Array.isArray(parsed?.assumptions) ? parsed.assumptions.map(a => cleanText(a)).filter(Boolean).slice(0, 12) : [],
    warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.map(w => cleanText(w)).filter(Boolean).slice(0, 12) : [],
    confidence: clampNumber(parsed?.confidence, 0, 1),
    model: MODEL,
  };
}

async function signedImageUrl(storagePath, userId) {
  if (typeof storagePath !== 'string' || !storagePath.startsWith(`${BUCKET}/volume/${userId}/`)) {
    throw new Error('storagePath must be a calculator upload owned by the current user');
  }

  const objectPath = storagePath.slice(`${BUCKET}/`.length);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 60 * 10);
  if (error || !data?.signedUrl) throw new Error('Could not create signed image URL');
  return data.signedUrl;
}

async function downloadOwnedStorageObject(storagePath, userId) {
  if (typeof storagePath !== 'string' || !storagePath.startsWith(`${BUCKET}/volume/${userId}/`)) {
    throw new Error('storagePath must be a calculator upload owned by the current user');
  }

  const objectPath = storagePath.slice(`${BUCKET}/`.length);
  const { data, error } = await supabase.storage.from(BUCKET).download(objectPath);
  if (error || !data) throw new Error(`Could not download uploaded file: ${error?.message ?? 'no file returned'}`);
  return Buffer.from(await data.arrayBuffer());
}

function normalisePageNumbers(pageNumbers, pageCount, maxPages) {
  if (!Array.isArray(pageNumbers) || !pageNumbers.length) {
    return Array.from({ length: Math.min(pageCount, maxPages) }, (_, i) => i + 1);
  }
  const unique = [...new Set(pageNumbers
    .map(n => Number(n))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= pageCount))];
  return unique.slice(0, maxPages);
}

async function renderPdfPagesToImageContent(storagePath, userId, options = {}) {
  const [pdfjs, pdfjsWorker, canvasApi, sharp] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    import('@napi-rs/canvas'),
    import('sharp').then(m => m.default),
  ]);
  globalThis.pdfjsWorker = pdfjsWorker;
  const pdfBuffer = await downloadOwnedStorageObject(storagePath, userId);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    disableWorker: true,
    useSystemFonts: true,
    standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
  }).promise;
  const pageCount = doc.numPages;
  const selectedPageNumbers = normalisePageNumbers(options.pageNumbers, pageCount, options.maxPages ?? MAX_PDF_ANALYSIS_PAGES);
  const content = [];
  const renderedPages = [];

  try {
    for (const pageNumber of selectedPageNumbers) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: (options.dpi ?? PDF_RENDER_DPI) / 72 });
      const canvas = canvasApi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      const pngBuffer = canvas.toBuffer('image/png');

      const widthPx = Math.ceil(viewport.width);
      const heightPx = Math.ceil(viewport.height);
      const maxImageEdge = options.maxImageEdge ?? PDF_MAX_IMAGE_EDGE;
      const jpegBuffer = await sharp(pngBuffer)
        .resize({
          width: widthPx >= heightPx ? maxImageEdge : null,
          height: heightPx > widthPx ? maxImageEdge : null,
          withoutEnlargement: true,
        })
        .jpeg({ quality: 86 })
        .toBuffer();

      page.cleanup();

      const pageContent = [
        { type: 'text', text: `PDF page ${pageNumber} of ${pageCount}` },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: jpegBuffer.toString('base64'),
          },
        },
      ];
      content.push(...pageContent);
      renderedPages.push({ pageNumber, content: pageContent });
    }
  } finally {
    await doc.destroy();
  }

  return {
    content,
    pageCount,
    analysedPageCount: renderedPages.length,
    renderedPages,
    truncated: !Array.isArray(options.pageNumbers) && pageCount > selectedPageNumbers.length,
  };
}

const PAGE_CLASSIFICATION_SYSTEM = `You classify architectural PDF pages for a blower-door building volume calculator.

Classify each page into exactly one pageType:
- floor_plan: room areas, room names, envelope boundary, level plans.
- ceiling_plan: reflected ceiling plan, ceiling plan, ceiling heights, bulkheads, raked/dropped ceilings.
- section: vertical section, wall heights, roof pitch, vaulted/raked ceiling geometry.
- elevation: external/internal elevation, wall heights, roof geometry.
- schedule_notes: schedules, room schedule, ceiling-height schedule, general notes/specifications.
- other: cover pages, legends, details not useful for volume.

Return only JSON:
{"pages":[{"pageNumber":1,"pageType":"floor_plan","selected":true,"confidence":0.86,"reason":"ground floor plan with room labels"}]}

Set selected=true for floor_plan, ceiling_plan, section, elevation, and schedule_notes when useful for volume.`;

function normaliseClassifiedPages(parsed, renderedPages) {
  const byPage = new Map((Array.isArray(parsed?.pages) ? parsed.pages : []).map(p => [Number(p.pageNumber), p]));
  const usefulTypes = new Set(['floor_plan', 'ceiling_plan', 'section', 'elevation', 'schedule_notes']);
  return renderedPages.map(({ pageNumber }) => {
    const p = byPage.get(pageNumber) ?? {};
    const rawType = typeof p.pageType === 'string' ? p.pageType : 'other';
    const pageType = usefulTypes.has(rawType) || rawType === 'other' ? rawType : 'other';
    return {
      pageNumber,
      pageType,
      selected: p.selected ?? usefulTypes.has(pageType),
      confidence: clampNumber(p.confidence, 0, 1),
      reason: cleanText(p.reason, 'No classification reason returned'),
    };
  });
}

function fallbackClassifiedPages(renderedPages, reason) {
  return renderedPages.map(({ pageNumber }) => ({
    pageNumber,
    pageType: 'other',
    selected: true,
    confidence: 0,
    reason: cleanText(reason, 'AI page classification returned malformed JSON; selected for manual review'),
  }));
}

async function classifyRenderedPageBatch(batch, promptPrefix = 'Classify') {
  const message = await anthropic.messages.create({
    model: CLASSIFICATION_MODEL,
    max_tokens: Math.max(1000, batch.length * 420),
    temperature: 0,
    system: PAGE_CLASSIFICATION_SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: `${promptPrefix} PDF pages ${batch.map(p => p.pageNumber).join(', ')} for building-volume calculation. Return JSON only. The pages array must contain commas between every page object.` },
        ...batch.flatMap(p => p.content),
      ],
    }],
  });

  const text = message.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
  const parsed = extractJson(text);
  return {
    pages: normaliseClassifiedPages(parsed, batch),
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}

async function classifyRenderedPagesSafely(batch) {
  try {
    return await classifyRenderedPageBatch(batch);
  } catch (batchErr) {
    console.warn(`building-volume PDF page batch classification parse failed for pages ${batch.map(p => p.pageNumber).join(', ')}:`, batchErr.message);
  }

  const pages = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const page of batch) {
    try {
      const result = await classifyRenderedPageBatch([page], 'Retry classification for');
      pages.push(...result.pages);
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
    } catch (pageErr) {
      console.warn(`building-volume PDF page classification fallback used for page ${page.pageNumber}:`, pageErr.message);
      pages.push(...fallbackClassifiedPages([page], 'AI page classification returned malformed JSON; selected for manual review'));
    }
  }

  return { pages, inputTokens, outputTokens };
}

async function classifyPdfPages(storagePath, userId) {
  const pdfMeta = await renderPdfPagesToImageContent(storagePath, userId, {
    maxPages: MAX_PDF_CLASSIFY_PAGES,
    dpi: 72,
    maxImageEdge: 1400,
  });

  const pages = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let i = 0; i < pdfMeta.renderedPages.length; i += PAGE_CLASSIFICATION_BATCH_SIZE) {
    const batch = pdfMeta.renderedPages.slice(i, i + PAGE_CLASSIFICATION_BATCH_SIZE);
    const result = await classifyRenderedPagesSafely(batch);
    pages.push(...result.pages);
    inputTokens += result.inputTokens;
    outputTokens += result.outputTokens;
  }

  return {
    pages,
    pdfPageCount: pdfMeta.pageCount,
    pdfClassifiedPageCount: pdfMeta.analysedPageCount,
    pdfTruncated: pdfMeta.truncated,
    inputTokens: inputTokens || null,
    outputTokens: outputTokens || null,
  };
}

const SYSTEM_PROMPT = `You are an architectural plan reader for blower-door airtightness testing.
Extract the internal building volume enclosed by the airtightness layer.

The airtightness layer is either:
- airtightness membrane, if specified by the user
- plasterboard, if specified by the user
- another user-described internal airtight boundary

Rules:
- Use internal dimensions at the airtightness layer, not external wall dimensions.
- Include all conditioned/interior spaces inside the airtight envelope.
- Exclude garages, carports, verandahs, balconies, alfresco areas, roof voids outside the air barrier, and unconditioned service voids unless clearly inside the airtight layer.
- Split the result into spaces or zones that the user can review.
- Calculate room volume as room area from floor plans multiplied by room height from ceiling plans, sections, elevations, schedules, or notes.
- Apply this strict height-source precedence. Do not choose lower-precedence evidence when higher-precedence evidence exists for the same room/zone:
  1. Room-specific ceiling height note.
  2. Reflected ceiling plan / ceiling plan.
  3. Section cut through that room/zone.
  4. Elevation / roof profile.
  5. General notes or schedule.
  6. User default height.
- For each space, state heightSource as one of: "room-specific note", "ceiling plan", "section", "elevation", "schedule/notes", or "default".
- For each space, state heightMethod as "single height", "split zones", "raked/vaulted", "dropped/bulkhead", or "assumed default".
- If a room has raked, vaulted, split-level, dropped, or bulkhead ceilings, divide it into heightZones and calculate weighted volume. Do not collapse complex ceilings to one height unless no zone evidence exists.
- If no room-specific height is found, use the supplied default height, set heightAssumed=true, set needsReview=true, reduce confidence, and add a room warning.
- Set needsReview=true when height is estimated from section/elevation, when complex ceiling zoning is approximate, or when source evidence conflicts.
- If dimensions are unclear, infer conservatively and mark confidence lower.

Return only valid JSON:
{
  "airtightnessLayer":"plasterboard",
  "totalAreaM2":123.4,
  "totalVolumeM3":320.8,
  "confidence":0.78,
  "spaces":[
    {"id":"ground-living","name":"Living / Kitchen","level":"Ground Floor","areaM2":45.2,"heightM":2.7,"heightSource":"ceiling plan","heightMethod":"split zones","heightAssumed":false,"needsReview":false,"heightZones":[{"areaM2":20.0,"heightM":2.4,"volumeM3":48.0,"evidence":"low side from Section A-A page 8"},{"areaM2":25.2,"heightM":3.4,"volumeM3":85.7,"evidence":"high side from Section A-A page 8"}],"volumeM3":133.7,"include":true,"confidence":0.82,"warning":"","evidence":"Floor plan page 2 boundary; ceiling plan page 5 raked note; section A-A page 8 heights"}
  ],
  "assumptions":["Ceiling height assumed as 2.7 m where not shown"],
  "warnings":["Scale bar not visible on first floor plan"]
}`;

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!applyRateLimit(req, res, { limiter })) return;

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const {
    storagePath,
    mimeType = 'image/png',
    airtightnessLayer = 'plasterboard',
    defaultHeightM = 2.7,
    notes = '',
    action = 'analyse',
    selectedPages = null,
    pageSelections = null,
  } = req.body ?? {};

  if (!storagePath) return res.status(400).json({ error: 'storagePath is required' });
  if (!ALLOWED_MIME.has(mimeType)) return res.status(400).json({ error: 'Only PDF, PNG, JPEG, and WebP plan files are supported' });

  if (action === 'classify-pages') {
    if (mimeType !== 'application/pdf') return res.status(400).json({ error: 'Page classification is only available for PDFs' });
    try {
      const result = await classifyPdfPages(storagePath, user.id);
      return res.status(200).json(result);
    } catch (err) {
      console.error('building-volume PDF classification failed:', err);
      return res.status(500).json({ error: 'PDF page classification failed', detail: err.message });
    }
  }

  const userPrompt = `Read this plan file and calculate the airtight building volume for blower-door testing.

Airtightness layer basis: ${airtightnessLayer}
Default ceiling height when not shown: ${clampNumber(defaultHeightM, 1.8, 8)} m
User notes: ${cleanText(notes, 'None')}
Selected PDF pages: ${Array.isArray(pageSelections) ? pageSelections.map(p => `page ${p.pageNumber}: ${p.pageType}`).join('; ') : 'not applicable'}

Use floor plans for room areas and airtight-envelope boundary. Use ceiling plans, sections, elevations, schedules, and notes for room heights. If a height cannot be found for a room, use the default height and flag it as assumed.

Return JSON only.`;

  try {
    let visionContent;
    let pdfMeta = null;

    if (mimeType === 'application/pdf') {
      pdfMeta = await renderPdfPagesToImageContent(storagePath, user.id, {
        pageNumbers: selectedPages,
        maxPages: MAX_PDF_ANALYSIS_PAGES,
      });
      visionContent = [
        { type: 'text', text: userPrompt },
        ...pdfMeta.content,
      ];
    } else {
      const imageUrl = await signedImageUrl(storagePath, user.id);
      visionContent = [
        { type: 'text', text: userPrompt },
        { type: 'image', source: { type: 'url', url: imageUrl } },
      ];
    }

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 5000,
      temperature: 0.1,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: visionContent,
      }],
    });

    const text = message.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
    const parsed = await parseModelJson(text, 'volume analysis');
    const result = normaliseResult(parsed, airtightnessLayer);

    return res.status(200).json({
      ...result,
      ...(pdfMeta ? {
        pdfPageCount: pdfMeta.pageCount,
        pdfAnalysedPageCount: pdfMeta.analysedPageCount,
        pdfTruncated: pdfMeta.truncated,
      } : {}),
      inputTokens: message.usage?.input_tokens ?? null,
      outputTokens: message.usage?.output_tokens ?? null,
    });
  } catch (err) {
    console.error('building-volume analysis failed:', err);
    return res.status(500).json({ error: 'AI volume analysis failed', detail: err.message });
  }
}
