# PRESS — wydajność

Cel z GDD §18: **60 fps na średnim Androidzie**, a w najcięższych momentach (druk 4 linii z pełnym stojakiem matryc) najwyżej krótkie spadki. Ten dokument opisuje:

- co zmierzono w sesji bez telefonu,
- czego taki pomiar nie mówi,
- jak zmierzyć grę na prawdziwym urządzeniu.

## 1. Jak gra oszczędza klatki (konstrukcja)

| Mechanizm | Gdzie | Efekt |
|---|---|---|
| Render na żądanie | `src/render/animator.ts` | Pętla `requestAnimationFrame` działa tylko przy tweenach, cząstkach albo przeciąganiu, a ~500 ms po ostatniej zmianie usypia. Bezczynny ekran gry nie zużywa CPU ani GPU. |
| Poziomy urządzeń (`low` / `mid` / `high`) | `src/render/scene.ts` (`detectTier`) | Rozdzielczość płótna ograniczona do 1,5 / 2 / 2,5 × CSS px, a limit cząstek to 150 / 400 / 800. Poziom zależy od `hardwareConcurrency` i `deviceMemory`. |
| Bez antyaliasingu MSAA, `powerPreference: high-performance` | `scene.ts` | Mniej pracy GPU. Krawędzie i tak są „drukowane” teksturami. |
| Atlas tekstur pieczony przy buildzie | `scripts/build-textures.ts` → `public/textures/atlas.*` | Jedna tekstura na komórki, plamy i raster, więc mniej przełączeń tekstur i szybki start. |
| `BitmapText` dla liczników | `src/render/hud.ts` | Liczniki odbitek i mnożnika zmieniają się co klatkę bez rysowania tekstu na canvasie. |
| Limiter błysków (≤ 3/s) i potrząsania (≤ 6 px) | `src/render/fx.ts` | Mniej pracy przy seriach i zgodność z WCAG 2.3.1 (błyski). |
| Ogranicz ruch | Ustawienia + `prefers-reduced-motion` | Wyłącza cząstki, potrząsanie i lot arkuszy. Najtańszy tryb. |
| Odporność pętli | `animator.ts` | Wyjątek w tweenie nie zatrzymuje renderowania, a tweeny zniszczonych obiektów są porzucane. |
| Utrata kontekstu WebGL | `scene.ts`, `MainActivity.onRenderProcessGone` | Pixi odtwarza zasoby. Po śmierci procesu renderującego WebView aktywność startuje od nowa, a run wraca z zapisu. |

## 2. Pomiar w sesji (bez telefonu)

**Metoda.** `scripts/perf.mjs` uruchamia headless Chromium z emulacją Pixel 7 na buildzie produkcyjnym (`vite preview`) i włącza spowolnienie CPU przez CDP (`Emulation.setCPUThrottlingRate`). Mierzone są dwa scenariusze:

- **print**: 6 razy z rzędu druk krzyżowy 4 linii (28 komórek), z 5 matrycami, serią 12, cząstkami, plamami i pełnym odliczaniem liczników;
- **drag**: 2 s przeciągania klocka nad planszą (ok. 120 ruchów wskaźnika).

**Koszt klatki** to czas naszego callbacku klatki: aktualizacja tweenów i cząstek plus zlecenie rysowania w Pixi (`animator.frameTimes`). Właśnie on decyduje o przycięciach na słabszym CPU. 4× spowolnienia CPU traktujemy jako przybliżenie średniego Androida (rdzenie klasy Cortex-A76/A78 w WebView), a 6× jako słabego.

Poziom urządzenia wymuszony na `mid` (400 cząstek, rozdzielczość ≤ 2×). Pomiar z 2026-10-07: `node scripts/perf.mjs --throttle 1,4,6 --prints 6`.

| CPU | Scenariusz | Klatek | Koszt klatki śr. (ms) | Koszt klatki p95 (ms) | Long tasks > 50 ms |
|---|---|---:|---:|---:|---|
| 1× | print | 49 | 3,0 | 7,1 | 0 |
| 1× | drag | 137 | 1,4 | 4,6 | 0 |
| **4×** | **print** | 43 | **10,3** | **26,0** | 0 |
| **4×** | **drag** | 133 | **3,2** | **10,1** | 0 |
| 6× | print | 41 | 13,5 | 30,8 | 4 (maks. 62 ms) |
| 6× | drag | 135 | 4,3 | 14,4 | 0 |

