export const STUDIO_CAPTCHA_ACTIONS = Object.freeze(["sign-in", "signup", "recovery"]);
export const STUDIO_CAPTCHA_PROVIDERS = Object.freeze(["turnstile", "hcaptcha"]);

export function createStudioCaptcha(adapter = null) {
  if (!adapter || adapter.enabled !== true) {
    return Object.freeze({
      enabled: false,
      provider: null,
      async acquire() { return undefined; },
      async reset() {},
    });
  }

  const provider = String(adapter.provider ?? "").trim().toLowerCase();
  if (!STUDIO_CAPTCHA_PROVIDERS.includes(provider)) {
    throw new TypeError("CAPTCHA provider must be turnstile or hcaptcha");
  }
  if (typeof adapter.acquireToken !== "function") {
    throw new TypeError("Enabled CAPTCHA requires an acquireToken action");
  }

  return Object.freeze({
    enabled: true,
    provider,
    async acquire(action) {
      requireAction(action);
      const token = String(await adapter.acquireToken(action) ?? "").trim();
      if (!token) throw new Error("Complete the CAPTCHA challenge before continuing");
      return token;
    },
    async reset(action) {
      requireAction(action);
      if (typeof adapter.reset === "function") await adapter.reset(action);
    },
  });
}

export async function runWithStudioCaptcha(captcha, action, request) {
  const token = await captcha.acquire(action);
  try {
    return await request(token);
  } finally {
    try {
      await captcha.reset(action);
    } catch {
      // Widget cleanup must not turn a completed Auth request into an ambiguous failure.
    }
  }
}

export function withCaptchaToken(payload, captchaToken) {
  if (!captchaToken) return payload;
  return {
    ...payload,
    options: {
      ...(payload.options ?? {}),
      captchaToken,
    },
  };
}

function requireAction(action) {
  if (!STUDIO_CAPTCHA_ACTIONS.includes(action)) throw new TypeError("CAPTCHA action is invalid");
}
