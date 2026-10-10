const MASPERO_INDEX = "https://www.maspero.eg/stream";

const KNOWN = {
  7: ["quran", "إذاعة القرآن الكريم"],
  8: ["radio-masr", "إذاعة راديو مصر"],
  9: ["voice-arabs", "إذاعة صوت العرب"],
  10: ["general", "إذاعة البرنامج العام"],
  11: ["youth-sports", "إذاعة الشباب والرياضة"],
  12: ["cultural", "إذاعة البرنامج الثقافي"],
  13: ["songs", "إذاعة الأغاني"],
  14: ["cairo", "إذاعة القاهرة الكبرى"],
  16: ["middle-east", "إذاعة الشرق الأوسط"],
  18: ["european", "إذاعة البرنامج الأوروبي"],
  22: ["directed-2", "الإذاعات الموجهة 2"],
  23: ["directed-1", "الإذاعات الموجهة 1"],
  24: ["educational", "راديو التعليمية"],
};

const GENERAL_ZENO_PAGE =
  "https://zeno.fm/radio/ertu-lathaaat-albrnamg-alaaam/";
const GENERAL_FALLBACK_HLS =
  "http://livestreaming5.onlinehorizons.net/hls-live/pernamegaam/_definst_/liveevent/livestream.m3u8";
const GENERAL_ALT_HLS = "https://live.egradiotv.com/radio_eg.m3u8";
const GENERAL_ALT_STREAM = "http://stream.ertu.org:8000/programG";
const GENERAL_RADIOTUB =
  "https://radio-tv-streams.radiotub.com/streams/eg/Cairo.m3u8";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const stripHtml = (value = "") =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const stationSlug = (id) => KNOWN[id]?.[0] || `maspero-${id}`;
const stationName = (id, label = "") =>
  KNOWN[id]?.[1] || stripHtml(label) || `محطة ماسبيرو ${id}`;

function parseMasperoIndex(html) {
  const found = new Map();

  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']*\/stream\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const id = Number(match[2]);
    found.set(id, {
      id,
      slug: stationSlug(id),
      name: stationName(id, match[3]),
      official_page: new URL(match[1], "https://www.maspero.eg").toString(),
    });
  }

  for (const match of html.matchAll(/\/stream\/(\d+)/g)) {
    const id = Number(match[1]);
    if (!found.has(id)) {
      found.set(id, {
        id,
        slug: stationSlug(id),
        name: stationName(id),
        official_page: `https://www.maspero.eg/stream/${id}`,
      });
    }
  }

  return [...found.values()].sort((a, b) => a.id - b.id);
}

