/**
 * llmRestaurantSearch — Vercel Serverless Function
 * Ported from Base44 backend function.
 * Narrow, task-based LLM endpoint for restaurant search & inspection enrichment.
 * Calls Google Gemini API directly instead of Base44's InvokeLLM wrapper.
 *
 * Tasks: fast_search, web_search, web_enrich, training_enrich, county_enrich
 */

// ── Schemas (unchanged from Base44 version) ──────────────────────────────────

const LLM_SCHEMA = {
  type: "object",
  properties: {
    restaurants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          zip_code: { type: "string" },
          phone: { type: "string" },
          latest_score: { type: "number" },
          latest_date: { type: "string" },
          latest_result: { type: "string" },
          total_inspections: { type: "number" },
          violations: { type: "array", items: { type: "string" } },
          cuisine: { type: "string" },
          data_confidence: { type: "string" },
          is_currently_operating: { type: "boolean" },
          verification_source: { type: "string" },
        },
      },
    },
  },
};

const INSPECTION_SCHEMA = {
  type: "object",
  properties: {
    inspections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idx: { type: "number" },
          latest_score: { type: "number" },
          latest_date: { type: "string" },
          latest_result: { type: "string" },
          total_inspections: { type: "number" },
          violations: { type: "array", items: { type: "string" } },
          data_confidence: { type: "string" },
          verification_source: { type: "string" },
        },
      },
    },
  },
};

