export const PORTABLE_FORMAT = "hiper-studio-portable-project";
export const PORTABLE_PACKAGE_VERSION = 1;
export const MAX_PORTABLE_TEXT_BYTES = 32 * 1024 * 1024;

const BUDGET_TIMESTAMP = "2000-01-01T00:00:00.000Z";

export class PortableBudgetError extends RangeError {
  constructor(message, code, budget, previousBudget = null) {
    super(message);
    this.name = "PortableBudgetError";
    this.code = code;
    this.budget = budget;
    this.previousBudget = previousBudget;
  }
}

export function encodePortableEnvelope(projectJson, exportedAtUtc) {
  if (typeof projectJson !== "string") throw new TypeError("Portable project data must be serialized JSON text");
  if (typeof exportedAtUtc !== "string" || !Number.isFinite(Date.parse(exportedAtUtc))) {
    throw new TypeError("Portable project export timestamp is invalid");
  }
  return JSON.stringify(
    {
      format: PORTABLE_FORMAT,
      packageVersion: PORTABLE_PACKAGE_VERSION,
      exportedAtUtc,
      projectJson,
    },
    null,
    2,
  );
}

export function inspectPortableEnvelopeBudget(projectJson, options = {}) {
  if (typeof projectJson !== "string") throw new TypeError("Portable project data must be serialized JSON text");
  const maximumBytes = resolveMaximumBytes(options.maximumBytes);
  const exportedAtUtc = options.exportedAtUtc ?? BUDGET_TIMESTAMP;
  const encodedProjectString = JSON.stringify(projectJson);
  const encoded = encodePortableEnvelope(projectJson, exportedAtUtc);
  const projectJsonBytes = utf8Bytes(projectJson);
  const encodedProjectStringBytes = utf8Bytes(encodedProjectString);
  const totalBytes = utf8Bytes(encoded);
  const budget = {
    maximumBytes,
    totalBytes,
    remainingBytes: Math.max(0, maximumBytes - totalBytes),
    portable: totalBytes <= maximumBytes,
    projectJsonBytes,
    jsonEscapingBytes: encodedProjectStringBytes - projectJsonBytes,
    portableMetadataBytes: totalBytes - encodedProjectStringBytes,
  };
  return Object.freeze(budget);
}

export function assertPortableEnvelopeText(encoded, options = {}) {
  if (typeof encoded !== "string") throw new TypeError("Portable project input must be text");
  const maximumBytes = resolveMaximumBytes(options.maximumBytes);
  if (encoded.length > maximumBytes) throw portableTextError(maximumBytes, encoded.length);
  const byteLength = utf8Bytes(encoded);
  if (byteLength > maximumBytes) throw portableTextError(maximumBytes, byteLength);
  return byteLength;
}

export function assertPortableProjectGrowth(currentProjectJson, nextProjectJson, options = {}) {
  const current = inspectPortableEnvelopeBudget(currentProjectJson, options);
  const next = inspectPortableEnvelopeBudget(nextProjectJson, options);
  if (next.portable) return next;
  if (!current.portable && next.totalBytes <= current.totalBytes) return next;
  const code = current.portable
    ? "portable_budget_exceeded"
    : "oversized_project_growth_blocked";
  const prefix = current.portable
    ? "Command would make the project exceed"
    : "Command would increase an already oversized legacy project beyond";
  throw new PortableBudgetError(
    `${prefix} the ${next.maximumBytes}-byte portable envelope limit ` +
      `(${next.totalBytes} bytes required); project unchanged and no data discarded`,
    code,
    next,
    current,
  );
}

function resolveMaximumBytes(value) {
  if (value === undefined) return MAX_PORTABLE_TEXT_BYTES;
  if (!Number.isInteger(value) || value < 256 || value > MAX_PORTABLE_TEXT_BYTES) {
    throw new RangeError(`Portable test or policy limit must be between 256 and ${MAX_PORTABLE_TEXT_BYTES} bytes`);
  }
  return value;
}

function portableTextError(maximumBytes, actualBytes) {
  return new PortableBudgetError(
    `Portable project exceeds the ${maximumBytes}-byte text limit (${actualBytes} bytes supplied)`,
    "portable_text_limit_exceeded",
    Object.freeze({ maximumBytes, totalBytes: actualBytes, portable: false, remainingBytes: 0 }),
  );
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}
