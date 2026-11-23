// Temporary: prints what each cinema page exposes, to design the scraper.
const urls = process.argv.slice(2);
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
for (const u of urls) {
  console.log("\n==========", u);
  try {
    const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9,en;q=0.8" } });
    const h = await r.text();
    console.log("status", r.status, "final", r.url, "len", h.length);
    for (const k of ["__NEXT_DATA__", "application/ld+json", "ScreeningEvent", "\"@type\":\"Event\"", "graphql", "api.", "wp-json", "self.__next_f"]) console.log(k, (h.split(k).length - 1));
    const ld = [...h.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].slice(0, 2);
    ld.forEach(m => console.log("LD:", m[1].slice(0, 1200)));
    const apis = [...new Set([...h.matchAll(/https?:\/\/[a-z0-9.-]*(?:api|graphql)[a-z0-9.\/-]*/gi)].map(m => m[0]))].slice(0, 15);
    console.log("API-ish urls:", apis.join(" "));
    const txt = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ");
    const times = [...txt.matchAll(/\b([01]\d|2[0-3])[:.h]([0-5]\d)\b/g)].slice(0, 4);
    times.forEach(m => console.log("CTX:", txt.slice(Math.max(0, m.index - 700), m.index + 200).replace(/\s+/g, " ")));
    const nd = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nd) { const j = JSON.parse(nd[1]); console.log("NEXT keys:", JSON.stringify(j.props?.pageProps ? Object.keys(j.props.pageProps) : Object.keys(j)).slice(0, 500)); console.log("NEXT sample:", nd[1].slice(0, 1500)); }
    const flight = h.match(/self\.__next_f\.push\(\[1,"([\s\S]{0,1500})/); if (flight) console.log("FLIGHT:", flight[1]);
  } catch (e) { console.log("ERR", e.message); }
}
