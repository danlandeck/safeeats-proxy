/**
 * TEMPORARY diagnostic endpoint. Reports whether the Places and Gemini calls
 * behind the search functions work, without exposing keys. Remove after use.
 */
function redact(text) {
  let out = String(text || "");
  for (const k of [process.env.GEMINI_API_KEY, process.env.GOOGLE_PLACES_KEY]) {
    if (k) out = out.split(k).join("[redacted]");
  }
  return out.slice(0, 400);
}

export default async function handler(req, res) {
  const out = {
    env: {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GOOGLE_PLACES_KEY: !!process.env.GOOGLE_PLACES_KEY,
      GEMINI_MODEL: process.env.GEMINI_MODEL || null,
    },
  };

  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_PLACES_KEY || "",
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: '"Shady Glen" restaurant in Manchester, CT', maxResultCount: 3 }),
    });
    const t = await r.text();
    out.places = { status: r.status, body: redact(t) };
  } catch (e) {
    out.places = { error: redact(e.message) };
  }

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${process.env.GEMINI_API_KEY || ""}`);
    const t = await r.text();
    if (r.ok) {
      const names = (JSON.parse(t).models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
        .map((m) => m.name.replace("models/", ""))
        .filter((n) => /flash/.test(n));
      out.geminiModels = { status: r.status, flashModels: names };
    } else {
      out.geminiModels = { status: r.status, body: redact(t) };
    }
  } catch (e) {
    out.geminiModels = { error: redact(e.message) };
  }

  out.generate = {};
  for (const model of ["gemini-3.6-flash", "gemini-flash-latest"]) {
    for (const search of [false, true]) {
      const label = `${model}${search ? "+search" : ""}`;
      try {
        const body = {
          contents: [{ parts: [{ text: 'Return {"ok":true} as JSON.' }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: "object", properties: { ok: { type: "boolean" } } },
            maxOutputTokens: 256,
          },
        };
        if (search) body.tools = [{ google_search: {} }];
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY || ""}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        );
        const t = await r.text();
        out.generate[label] = { status: r.status, body: redact(t).slice(0, 220) };
      } catch (e) {
        out.generate[label] = { error: redact(e.message) };
      }
    }
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
}
