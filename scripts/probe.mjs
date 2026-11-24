// Temporary probe.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9,en;q=0.8" } }); return [r.status, r.url, await r.text()]; };
for (const u of ["https://cinema.be/en/bioscopen/kinepolis-gent-e9d3bd1c-e", "https://cinema.be/nl/bioscopen/kinepolis-gent-e9d3bd1c-e", "https://oazis.app/en/venue/kinepolis-gent", "https://www.kinepolis.be/cinema/kinepolis-gent/"]) {
  try {
    const [st, fin, h] = await get(u);
    console.log("\n=====", u, st, fin, h.length);
    for (const k of ["__NEXT_DATA__", "ld+json", "ScreeningEvent", "__NUXT_DATA__", "self.__next_f", "startDate", "showtime"]) console.log(k, h.split(k).length - 1);
    const ld = [...h.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]); ld.slice(0, 2).forEach(x => console.log("LD:", x.slice(0, 1500)));
    const nd = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (nd) console.log("NEXT:", nd[1].slice(0, 2000));
    const fl = [...h.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)].map(m => m[1]).join(""); if (fl) { const i = fl.search(/startTime|showtime|start_at|"time"/i); console.log("FLIGHT len", fl.length, "CTX:", fl.slice(Math.max(0, i - 800), i + 1200)); }
    const t = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ");
    const m = [...t.matchAll(/\b([01]\d|2[0-3]):([0-5]\d)\b/g)].slice(0, 2); m.forEach(x => console.log("CTX:", t.slice(Math.max(0, x.index - 700), x.index + 300).replace(/\s+/g, " ")));
    console.log("API-ish:", [...new Set([...h.matchAll(/https?:\/\/[a-z0-9.-]*(?:api|graphql)[a-z0-9.\/_-]*/gi)].map(m => m[0]))].slice(0, 10).join(" "));
  } catch (e) { console.log("ERR", u, e.message, e.cause?.code); }
}