const COUNTY_SCHEMA = {
  type: "object",
  properties: {
    inspections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idx: { type: "number" },
          latest_score: { type: "number" },
          latest_date: { type: "string" },
          latest_result: { type: "string" },
          total_inspections: { type: "number" },
          violations: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

// ── Per-locale enrichment context (unchanged from Base44 version) ─────────────

const ENRICH_CONTEXT = {
  houston: "City of Houston Health Department food inspection scores. Houston uses a 0-100 ded point system where lower is better. Convert: 0-10 ded -> score 90-100, 11-20 -> 70-89, 21-30 -> 40-69, 30+ -> 0-39.",
  stanislaus: "Stanislaus County Environmental Health (stancounty.com) food facility inspection results.",
  vancouver: "Vancouver Coastal Health (VCH) restaurant inspection records from inspections.vch.ca. Inspection results: Pass, Conditional Pass, or Closed.",
  pierce: "Tacoma-Pierce County Health Department (TPCHD) food safety rating: Great, Okay, Needs to Improve, or Closed. Great=95, Okay=80, Needs to Improve=55, Closed=25.",
  tacoma: "Tacoma-Pierce County Health Department (TPCHD) food safety rating: Great, Okay, Needs to Improve, or Closed. Great=95, Okay=80, Needs to Improve=55, Closed=25.",
  manchester_ct: "Manchester CT Health Department (manchesterct.gov) uses a Green/Yellow/Red placard system. Green = Pass -> score 90-100, Yellow = Conditional Pass -> score 70-89, Red = Closed/Fail -> score 0-39.",
  riverside: "Riverside County Department of Environmental Health (rivcoeh.org) restaurant inspection records. A=90-100, B=80-89, C=70-79.",
  arkansas: "Arkansas Department of Health (ADH) foodserviceprod.adh.arkansas.gov. 100-point scale: 85+=satisfactory, 70-84=follow-up, 60-69=reinspection, <60=closed.",
  tri_county_co: "Colorado Tri-County Health Department (TCHD) covers Adams, Arapahoe, and Douglas counties. CDPHE risk index scoring: 0-49=Pass, 50-109=Re-Inspection, 110+=Closed.",
  maricopa: "Maricopa County Environmental Services restaurant inspection grades. A=90-100, B=80-89, C=70-79, R=Re-Inspection (50-69).",
  dc: "DC Health (dc.healthinspections.us) uses FDA Food Code pass/fail inspection with Priority, Priority Foundation, and Core violation categories.",
  florida: "Florida DBPR Division of Hotels & Restaurants. HP=10pts, INT=5pts, Basic=2pts.",
  georgia: "Georgia Department of Public Health. A=90-100, B=80-89, C=70-79, U=69 or below.",
  hawaii: "Hawaii Department of Health Food Safety Branch. Green=Pass->90-100, Yellow=Conditional->70-89, Red=Closed->0-39.",
  maine: "Maine CDC Health Inspection Program. Failed if >3 critical or >10 non-critical.",
  michigan: "Michigan restaurant inspections managed by 45 local health departments.",
  minnesota: "Minnesota Department of Health food inspections. No state-wide portal.",
  missouri: "Missouri DHSS food inspections managed by local agencies. No state-wide portal.",
  nebraska: "Nebraska DHHS food inspections managed by local health departments.",
  new_hampshire: "New Hampshire DHHS Food Protection. Green=no priority violations->90-100, Yellow=priority not corrected->70-89, Red=closed->0-39.",
  new_jersey: "New Jersey restaurant inspections managed by local county/city health departments.",
  ohio: "Ohio restaurant inspections managed by local health departments.",
  south_carolina: "South Carolina SCDA. A=90-100, B=80-89, C=70-79.",
  tennessee: "Tennessee TDH state-wide portal at inspections.myhealthdepartment.com/tennessee.",
  virginia: "Virginia VDH inspection reports. 100-point scale.",
  wisconsin: "Wisconsin DATCP state-wide portal. Priority/non-priority violations.",
  wyoming: "Wyoming WDA Consumer Health Services. IN/OUT/COS/NC/C compliance coding.",
  utah: "Utah Salt Lake County Health Department portal. Star ranking system.",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function capStr(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function toList(body) {
  const arr = Array.isArray(body?.list) ? body.list : [];
  return arr
    .slice(0, 60)
    .map((r) => ({
      name: capStr(r?.name, 300),
      address: capStr(r?.address, 300),
      city: capStr(r?.city, 120),
      zip_code: capStr(r?.zip_code, 20),
    }))
    .filter((r) => r.name);
}

/**
 * Call Gemini API directly.
 * Replaces base44.asServiceRole.integrations.Core.InvokeLLM.
 *
 * @param {string} prompt - the prompt text
 * @param {boolean} useSearch - whether to enable Google Search grounding (replaces add_context_from_internet)
 * @param {object} schema - JSON schema for structured output
 */
async function callGemini(prompt, useSearch, schema) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  // Use gemini-2.0-flash for all tasks (fast, capable, free tier)
  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  // Enable Google Search grounding when internet context is needed
  if (useSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();

  // Extract the text content from Gemini's response
  const textPart = data.candidates?.[0]?.content?.parts?.find((p) => p.text);
  if (!textPart?.text) {
    return schema.properties.restaurants ? { restaurants: [] } : { inspections: [] };
  }

  // Parse the JSON response
  try {
    // Strip markdown code fences if present
    const cleaned = textPart.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return schema.properties.restaurants ? { restaurants: [] } : { inspections: [] };
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const body = req.body || {};
    const task = capStr(body?.task, 40);
    const today = new Date().toISOString().slice(0, 10);

    let prompt = "";
    let useSearch = false;
    let schema = LLM_SCHEMA;

    if (task === "fast_search") {
      const query = capStr(body?.query, 300);
      const location = capStr(body?.location, 300) || null;
      const dubai = body?.dubai === true;
      if (!query) return res.status(400).json({ error: "query required" });

      prompt = dubai
        ? `DUBAI ONLY. REJECT: Miami, Boston, New York, Chicago, LA, SF, Austin, London, Paris, Tokyo, Abu Dhabi, any US city.\nList ONLY restaurants in DUBAI, UAE. city="Dubai" ALWAYS. Address: Jumeirah, Deira, Bur Dubai, Marina, Downtown, JBR, DIFC, Business Bay, Palm, Sheikh Zayed, Dubai.\nReturn max 8. If unsure = OMIT. ZERO non-Dubai results.`
        : location
          ? `List up to 8 real restaurants matching "${query}" in ${location}. Training data only. Only results physically in ${location}.`
          : `List up to 8 real restaurants matching "${query}" worldwide. Training data only.`;
      useSearch = false;
      schema = LLM_SCHEMA;

    } else if (task === "web_search") {
      const query = capStr(body?.query, 300);
      const location = capStr(body?.location, 300) || null;
      const dubai = body?.dubai === true;
      const ctx = capStr(body?.ctx, 5000);
      if (!query) return res.status(400).json({ error: "query required" });

      const basePrompt = dubai
        ? `Today is ${today}. Search the LIVE WEB for real food safety inspection records for "${query}" PHYSICALLY IN DUBAI, UAE ONLY.\nRULES:\n1. BLOCK all US cities, London, Paris, Tokyo, Abu Dhabi, Sharjah.\n2. city MUST be exactly "Dubai". Address MUST include Dubai markers.\n3. ONLY return restaurants you can VERIFY exist via web search. If unsure = OMIT.\n4. latest_score: 0-100 from REAL inspection data. If not found, set null.\n5. data_confidence: "high"=official record; "medium"=confirmed; "low"=no details; "none"=unverified.\n6. is_currently_operating: true ONLY if evidence it's open today.\n7. verification_source: URL/name where confirmed.\n8. Return max 8 verified Dubai restaurants only.`
        : location
          ? `Today is ${today}. Search the LIVE WEB for real health inspection records for "${query}" in ${location} ONLY.\nRULES:\n1. ONLY return restaurants you can VERIFY exist via web search.\n2. city MUST be "${location}" or start with the same word. NEVER return results from outside ${location}.\n3. latest_score: 0-100 from REAL inspection data. If not found, set null.\n4. data_confidence: "high"=official record; "medium"=confirmed; "low"=no details; "none"=unverified.\n5. is_currently_operating: true ONLY if evidence it's open today.\n6. verification_source: URL/name where confirmed.\n7. address: full street address REQUIRED. If not found, OMIT restaurant.\n8. Return max 8 verified results. Identify cuisine type.`
          : `Today is ${today}. Search the LIVE WEB for real health inspection records for "${query}" anywhere in the world.\nRULES:\n1. ONLY return restaurants you can VERIFY. No invented data.\n2. Return up to 8 real, verifiable businesses.\n3. latest_score: 0-100 from REAL data. If not found, set null.\n4. data_confidence: "high"=official; "medium"=some reference; "low"=no details; "none"=unverified.\n5. is_currently_operating: true ONLY if evidence it's open today.\n6. verification_source: URL/name where confirmed.\n7. address: full street address REQUIRED. If not found, OMIT restaurant.\n8. Identify cuisine type.`;

      prompt = ctx ? `${basePrompt}\n- ${ctx}` : basePrompt;
      useSearch = true;
      schema = LLM_SCHEMA;

    } else if (task === "web_enrich") {
      const list = toList(body);
      const location = capStr(body?.location, 300);
      const ctx = capStr(body?.ctx, 5000);
      if (list.length === 0) return res.status(200).json({ inspections: [] });

      prompt = `Today is ${today}. Below are VERIFIED, REAL restaurants${location ? ` in ${location}` : ""} (confirmed via Google Places).

Search the LIVE WEB for OFFICIAL health inspection records for these EXACT establishments:

${list.map((r, i) => `${i}. ${r.name} -- ${r.address}`).join("\n")}

${ctx ? `SOURCE GUIDANCE: ${ctx}\n` : ""}RULES:
1. Return one entry per restaurant you find inspection data for, keyed by "idx".
2. latest_score 0-100, latest_date, latest_result, violations: from REAL official records ONLY.
3. If clean (no violations): latest_score: 100, latest_result: "No violations found", violations: [].
4. If source uses rating system, CONVERT: "Great/A" -> 90-100, "Okay/B" -> 70-89, "Needs Improve/C" -> 40-69, "Closed/F" -> 0-39.
5. If no official record found, OMIT that idx. NEVER invent scores.
6. data_confidence: "high"=official record; "medium"=secondhand; "low"=uncertain.
7. verification_source: URL or agency name.`;

      useSearch = true;
      schema = INSPECTION_SCHEMA;

    } else if (task === "training_enrich") {
      const list = toList(body);
      const countyId = capStr(body?.countyId, 60);
      if (list.length === 0) return res.status(200).json({ inspections: [] });

      const ctx = ENRICH_CONTEXT[countyId] || "";
      prompt = `For each restaurant below, return the most recent health inspection score if you know it from your training data. Only return restaurants you have real data for.

${ctx ? `SOURCE CONTEXT: ${ctx}\n` : ""}${list.map((r, i) => `${i}. ${r.name} -- ${r.address}, ${r.city}${r.zip_code ? " " + r.zip_code : ""}`).join("\n")}

Return JSON with "inspections" array. Each entry has "idx", "latest_score" (0-100), "latest_date", "latest_result", "total_inspections", "violations" (array), "data_confidence" (high/medium/low), "verification_source".
If clean: latest_score: 100, latest_result: "No violations found", violations: [].
If no data, OMIT from array.`;

      useSearch = false;
      schema = INSPECTION_SCHEMA;

    } else if (task === "county_enrich") {
      const list = toList(body);
      const location = capStr(body?.location, 300);
      if (list.length === 0) return res.status(200).json({ inspections: [] });

      prompt = `Today is ${today}. Below are VERIFIED, REAL restaurants in ${location} (confirmed via Google Places).

Search the LIVE WEB for OFFICIAL health inspection records for these EXACT establishments:

${list.map((r, i) => `${i}. ${r.name} -- ${r.address}`).join("\n")}

RULES:
1. Return one entry per restaurant you find an official record for, keyed by "idx".
2. latest_score 0-100, latest_date, latest_result, violations: from REAL official records ONLY.
3. If no official record, OMIT that idx. NEVER invent scores.`;

      useSearch = true;
      schema = COUNTY_SCHEMA;

    } else {
      return res.status(400).json({ error: "Unknown task" });
    }

    const result = await callGemini(prompt, useSearch, schema);
    return res.status(200).json(result);

  } catch (error) {
    console.error("llmRestaurantSearch error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
