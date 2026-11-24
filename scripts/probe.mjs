// Temporary probe.
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": UA, "accept-language": "nl-BE,nl;q=0.9" } }); return [r.status, r.url, await r.text()]; };
const [, , ov] = await get("https://cinebel.dhnet.be/cinemas/11/Flandre%20orientale");
console.log("OV cinemas:", [...new Set([...ov.matchAll(/href="([^"]*\/cinema\/(\d+)\/[^"]*)"[^>]*>([\s\S]{0,80}?)</g)].map(m => m[2] + "=" + decodeURIComponent(m[1].split("/").pop())))].join(" | "));
const [st, fin, h] = await get("https://www.uitinvlaanderen.be/agenda/film/gent");
console.log("UIT", st, fin, h.length);
for (const k of ["__NEXT_DATA__", "ld+json", "__NUXT__", "self.__next_f", "startDate", "\"location\""]) console.log(k, h.split(k).length - 1);
const ld = [...h.matchAll(/<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
console.log("LD count", ld.length); ld.slice(0, 3).forEach(x => console.log("LD:", x.slice(0, 1500)));
const nd = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); if (nd) console.log("NEXT:", nd[1].slice(0, 2500));
const i = h.indexOf("/agenda/e/"); console.log("ITEM CTX:", h.slice(Math.max(0, i - 1500), i + 2500).replace(/\s+/g, " "));
console.log("API-ish:", [...new Set([...h.matchAll(/https?:\/\/[a-z0-9.-]*(?:api|search|io)[a-z0-9.\/_-]*/gi)].map(m => m[0]))].slice(0, 15).join(" "));