Rozkład klatek wokół pojedynczego druku przy 4× (pomiar doraźny tym samym scenariuszem) wygląda tak:

- synchroniczny koszt `place()` (silnik, zdarzenia, przygotowanie prezentacji) to 10–18 ms, a przy pierwszym, „zimnym” wywołaniu 49 ms;
- kolejne klatki kosztują 2–30 ms, a najdroższe są pierwsze 2–3 klatki po uderzeniu prasy.

Sterta JS: 11–15 MB.

**Wnioski.**

- **Przeciąganie**, czyli interakcja, przy której przycięcie najbardziej przeszkadza, mieści się w budżecie 16,7 ms także przy 4× (p95 10 ms).
- **Druk 4 linii z pełnym stojakiem** przy 4× ma średnio 10 ms na klatkę, ale p95 26 ms. Na średnim telefonie oznacza to 2–4 klatki po ~30 fps w chwili uderzenia prasy. Ten moment maskuje potrząśnięcie ekranu i stempel, więc jest to akceptowalne dla „ciężkiego” efektu. Przy 6× pojawiają się pojedyncze zadania ~60 ms, czyli słaby telefon odczuje szarpnięcie przy największych drukach. Dlatego poziom `low` ma limit 150 cząstek i rozdzielczość 1,5×, a tryb „Ogranicz ruch” usuwa koszt prawie całkowicie.
- Profil CPU (`Profiler` CDP, 4×, build deweloperski) nie ma jednego dominującego miejsca w JS. Czas rozkłada się na tworzenie obiektów efektów, pomiar tekstu dla wylatujących liczb, budowę geometrii `Graphics` i węzły audio. Największą pozycją jest „(program)”, czyli kod natywny (głównie wywołania WebGL i serializacja bufora poleceń).

**Czego ten pomiar nie mówi.** WebGL działa tu na SwiftShaderze, czyli programowo na CPU. Dlatego:

- odstępy `requestAnimationFrame` (66–120 ms) i FPS z tej maszyny nic nie znaczą dla telefonu;
- nie zmierzono wypełnienia pikseli (fill-rate) GPU telefonu, kosztu kompozycji WebView ani dławienia termicznego.

To trzeba sprawdzić na urządzeniu (§3).

## 3. Pomiar na prawdziwym telefonie (do zrobienia przed publikacją)

1. Zainstaluj debug APK (README → „Instalacja na telefonie”). Debug build ma włączone debugowanie WebView.
2. Na komputerze otwórz `chrome://inspect` → *PRESS* → **inspect**. W konsoli:
   ```js
   location.search = '?debug=1'          // po przeładowaniu window.__press jest dostępne
   __press.skipAnimations(false); __press.resetFrameStats()
   // …zagraj 2–3 zlecenia…
   __press.frameStats()                  // { avg, p95, n } — koszt klatki w ms
   ```
3. W tej samej karcie DevTools: zakładka **Performance** → nagraj 10 s gry z dużymi drukami. Szukaj zadań > 16 ms na wątku głównym i klatek oznaczonych jako „Dropped”.
4. Systemowo: `adb shell dumpsys gfxinfo pl.zeprzalka.press framestats` po minucie gry pokazuje udział klatek > 16 ms (WebView rysuje przez RenderThread aplikacji).
5. Telefony referencyjne do testu zamkniętego:
   - klasa średnia, np. Galaxy A35/A55 lub Pixel 6a;
   - klasa niska z 3–4 GB RAM, np. Galaxy A15 lub Redmi 12 (sprawdź, czy wybierany jest poziom `low`).

Progi akceptacji: p95 kosztu klatki ≤ 12 ms w zwykłej grze i ≤ 25 ms w ciągu 0,5 s po druku 4 linii, a w `gfxinfo` < 5% klatek „janky” przez minutę gry.

## 4. Możliwe dalsze optymalizacje (jeśli pomiar na telefonie tego wymaga)

- Pula obiektów dla cząstek, kopii komórek i wylatujących liczb, żeby nie tworzyć i nie niszczyć ich przy każdym druku.
- Wylatujące liczby jako `BitmapText` zamiast `Text`: bez pomiaru i wgrywania tekstury canvasu przy każdym zdarzeniu.
- Rozłożenie startu efektów druku na 2 klatki: najpierw stempel i błysk, w następnej cząstki.
- Ostrzejsze limity dla poziomu `mid` (np. 250 cząstek), jeśli średnie telefony przycinają.
