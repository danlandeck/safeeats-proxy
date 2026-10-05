/**
 * placesRestaurantSearch — Vercel Serverless Function
 * Ported from Base44 backend function.
 * Ground-truth restaurant lookup via Google Places Text Search (v1).
 * Used by the AI-fallback search path (jurisdictions with no live inspection API).
 */

function parseComponents(components) {
  const out = { city: "", state: "", zip: "", country: "" };
  for (const c of components || []) {
    const types = c.types || [];
    if (types.includes("postal_code")) out.zip = c.shortText || c.longText || "";
    if (types.includes("locality")) out.city = c.longText || c.shortText || "";
    if (!out.city && types.includes("postal_town")) out.city = c.longText || "";
    if (!out.city && types.includes("sublocality")) out.city = c.longText || "";
    if (types.includes("administrative_area_level_1")) out.state = c.shortText || "";
    if (types.includes("country")) out.country = c.shortText || c.longText || "";
  }
  return out;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { query, location } = req.body || {};

    if (!query || !query.trim()) {
      return res.status(400).json({ found: false, reason: "query is required" });
    }

    const apiKey = process.env.GOOGLE_PLACES_KEY;
    if (!apiKey) {
      return res.status(500).json({ found: false, reason: "GOOGLE_PLACES_KEY not configured" });
    }

    // Wrap multi-word brand names in quotes so Google Places returns exact brand
    // matches (e.g. "Taco Bell") instead of fuzzy matches (e.g. "Taco Time").
    const isBrandName = query.trim().split(/\s+/).length >= 2;
    const quotedQuery = isBrandName ? `"${query.trim()}"` : query.trim();
    const textQuery = location
      ? `${quotedQuery} restaurant in ${location}`
      : `${quotedQuery} restaurant`;

    const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.businessStatus",
          "places.addressComponents",
          "places.location",
          "places.primaryTypeDisplayName",
        ].join(","),
      },
      body: JSON.stringify({ textQuery, maxResultCount: 8 }),
    });

    if (!placesRes.ok) {
      const errText = await placesRes.text();
      return res.status(502).json({
        found: false,
        reason: `Places API ${placesRes.status}`,
        detail: errText.slice(0, 300),
      });
    }

    const data = await placesRes.json();
    const places = Array.isArray(data.places) ? data.places : [];

    const restaurants = places
      .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
      .map((p) => {
        const comp = parseComponents(p.addressComponents);
        return {
          place_id: p.id || "",
          name: p.displayName?.text || "",
          address: p.formattedAddress || "",
          city: comp.city,
          state: comp.state,
          zip_code: comp.zip,
          country: comp.country,
          business_status: p.businessStatus || "OPERATIONAL",
          latitude: p.location?.latitude ?? null,
          longitude: p.location?.longitude ?? null,
          cuisine: p.primaryTypeDisplayName?.text || "",
        };
      })
      .filter((r) => r.name && r.address);

    return res.status(200).json({ found: restaurants.length > 0, restaurants });
  } catch (error) {
    return res.status(500).json({ found: false, reason: error.message });
  }
}
