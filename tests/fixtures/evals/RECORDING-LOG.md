# Eval fixture recording log

Last run: 2026-10-05T23:55:52.416Z by `pnpm eval:record`. Every fixture holds the exact fetch time of each answer.

| # | Park | OSM id | Result | OSM | iNaturalist (1.5 km, 14 days) |
|---|---|---|---|---|---|
| 1 | Connemara Meadow Preserve | `way/306191453` | ok, maps.mail.ru 25.4 s, after 1 failed mirror tries | 1 kinds, 0 trees | 79 species / 104 obs |
| 2 | Celebration Park | `way/188145317` | ok, kept the recording from 2026-10-05T23:44:55.234Z | 11 kinds, 52 trees | 0 species / 0 obs |
| 3 | Arbor Hills Nature Preserve | `way/38113837` | ok, overpass-api.de 2.8 s | 10 kinds, 2 trees | 56 species / 76 obs |
| 4 | Oak Point Park and Nature Preserve | `way/556800335` | ok, maps.mail.ru 18.3 s, after 1 failed mirror tries | 6 kinds, 0 trees | 67 species / 95 obs |
| 5 | Bob Woodruff Park (North) | `way/556800332` | ok, overpass-api.de 5.7 s | 9 kinds, 0 trees | 29 species / 31 obs |
| 6 | Bethany Lakes Park | `way/366756040` | ok, maps.mail.ru 16.7 s, after 1 failed mirror tries | 10 kinds, 0 trees | 5 species / 5 obs |
| 7 | Allen Station Park | `way/375998259` | ok, maps.mail.ru 20.3 s, after 1 failed mirror tries | 9 kinds, 97 trees | 15 species / 16 obs |
| 8 | Erwin Park | `way/595562583` | ok, overpass-api.de 7.4 s | 2 kinds, 0 trees | 0 species / 0 obs |
| 9 | Towne Lake Park | `way/595562022` | ok, maps.mail.ru 17.3 s, after 1 failed mirror tries | 5 kinds, 0 trees | 0 species / 0 obs |
| 10 | Frisco Commons | `way/126703593` | ok, overpass-api.de 11.2 s | 9 kinds, 0 trees | 13 species / 14 obs |
| 11 | Breckinridge Park | `way/290091068` | ok, maps.mail.ru 17.9 s, after 1 failed mirror tries | 11 kinds, 0 trees | 10 species / 10 obs |
| 12 | Spring Creek Forest Preserve Park | `way/280159375` | ok, overpass-api.de 5.5 s | 2 kinds, 0 trees | 28 species / 38 obs |
| 13 | White Rock Lake Park | `way/460905359` | ok, maps.mail.ru 18.0 s, after 1 failed mirror tries | 19 kinds, 0 trees | 25 species / 33 obs |
| 14 | Klyde Warren Park | `way/419524736` | ok, overpass-api.de 2.8 s | 4 kinds, 54 trees | 23 species / 42 obs |
| 15 | Cedar Ridge Preserve | `way/310790501` | ok, overpass-api.de 2.8 s | 8 kinds, 0 trees | 24 species / 25 obs |
| 16 | Trinity River Audubon Center | `way/1255375776` | ok, overpass-api.de 10.4 s | 6 kinds, 0 trees | 26 species / 33 obs |
| 17 | Zilker Metropolitan Park | `relation/13307353` | ok, overpass-api.de 14.3 s | 20 kinds, 85 trees | 86 species / 125 obs |
| 18 | Central Park | `way/427818536` | ok, overpass-api.de 8.0 s | 25 kinds, 1572 trees | 149 species / 468 obs |
| 19 | Golden Gate Park | `way/158602261` | ok, overpass-api.de 9.3 s | 30 kinds, 253 trees | 86 species / 189 obs |
| 20 | Orchards Park | `way/517747125` | ok, kept the recording from 2026-10-05T23:45:56.318Z | 1 kinds, 0 trees | 1 species / 1 obs |

## 2026-10-06: five taxa summaries added (audit R5-S1 safety fix)

The R5-S1 blocklist additions (Ageratina, Amanita, Lantana, Melia, Phytolacca genus...) take some species out of the
summary request, so the next species in line enters the 24 asked for. Those five were never fetched on 2026-10-05,
so each was fetched live from iNaturalist on 2026-10-06 (`/v1/taxa/<id>?per_page=30&locale=en`, GrassPass
User-Agent) and appended as its own `taxa` exchange with its real fetch time. Nothing recorded earlier was changed.

| Park | Added taxon |
|---|---|
| Arbor Hills Nature Preserve | 120006 possumhaw |
| Oak Point Park and Nature Preserve | 62944 Lesser Balloon Vine |
| Zilker Metropolitan Park | 50616 marvel of Peru |
| Central Park | 44576 Brown Rat |
| Golden Gate Park | 1454382 Double-crested Cormorant |

The plant list of the season check changes with the summary list, so the three season (phenology) lookups of
the same five parks were fetched live on 2026-10-06 too, with the exact query today's code sends (same place,
radius and month) and appended next to the 2026-10-05 ones (15 exchanges). They hold this month's counts as of
2026-10-06, a day newer than the rest of each fixture.
