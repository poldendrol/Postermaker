// Temporary probe.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9" } }); return [r.status, r.url, await r.text()]; };
for (const u of ["https://www.cinenews.be/nl/bioscopen/kinepolis-gent/", "https://www.cinenews.be/nl/bioscopen/", "https://www.cinenews.be/nl/bioscopen/oost-vlaanderen/", "https://cinebel.dhnet.be/cinemas/11/Oost-Vlaanderen", "https://cinebel.dhnet.be/fr/cinemas/11/Flandre-orientale", "https://www.uitinvlaanderen.be/agenda/film/gent?page=2", "https://www.uitinvlaanderen.be/agenda/film/gent?pagina=2"]) {
  try {
    const [st, fin, h] = await get(u);
    const ids = [...h.matchAll(/data-offer-id="([^"]+)"/g)].map(m => m[1].slice(0, 8));
    const kin = [...new Set([...h.matchAll(/href="([^"]*(?:kinepolis|bioscoop|cinema|theater)[^"]*)"/gi)].map(m => m[1]))].slice(0, 30);
    console.log("=====", u, st, fin, h.length, "offers:", ids.join(","), "\n links:", kin.join(" "));
    const t = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, " ");
    const m = t.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/); if (m && /cinenews|cinebel/.test(u)) console.log("CTX:", t.slice(Math.max(0, m.index - 800), m.index + 300).replace(/\s+/g, " "));
  } catch (e) { console.log("ERR", u, e.message, e.cause?.code); }
}
