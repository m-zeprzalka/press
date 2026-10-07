# PRESS — plan produkcji

Każdy etap kończy się commitem i zielonymi testami. Kryteria akceptacji są sprawdzalne (komenda lub test).

| Etap | Zakres | Kryteria akceptacji |
|---|---|---|
| **0. Projekt** | `docs/GDD.md`, `docs/PLAN.md`, przegląd projektu (krytycy: balans, UX/dostępność, monetyzacja/polityki, technika) | GDD zawiera pętlę, punktację, wszystkie matryce, zlecenia, progi, monetyzację, UX, art direction; decyzje z uzasadnieniem |
| **1. Rdzeń logiki + testy** | szkielet Vite+TS strict, ESLint/Prettier; `src/core`: rng, bitboard, plansza, katalog klocków, generator z gwarancją układalności, punktacja z dziennikiem zdarzeń, matryce (32), zlecenia i utrudnienia, silnik runu (stan JSON, akcje, zdarzenia), wyzwanie dnia, zapis/wczytanie, meta (statystyki, osiągnięcia, odblokowania) | `npm test` zielone, pokrycie `src/core` ≥ 98% linii/funkcji; test właściwości generatora (10k tac układalnych); determinizm (ten sam seed → ten sam przebieg) |
| **2. Render i sterowanie** | PixiJS: tekstury proceduralne (papier, farba z rastrem, rejestr), plansza, taca, przeciąganie z offsetem nad palcem, cień + podświetlenie linii, magnes; DOM HUD; layout z safe-area; font PRESS Display | gra grywalna w przeglądarce (mysz i dotyk); `npm run build` zielone |
| **3. Run, zlecenia, matryce (UI)** | ekrany: tytuł, karta edycji/zlecenia, oferta (przeładowanie, pominięcie, wymiana), szczegóły/sprzedaż/przestawianie matryc, pauza, wynik, zwycięstwo, kolekcja, statystyki/osiągnięcia, ustawienia; i18n EN/PL; zapis i wznowienie | pełny run możliwy do rozegrania; wznowienie po przeładowaniu strony |
| **4. Symulator i balans** | bot (beam search), runner wielowątkowy, eksperymenty wymuszonego wyboru, generator raportu; iteracje progów i wartości matryc | `npm run sim` → `docs/balance-report.md` z ≥ 10 000 runów; cele z GDD §19 spełnione; GDD §19.1 uzupełniony |
| **5. Juice, dźwięk, samouczek** | stempel prasy, rozbryzg, płatki, plamy, liczniki Balatro, shake, pieczątka zatwierdzenia; haptyka; syntezator SFX + muzyka generatywna, suwaki; samouczek 3-krokowy; tryb daltonistów; ogranicz ruch | ręczna weryfikacja + test e2e samouczka |
| **6. Monetyzacja** | warstwa reklam (AdMob natywnie / symulacja web), zgoda UMP przed pierwszą reklamą, reguły interstitiali (testy jednostkowe), nagradzane: przeładowanie + dodruk; Billing „Bez reklam" (zakup, przywracanie, potwierdzanie), ekran | testy jednostkowe polityki reklam i uprawnień; build Androida z pluginami |
| **7. Capacitor, build, CI** | projekt Android (`pl.zeprzalka.press`, PRESS, portret, immersive, wstecz, haptyka, Preferences), ikony adaptacyjne, splash; `scripts/setup-android.sh`; debug APK lokalnie; GitHub Actions (APK na push, podpisany AAB na tag `v*`); PWA; `public/privacy.html`; `docs/RELEASE.md` | `./gradlew assembleDebug` zielone w sesji; workflow CI poprawny składniowo |
| **8. Dopracowanie i e2e** | pomiar wydajności (`docs/performance.md`), poprawki, e2e Playwright z emulacją telefonu (samouczek, pełny run, ekran wyniku), README, przegląd kodu, PR | `npm test`, `npm run build`, `npm run e2e`, debug APK — wszystko zielone |

## Zasady pracy
- Logika gry wyłącznie w `src/core` (bez DOM, bez Pixi) — testowalna i używana przez symulator.
- Każda zmiana zasad gry → aktualizacja GDD (§20 Dziennik decyzji).
- Wartości balansu w jednym miejscu: `src/core/config/balance.ts`.
- Teksty wyłącznie przez i18n (`src/ui/i18n`).
