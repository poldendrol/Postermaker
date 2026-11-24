// Temporary probe.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9" } }); return [r.status, r.url, await r.text()]; };
const [, , cb] = await get("https://cinebel.dhnet.be/fr/cinema/994/Sphinx");
const opts = [...cb.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map(m => m[1] + "=" + m[2].trim());
console.log("CINEBEL options with gent/gand:", opts.filter(o => /gent|gand|ledeberg|kinepolis|decascoop|sint-amands|merelbeke|drongen/i.test(o)).join(" | "));
console.log("CINEBEL hrefs:", [...new Set([...cb.matchAll(/href="([^"]*cinema\/\d+\/[^"]*)"/g)].map(m => m[1]))].filter(h => /gent|gand|kinepolis|deca/i.test(h)).join(" "));
for (const u of ["https://www.uitinvlaanderen.be/agenda/alle/gent/film", "https://www.uitinvlaanderen.be/agenda/f/film/gent", "https://www.viernulvier.gent/nl/agenda", "https://kinepolis.be/nl/bioscopen/kinepolis-gent/agenda", "https://kinepolis.be/nl/films?cinema=KGENT", "https://www.decascoop.be/", "https://filmfestival.be/nl/"]) {
  try {
    const [st, fin, h] = await get(u);
    console.log("\n=====", u, st, fin, h.length);
    for (const k of ["__NEXT_DATA__", "ld+json", "ScreeningEvent", "\"Event\"", "__NUXT__", "api", "graphql"]) console.log(k, h.split(k).length - 1);
    const apis = [...new Set([...h.matchAll(/https?:\/\/[a-z0-9.-]*(?:api|graphql|search)[a-z0-9.\/_-]*/gi)].map(m => m[0]))].slice(0, 12);
    console.log("API-ish:", apis.join(" "));
    const ld = [...h.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => /Event/.test(x)).slice(0, 1);
    ld.forEach(x => console.log("LD:", x.slice(0, 1500)));
    const txt = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ");
    const t = [...txt.matchAll(/\b([01]\d|2[0-3])[:.h]([0-5]\d)\b/g)].slice(0, 2);
    t.forEach(m => console.log("CTX:", txt.slice(Math.max(0, m.index - 600), m.index + 200).replace(/\s+/g, " ")));
    const nd = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (nd) console.log("NEXT:", nd[1].slice(0, 800));
  } catch (e) { console.log("ERR", u, e.message); }
}