function extractDailymotionId(html) {
  const patterns = [
    /dailymotion\.com\/(?:embed\/)?video\/([a-z0-9]+)/i,
    /geo\.dailymotion\.com\/player\/[a-z0-9]+\.html\?[^"'<>]*\bvideo=([a-z0-9]+)/i,
    /[?&]video=([a-z0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "EgyptRadioGateway/1.0",
    },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function discoverStations() {
  const html = await fetchText(MASPERO_INDEX);
  return parseMasperoIndex(html);
}

async function getStation(slug) {
  const stations = await discoverStations();
  return stations.find((s) => s.slug === slug || String(s.id) === slug) || null;
}

async function inspectDailymotion(videoId) {
  const metadataUrl =
    `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(videoId)}?app=com.dailymotion.neon`;

  const response = await fetch(metadataUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "EgyptRadioGateway/1.0",
    },
  });

  if (!response.ok) {
    return { ok: false, error: `metadata_http_${response.status}` };
  }

  const metadata = await response.json();
  if (metadata.error) {
    return {
      ok: false,
      error:
        metadata.error.code ||
        metadata.error.raw_message ||
        "dailymotion_metadata_error",
    };
  }

  const hls = [];
  for (const variants of Object.values(metadata.qualities || {})) {
    for (const variant of variants || []) {
      if (
        variant?.url &&
        (variant.type === "application/x-mpegURL" ||
          variant.url.includes(".m3u8"))
      ) {
        hls.push(variant.url);
      }
    }
  }

  return {
    ok: hls.length > 0,
    video_id: videoId,
    hls,
    note:
      hls.length > 0
        ? "Dailymotion exposes HLS metadata, but this gateway will not bypass provider domain/app restrictions."
        : "No HLS entry exposed.",
  };
}

function extractZenoHls(html) {
  const patterns = [
    /hls_url\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /["']hls_url["']\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].replace(/\\\//g, "/");
  }
  return null;
}

async function probeStream(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "*/*",
        "user-agent": "EgyptRadioGateway/1.0",
      },
    });
    const type = response.headers.get("content-type") || "";
    let sample = "";
    if (type.includes("mpegurl") || type.includes("text") || type.includes("octet-stream")) {
      const reader = response.body?.getReader();
      if (reader) {
        const first = await reader.read();
        if (first.value) sample = new TextDecoder().decode(first.value.slice(0, 400));
        try { await reader.cancel(); } catch {}
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      final_url: response.url,
      content_type: type,
      sample,
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function resolveStation(station) {

  // General Program: use the currently working public RadioTub relay.
  // It starts playback immediately in RadioTub and avoids the slow/dead legacy endpoints.
  if (station.id === 10) {
    return {
      ok: true,
      provider: "radiotub-relay",
      url: GENERAL_RADIOTUB,
    };
  }

  const pageHtml = await fetchText(station.official_page);
  const videoId = extractDailymotionId(pageHtml);

  if (!videoId) {
    return {
      ok: false,
      error: "no_compatible_public_stream",
      note: "No public third-party-playable source is known for this station yet.",
    };
  }

  const dm = await inspectDailymotion(videoId);
  return {
    ok: false,
    provider: "dailymotion",
    video_id: videoId,
    error: "provider_restricted_or_unverified_for_third_party_playback",
    dailymotion: dm,
    note:
      "The official Dailymotion source is recorded, but the gateway does not republish a provider-restricted signed HLS as an unrestricted stream.",
  };
}

function page(stations, origin) {
  const cards = stations
    .map((s) => {
      const ready = s.id === 10;
      return `
      <article>
        <strong>${s.name}</strong>
        ${ready
          ? `<code>${origin}/stream/${s.slug}</code>
             <button data-copy="${origin}/stream/${s.slug}">Copy stream link</button>
             <span class="ok">Ready for testing in The Radio App</span>`
          : `<span class="bad">Discovered, but no verified third-party-playable stream yet.</span>`}
        <a href="/health/${s.slug}">Diagnostics</a>
      </article>`;
    })
    .join("");

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Egypt Radio Gateway</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#081426;color:#fff;max-width:920px;margin:auto;padding:24px}
article{background:#12223a;padding:16px;border-radius:14px;margin:12px 0;display:grid;gap:10px}
code{direction:ltr;text-align:left;background:#07101e;padding:10px;border-radius:8px;overflow-wrap:anywhere}
button{width:max-content;padding:8px 14px;cursor:pointer}a{color:#9cc6ff}
small{color:#b8c6d9}.ok{color:#8fe3a6}.bad{color:#ffb0b0}
</style>
</head>
<body>
<h1>Egypt Radio Gateway</h1>
<p>روابط ثابتة لـ The Radio App. قائمة المحطات تُقرأ من فهرس ماسبيرو الرسمي، لذلك الإضافات والحذف تظهر تلقائيًا.</p>
<small>Only stations marked Ready have a link intended for The Radio App. Other stations are discovered automatically but are not presented as usable stream links until a verified public source exists.</small>
${cards}
<script>
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  await navigator.clipboard.writeText(b.dataset.copy);
  const old=b.textContent;b.textContent="Copied";setTimeout(()=>b.textContent=old,1200);
});
</script>
</body></html>`;
}

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (path === "/") {
        const stations = await discoverStations();
        return new Response(page(stations, url.origin), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (path === "/api/stations") {
        return json({ stations: await discoverStations() });
      }

      const streamMatch = path.match(/^\/stream\/([a-z0-9-]+)$/i);
      if (streamMatch) {
        const station = await getStation(streamMatch[1]);
        if (!station) return json({ error: "station_not_found" }, 404);

        const resolved = await resolveStation(station);
        if (!resolved.ok) {
          return json({ station, ...resolved }, 503);
        }

        return new Response(null, {
          status: 302,
          headers: {
            location: resolved.url,
            "cache-control": "no-store",
            "x-radio-provider": resolved.provider,
          },
        });
      }

      const healthMatch = path.match(/^\/health\/([a-z0-9-]+)$/i);
      if (healthMatch) {
        const station = await getStation(healthMatch[1]);
        if (!station) return json({ error: "station_not_found" }, 404);
        return json({ station, result: await resolveStation(station) });
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      return json(
        { error: "internal_error", detail: String(error?.message || error) },
        500
      );
    }
  },
};
