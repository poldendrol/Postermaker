// Temporary probe.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9" } }); return [r.status, r.url, await r.text()]; };
const [, , cb] = await get("https://cinebel.dhnet.be/fr/cinema/994/Sphinx");
const sel = [...cb.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/g)].map(m => m[0].slice(0, 200) + " ... " + (m[1].match(/<option/g) || []).length + " options");
console.log("SELECTS:", sel.join("\n"));
console.log("ALL OPTIONS:", [...cb.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)/g)].map(m => m[1] + "=" + m[2].trim()).join(" | ").slice(0, 6000));
console.log("LINKS:", [...new Set([...cb.matchAll(/href="([^"]+)"/g)].map(m => m[1]))].filter(h => /cinema|theater|ville|city|region/i.test(h)).slice(0, 60).join(" "));
for (const u of ["https://cinebel.dhnet.be/nl/bioscopen", "https://cinebel.dhnet.be/fr/cinemas", "https://www.cinebel.be/nl/bioscopen", "https://visit.gent.be/nl/agenda?f%5B0%5D=category%3Afilm", "https://visit.gent.be/nl/agenda", "https://www.uitinvlaanderen.be/agenda/alle/gent", "https://www.viernulvier.gent/", "https://viernulvier.gent/nl/programma"]) {
  try {
    const [st, fin, h] = await get(u);
    console.log("\n=====", u, st, fin, h.length);
    console.log("LINKS:", [...new Set([...h.matchAll(/href="([^"]+)"/g)].map(m => m[1]))].filter(x => /cinema|bioscoop|agenda|film|theater/i.test(x)).slice(0, 40).join(" "));
    const ld = [...h.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(x => /Event/.test(x)).slice(0, 1);
    ld.forEach(x => console.log("LD:", x.slice(0, 1000)));
    const nd = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (nd) console.log("NEXT:", nd[1].slice(0, 600));
  } catch (e) { console.log("ERR", u, e.message, e.cause?.code); }
}
