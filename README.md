# PRESS

**Drukarska układanka-roguelite na Androida.** Rdzeń to układanka 8×8 w stylu Block Blast: przeciągasz klocki, a pełny wiersz lub kolumna idzie do druku. Na to nałożona jest warstwa roguelite w stylu Balatro: kolejne **zlecenia** z nakładem do wybicia w limicie arkuszy, **matryce** zmieniające zasady punktacji i **utrudnienia** co trzecie zlecenie. Oprawa to risograf: papier, farby fluo, przesunięty rejestr i raster. Wszystkie grafiki, font i dźwięki są generowane z kodu w tym repozytorium.

- Projekt gry, wszystkie liczby i dziennik decyzji: [`docs/GDD.md`](docs/GDD.md)
- Plan etapów i kryteria akceptacji: [`docs/PLAN.md`](docs/PLAN.md)
- Raport balansu z symulatora: [`docs/balance-report.md`](docs/balance-report.md)
- Pomiary wydajności: [`docs/performance.md`](docs/performance.md)
- **Wydanie w Google Play** (klucz, sekrety, test zamknięty, opisy sklepu, AdMob): [`docs/RELEASE.md`](docs/RELEASE.md)
- Polityka prywatności (EN/PL): [`public/privacy.html`](public/privacy.html)

## Szybki start

Wymagania: Node 22+, npm 10+.

```bash
npm ci
npm run dev          # http://localhost:5173 — działa też z telefonu w tej samej sieci (--host)
```

Przydatne parametry adresu: `?seed=abc` (powtarzalny run), `?debug=1` (API `window.__press` w konsoli).

| Komenda | Co robi |
|---|---|
| `npm test` | testy jednostkowe (Vitest): rdzeń, platforma, UI, audio |
| `npm run coverage` | pokrycie `src/core` (progi 98% linii/funkcji, 92% gałęzi) |
| `npm run typecheck` | TypeScript strict dla aplikacji, rdzenia i skryptów |
| `npm run lint` | ESLint + Prettier |
| `npm run build` | typecheck + build produkcyjny (PWA) do `dist/` |
| `npm run e2e` | Playwright na emulowanych telefonach (Pixel 7, mały telefon PL) |
| `npm run sim -- run --runs 10000 --out /tmp/sim` | symulator: bot rozgrywa runy (szczegóły: `src/sim/cli.ts`) |
| `npm run sim -- report --in /tmp/sim --out docs/balance-report.md` | raport balansu |
| `npm run build:font` / `build:textures` / `build:icons` | regeneracja fontu, atlasu tekstur i ikon (wyniki są w repo) |

## Instalacja na telefonie (APK)

**Z GitHub Actions (najprościej).** Każdy push buduje debug APK.

1. Na GitHubie otwórz **Actions → Android → ostatnie uruchomienie** i pobierz artefakt `press-debug-<numer>`.
2. Rozpakuj ZIP i skopiuj plik `.apk` na telefon.
3. Otwórz plik na telefonie i zezwól na instalację z tego źródła. Ta wersja ma testowe reklamy Google.

Możesz też zainstalować przez USB (włączone debugowanie USB):

```bash
gh run download <RUN_ID> --name press-debug-<numer> --dir /tmp/press-apk
adb install -r /tmp/press-apk/app-debug.apk
```

**Lokalnie.** Potrzebujesz Android SDK (platforma 36, build-tools 36) i JDK 21. Skrypt [`scripts/setup-android.sh`](scripts/setup-android.sh) instaluje SDK.

```bash
./scripts/setup-android.sh          # jednorazowo; ustawia android/local.properties
npm run android:debug               # build web + cap sync + ./gradlew assembleDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**PWA.** `npm run build && npm run preview`, a potem otwórz adres w Chrome na Androidzie i wybierz „Dodaj do ekranu głównego”. Gałąź `main` publikuje się też na GitHub Pages (`.github/workflows/pages.yml`).

## Wydanie

Tag `v*` (np. `v1.0.0`) buduje w CI **podpisany release AAB** z kluczem z GitHub Secrets. Klucz nigdy nie trafia do repozytorium: `*.jks`, `*.keystore` i `keystore.properties` są w `.gitignore`. Cała ścieżka, czyli klucz, sekrety, konto Play Console, test zamknięty (12+ testerów przez 14 dni), opisy sklepu EN/PL, formularz Data safety i podmiana testowych ID AdMob na produkcyjne, jest opisana w [`docs/RELEASE.md`](docs/RELEASE.md).

## Architektura

```
src/core/      czysta logika gry bez DOM (deterministyczna, 99% pokrycia): plansza na bitboardach,
               generator tac z gwarancją układalności, punktacja z dziennikiem zdarzeń, 32 matryce,
               zlecenia/utrudnienia, silnik runu (stan JSON → wznowienie), meta, zapisy A/B z CRC
src/sim/       bot (beam search) + wielowątkowy runner + raport balansu; używa tego samego src/core
src/render/    scena PixiJS 8 (render na żądanie), wejście dotykowe, efekty druku, układ ekranu
src/ui/        ekrany DOM (menu, oferta, wyniki…), i18n EN/PL, ikony SVG
src/game/      kontroler gry: łączy silnik, scenę, ekrany, samouczek, reklamy, zapisy
src/audio/     synteza Web Audio: efekty i muzyka generatywna
src/platform/  Capacitor/web: zapisy, haptyka, wstecz, cykl życia, AdMob + UMP, Play Billing, PWA
android/       projekt Capacitor (pl.zeprzalka.press) + plugin PressSystem (immersive, gesty)
scripts/       generatory fontu, tekstur, ikon; instalacja Android SDK
e2e/           testy Playwright
```

Dlaczego PixiJS, a nie canvas 2D: uzasadnienie jest w GDD §18. W skrócie: efekty druku z setkami cząstek i plam przy 60 fps na średnim Androidzie, batching WebGL i obsługa utraty kontekstu GL.

## Licencja i zasoby

Kod i zasoby © właściciel repozytorium, wszystkie prawa zastrzeżone. Gra nie używa cudzych grafik, fontów ani dźwięków: font „PRESS Display”, tekstury, ikony i audio są generowane przez skrypty z `scripts/` i `src/audio/`.
