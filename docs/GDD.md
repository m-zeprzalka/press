# PRESS — Game Design Document

> Wersja: **1.1** (po przeglądzie eksperckim: balans, UX/dostępność, monetyzacja/polityki, technika) · Platforma: Android (Google Play) + PWA (testy)
> Język dokumentu: polski (terminy w grze w obu wersjach: **PL / EN**). Kod i komentarze: angielski.
> Każda decyzja ma uzasadnienie (**Dlaczego:**). Pełna historia: [§20 Dziennik decyzji](#20-dziennik-decyzji).
> Wszystkie liczby balansu mieszkają w `src/core/config/balance.ts` i `src/core/matrices.ts` (`MX`). Wartości w tym dokumencie odpowiadają stanowi po ostatniej iteracji balansu (§19.1).

---

## Spis treści
1. [Wizja i filary](#1-wizja-i-filary) · 2. [Pętla](#2-pętla-rozgrywki) · 3. [Plansza, klocki, sterowanie](#3-plansza-klocki-i-sterowanie) · 4. [Generator](#4-generator-klocków-i-uczciwość) · 5. [Punktacja](#5-druk-i-punktacja) · 6. [Run](#6-run-edycje-i-zlecenia) · 7. [Utrudnienia](#7-zlecenia-specjalne-utrudnienia) · 8. [Matryce](#8-matryce) · 9. [Oferta, sprzedaż, dodruk](#9-oferta-przeładowanie-sprzedaż-dodruk) · 10. [Meta](#10-meta-wyzwanie-dnia-osiągnięcia-statystyki) · 11. [Monetyzacja](#11-monetyzacja) · 12. [UX](#12-ux-i-ekrany) · 13. [Samouczek](#13-samouczek-i-wskazówki) · 14. [Art direction](#14-art-direction) · 15. [Juice](#15-juice-animacje-haptyka) · 16. [Dźwięk](#16-dźwięk-i-muzyka) · 17. [Dostępność, języki](#17-dostępność-i-lokalizacja) · 18. [Technologia](#18-technologia-i-architektura) · 19. [Balans](#19-balans-i-symulator) · 20. [Decyzje](#20-dziennik-decyzji)

---

## 1. Wizja i filary

**Pitch:** *Block Blast spotyka Balatro w drukarni risograficznej.* Układasz czcionki na formie 8×8, pełne linie idą do druku, a matryce zmieniają zasady liczenia tak, że wyniki rosną do milionów.

**Gracz docelowy:** dorośli (18+) fani gier logicznych w stylu Block Blast / 1010! (krótkie sesje, jedna ręka, portret) i fani roguelite/deckbuilderów (Balatro). **Target audience w Play: 18+, „Appeals to children: No"** (głębia roguelite, wyniki w milionach, brak postaci dla dzieci). **Dlaczego:** unikamy polityki Families (zmienia konfigurację reklam) i wieku zgody cyfrowej 16 lat w PL.

| # | Filar | W praktyce |
|---|---|---|
| F1 | **Dotykalna drukarnia** | Każda akcja brzmi i wygląda jak maszyna: stempel, farba, papier, raster. |
| F2 | **Czytelna głębia** | Rdzeń zrozumiały w 10 s; głębia z matryc i ich kolejności. |
| F3 | **Uczciwość i szacunek** | Każda taca układalna. Zero reklam w trakcie gry i w pierwszej sesji. Reklamy nagradzane zawsze z wyboru. Wyzwanie dnia bez przewag płatnych. |
| F4 | **Krótko, ale głęboko** | Zlecenie 1–3 min, run 10–35 min, zapis po każdym ruchu. |

---

## 2. Pętla rozgrywki

```
Run
 └─ Edycja 1..8 (3 zlecenia; 3. = specjalne z utrudnieniem, znanym od początku edycji)
     └─ Zlecenie: zdobądź NAKŁAD w 20 ARKUSZACH (1 arkusz = 1 ułożony klocek)
         └─ Taca: 3 klocki → ułóż wszystkie → nowa taca
             └─ Ułożenie → pełne rzędy/kolumny idą DO DRUKU → ODBITKI × MNOŻNIK → +NAKŁAD
     ├─ Nakład wyrobiony → oferta: 1 z 3 (4) MATRYC lub pominięcie
     ├─ Brak arkuszy → OSTATNIA SZANSA (sprzedaj matrycę za arkusze) → albo koniec
     └─ Zacięcie prasy (nic się nie mieści) → koniec (raz na run: DODRUK)
Po zleceniu 24 → „Pełny nakład" (zwycięstwo) → koniec albo tryb bez końca.
```

---

## 3. Plansza, klocki i sterowanie

### 3.1 Forma 8×8
Pole: puste · **farba** (5 kolorów) · **ślepy tłok** (*blind*: biały wytłok, 0 odbitek; z „Braku farby") · **ołów** (*lead*: zalegający skład, czyści się normalnie, 0 odbitek) · **nit** (*jam*: trwały, blokuje ułożenie i **blokuje druk swojego rzędu i kolumny**).
Forma jest czyszczona na początku każdego zlecenia. **Dlaczego (D1):** zlecenie to samodzielna runda; bezpieczne utrudnienia; brak spirali śmierci.

### 3.2 Klocki (czcionki)
Poliomina 1–9 pól, bez obracania, jeden kolor na klocek. 37 kształtów (orientacje osobno): kropka; I2 ×2; I3 ×2; L3 ×4; I4 ×2; O4; T ×4; L ×4; J ×4; S ×2; Z ×2; I5 ×2; V5 ×4; prostokąt 3×2/2×3; kwadrat 3×3. Wagi w `src/core/pieces.ts`; średni rozmiar ≈ 3,8 pola.

### 3.3 Taca i schowek
- **3 stałe sloty** — klocki nie przesuwają się po ułożeniu sąsiadów. Nowa taca dopiero po ułożeniu wszystkich.
- Mniej niż 3 arkusze → tyle klocków, ile arkuszy; pusty slot pokazuje przekreślony arkusz. „Wąska kaszta" → slot 3 z ikoną blokady.
- **Jeden rozmiar podglądu dla wszystkich klocków:** `trayCell = min(18 dp, slotInnerW/5, slotInnerH/5)`, więc względne rozmiary są porównywalne (I5 mieści się w slocie).
- **Schowek (matryca Kaszta):** osobny slot 64 dp z lewej strony tacy. Odłożenie: upuść klocek na schowek (hit-test po pozycji palca ±16 dp). Zajęty schowek → zamiana z wolnym slotem tacy. Odłożenie nie kosztuje arkusza; max 1 odłożenie na ułożenie; położenie ze schowka kosztuje 1 arkusz. Nowa taca przychodzi, gdy sloty tacy są puste (niezależnie od schowka). Schowek przetrwa zlecenia i dodruk. Sprawdzenie zacięcia uwzględnia klocek ze schowka **i ucieczkę przez schowek**: gdy na tacy został jeden klocek, który nigdzie nie pasuje, a schowek jest pusty i odłożenie dozwolone, to nie jest zacięcie — odłożenie go daje nową (układalną) tacę; gra pokazuje wtedy podpowiedź „Nic nie pasuje — upuść ostatni klocek na Kasztę” (D26).

### 3.4 Sterowanie
**Przeciąganie (domyślne):**
- `pointerdown` w slocie (cały slot = cel ≥ 84 dp, odsunięty ≥ 24 dp od krawędzi ekranu — strefy gestu „wstecz") → `setPointerCapture`; ignorujemy kolejne wskaźniki do puszczenia wszystkich.
- Klocek tweenuje (90 ms; natychmiast przy „Ogranicz ruch") z rozmiaru tacy do rozmiaru pól planszy, **wyśrodkowany poziomo na palcu**, dolna krawędź `max(1,25 pola, 48 dp)` nad punktem dotyku. Ruch 1:1.
- **Cień** = dokładnie miejsce lądowania: wypełnienie 35% + przerywany kontur tuszem 2 dp. Linie, które się wydrukują: ramka tuszem 2 dp wokół całej linii + 12% tintu (kolor i drżenie to dodatki).
- **Magnes z histerezą:** preferuj dokładną (zaokrągloną) pozycję, jeśli poprawna; w innym razie najbliższa poprawna w promieniu 1 pola. Bieżący cień jest trzymany, dopóki surowa pozycja jest ≤ 0,75 pola od niego, chyba że nowy kandydat jest bliżej o ≥ 0,25 pola. **Dlaczego:** bez histerezy cień migocze między dwoma miejscami.
- Nad planszą bez poprawnego miejsca: klocek 60% krycia + znaczek ✕.
- **Upuszczenie = położenie dokładnie w cieniu.** Brak cienia → sprężynowy powrót (bez kary).
- `pointercancel`, `visibilitychange`, resize/obrót/fold, koniec zlecenia w trakcie przeciągania → anulowanie, powrót, arkusz nie jest zużyty.
- Stuknięcie bez ruchu (< 8 dp): mrugnięcie klocka + podpowiedź „Przeciągnij na formę".

**Stuknięcia (Ustawienia → Sterowanie: Stuknięcia)** — alternatywa dla osób z ograniczoną precyzją: stuknij klocek (zaznaczenie, ramka 3 dp) → stuknij pole planszy (cień zakotwiczony najbliżej) → stuknij cień lub przycisk „Połóż" (56 dp). Oba tryby wołają tę samą akcję rdzenia `place(slot, x, y)`.

---

## 4. Generator klocków i uczciwość

> **Gwarancja:** każda **rozdana taca** jest w całości układalna z bieżącej formy — istnieje kolejność i ustawienie wszystkich jej klocków (z czyszczeniem linii po drodze). Gwarancja dotyczy tacy w chwili rozdania; odłożenie do schowka jest decyzją gracza.

`dealTray` (strumień RNG `tray:(zlecenie, nrTacy)`):
1. Losuj kształty wg wag (×3 dla 5–9 pól przy „Wielkim formacie", który usuwa też kropkę i I2), potem kolory (waga koloru 1,0 + 1,0 za każdą aktywną matrycę farby).
2. **Szybka akceptacja:** jeśli istnieje rozłączne ustawienie wszystkich klocków bez żadnego czyszczenia — taca jest układalna w każdej kolejności (czyszczenia tylko zwalniają pola).
3. W przeciwnym razie DFS po kolejnościach i pozycjach (bitboard, prekomputowane maski ułożeń, numeryczne klucze memo, przycinanie, **budżet 4 000 węzłów na próbę / 16 000 na rozdanie** — przekroczenie = „nieudowodniona" → odrzucenie).
4. Do 12 prób; od 7. wagi faworyzują klocki ≤ 3 pól.
5. Fallback konstrukcyjny: klocek po klocku z puli mieszczących się (układalność z konstrukcji). Kropka mieści się zawsze (nieblokowany pełny rząd zostałby wydrukowany).
- Kształty, które **nigdy** nie zmieszczą się na formie z samymi nitami, mają wagę 0 w tym zleceniu.
- Raport symulatora pokazuje rozkład prób, odsetek fallbacku i p99 czasu rozdania (cel ≤ 4 ms na urządzeniu referencyjnym).
**Dlaczego (D2):** przegrana przez zacięcie wynika z decyzji gracza, nigdy z losu.

---

## 5. Druk i punktacja

### 5.1 Druk
Po ułożeniu wszystkie pełne rzędy i kolumny (bez nitów; przy „Prasie poziomej" tylko rzędy) drukują się jednocześnie i znikają. Ułożenie bez druku = „suche" (0 punktów).

### 5.2 Wzór
**WYNIK DRUKU = ⌊ODBITKI × MNOŻNIK⌋**, a **NAKŁAD** zlecenia to suma wyników druku.

### 5.3 SERIA (streak) — liczona w liniach
- Druk L linii: **SERIA += L przed liczeniem**; bonus mnożnika = `max(0, SERIA − 1)`.
- Seria przetrwa **3 suche ułożenia** (HUD: krople ●●●, każda sucha wysycha; druk napełnia wszystkie); czwarte suche ułożenie zeruje serię.
- SERIA zeruje się na starcie zlecenia (wyjątek: Taśmociąg). „Mokra farba": SERIA = 0, matryce czytające serię widzą 0.
- HUD: „SERIA 5 (+4) ●●○".
**Dlaczego (D5/D6, przegląd balansu):** liczenie serii w drukach premiowało pojedyncze linie (8 singli 2880 > 4 dublety 2240). W liniach: 8 singli **2880** < 4 dublety **3840** < 2 quady **5760** — główna umiejętność (multi-linie) jest nagradzana.

### 5.4 Fazy liczenia (deterministyczne, testowane fiksturami)
| Faza | Co się dzieje | Kto |
|---|---|---|
| 0 | SERIA += L | silnik |
| 1. Pola | dla każdej linii (rzędy z góry, kolumny od lewej), dla każdego pola: **+10 odbitek** za pole z farbą (ślepy tłok/ołów: 0); efekty „na pole" matryc (tylko odbitki) | matryce `cell` |
| 2. Linie | efekty „na linię" matryc (tylko odbitki i mnożniki odbitek linii, np. Prasa kolumnowa ×2 sumy linii) | matryce `line` |
| 3. Baza | **MNOŻNIK = L + max(0, SERIA−1) + 2 × liczba linii jednobarwnych** | silnik |
| 4. Druk | efekty matryc **w kolejności stojaka** — wszystkie +MNOŻNIK i ×MNOŻNIK (oraz płaskie +odbitki) | matryce `print` |
| 5. Wynik | ⌊ODBITKI × MNOŻNIK⌋ | silnik |
| 6. Wzrost | liczniki matryc rosną **po** wyniku; wyłączone matryce nie rosną | matryce `afterPrint` |

- Pole na przecięciu rzędu i kolumny liczy się w każdej linii osobno (każda linia idzie pod prasę osobno).
- Linia jednobarwna: wszystkie 8 pól to farba jednego koloru.
- Kolejność matryc ma znaczenie (+ przed ×). Przestawianie: przeciągnięcie w stojaku lub przyciski ◀ ▶ w szczegółach.

### 5.5 Prezentacja (kontrakt rdzeń ↔ render)
- `place()` zwraca zdarzenia; dziennik druku (`cell`, `p`, `lx`, `m`, `x`, źródło) spełnia niezmiennik `fold(events) = wynik` (test właściwości).
- Plansza zawsze odzwierciedla logikę; wyczyszczone pola przechodzą do warstwy FX jako odłączone sprite'y.
- **Kolejka prezentacji:** nowy druk (lub stuknięcie licznika) przewija bieżący do wartości końcowych w ≤ 150 ms. Czas zdarzenia = `clamp(budżet/n, 16, 120) ms`, budżet zależny od ustawienia „Szybkość liczników" (Normalna 1,2 s / Szybka 0,5 s / Natychmiast); > 40 zdarzeń → scalanie pól w sumy linii. Pasek nakładu aktualizuje się od razu, animowana jest tylko lecąca liczba.
- Gdy zlecenie się kończy (wygrana/przegrana), wejście blokuje się w tej samej klatce; przejście czeka na kolejkę (≤ 1,5 s).
- Stuknięcie licznika po druku → arkusz „Ostatni druk" z rozpiską (np. „R3: 8×10=80 · Fluo róż +40 … MNOŻNIK 2+2+3 ×1,75 = 12,25 → 1 960").

---

## 6. Run: edycje i zlecenia

### 6.1 Struktura
8 edycji × 3 zlecenia = 24. Zlecenie 3 każdej edycji jest specjalne. **Wygrana zlecenia:** nakład ≥ próg po rozliczeniu druku → natychmiastowy koniec zlecenia. Kolejność po ułożeniu: druk → nakład → arkusze (→ Ostatnia szansa) → zacięcie. **Zwycięstwo** po zleceniu 24; potem koniec albo **tryb bez końca** (nakład dalej rośnie wg krzywej, od edycji 7 każde specjalne ma 2 utrudnienia). **Wynik runu** = suma nakładów.

### 6.2 Krzywa nakładu
`Q(j) = zaokr2(1000 × 1,38^j)` (przed balansem: 400 × 1,30^j) dla zlecenia j = 0…23 (zaokrąglenie do 2 cyfr znaczących), liczone mnożeniem iteracyjnym (deterministycznie). Zlecenie specjalne: `Q(j) × k_specjalne × Π k_utrudnienia`. Niezmiennik testowany: `Q(j+1)/Q(j) ≥ 1,15` dla kolejnych zwykłych. Tryb bez końca: dalej ×1,38 na zlecenie. Wartości po balansie: §19.1.
**Dlaczego:** jedna gładka krzywa bez „piły" na granicach edycji (przegląd balansu).

### 6.3 Premia terminowa
Liczona z **arkuszy zużytych względem bazowych** zlecenia (bonusowe arkusze się nie liczą): ≤ 60% zużytych (≤ 12 z 20, ≤ 8 z 14) → oferta ma **4 karty**; ≤ 40% → dodatkowo co najmniej jedna karta rzadka/legendarna. Licznik ARKUSZE pokazuje znaczniki obu progów.
**Dlaczego:** brak waluty — wydajność nagradzana lepszym wyborem; liczenie „zużytych bazowych" zamyka pętlę sprzedaż→arkusze→premia.

### 6.4 Ostatnia szansa
Brak arkuszy, nakład niewyrobiony, w stojaku jest matryca o wartości sprzedaży > 0 → stan **Ostatnia szansa**: sprzedaj (arkusze wracają do gry) albo „Zakończ zlecenie".

---

## 7. Zlecenia specjalne (utrudnienia)

| ID | PL / EN | Efekt | Od edycji | k nakładu* |
|---|---|---|---|---|
| `rush` | Krótki termin / Rush Job | 14 arkuszy zamiast 20 | 1 | 0,80 |
| `big_format` | Wielki format / Large Format | duże klocki ×3, bez kropki i I2 | 1 | 1,00 |
| `jam` | Nity w formie / Riveted Forme | 2/3/4 nity (e1–2/e3–5/e6+), max 1 na rząd/kolumnę, z dala od krawędzi; **rząd i kolumna z nitem nie drukują się** | 1 | 0,85 |
| `wet_ink` | Mokra farba / Wet Ink | SERIA nie działa | 3 | 0,80 |
| `out_of_ink` | Brak farby / Out of Ink | **najcięższy kolor gracza** (remis: seed) wychodzi jako ślepy tłok; pokazany na karcie edycji | 3 | 0,85 |
| `leftover` | Zalegający skład / Leftover Type | 8/10/12 pojedynczych pól ołowiu (bez sąsiadów, ≤ 2 na linię) | 3 | 0,90 |
| `failure` | Awaria matrycy / Plate Failure | jedna matryca wylosowana na starcie zlecenia (waga: legendarna 3, rzadka 2, zwykła 1) nie działa; losowanie po kolejności nabycia (nie po stojaku), więc przestawianie przed startem zlecenia nie wpływa na wybór (D27); sprzedaż nie przenosi awarii | 3 | 0,90 |
| `short_tray` | Wąska kaszta / Short Tray | taca 2 klocki | 3 | 0,90 |
| `rows_only` | Prasa pozioma / Rows Only | drukują się tylko rzędy | 5 | 0,75 |

\* wartości startowe; ostateczne w §19.1. Cel symulatora: każde utrudnienie obniża medianę wyniku bota o 15–40% względem zwykłego zlecenia przy tym samym progu.
- Edycje 7+ : **2 zgodne utrudnienia**. Wykluczenia: {rush, short_tray}, {big_format, short_tray}, {jam, leftover}, {wet_ink, rush}, {jam, rows_only}; bez duplikatów.
- Wyłączona matryca: nie jest pustym slotem (Szablon), nie rośnie, Lustro nic z niej nie kopiuje; przy wyłączonej Ryzie arkusze nie są przyznawane; wyłączona Kaszta blokuje schowek.
**Dlaczego (przegląd balansu):** zlecenia są ograniczone arkuszami, nie miejscem — wszystko, co „wypełnia" formę, było buffem. Nity blokujące linie i pojedynczy ołów tworzą prawdziwe dziury.

---

## 8. Matryce

### 8.1 Zasady
- 5 slotów; działanie od lewej (fazy §5.4). Rzadkości: zwykła/rzadka/legendarna; szanse w ofercie 64/30/6 (od edycji 4: 58/32/10).
- Unikalne w runie; w ofercie bez duplikatów i **maks. 1 matryca farby**; wyczerpana pula rzadkości → niższa rzadkość.
- Sprzedana matryca wraca do puli z wyzerowanym licznikiem.
- Pula startowa **22**, odblokowania **10** (§10.2). Pula runu jest zamrażana na starcie runu (odblokowania działają od następnego runu).

### 8.2 Pełna lista
Faza: `pole` / `linia` / `druk` / `pasywna` / `wzrost`.

**Zwykłe (15)** — wszystkie startowe

| ID | PL / EN | Efekt | Faza |
|---|---|---|---|
| `ink_pink` … `ink_blue` (5) | Fluo róż / Fluo Pink · Pomarańcz / Orange · Żółć / Yellow · Morska zieleń / Teal · Błękit / Blue | +20 odbitek za każde pole swojego koloru w druku; kolor pojawia się częściej (+1,0 wagi) | pole + pasywna |
| `proof` | Odbitka próbna / Proof Print | +3 mnożnika | druk |
| `guillotine` | Gilotyna / Guillotine | +50 odbitek za każdą linię | linia |
| `roller` | Wałek / Ink Roller | +6 mnożnika przy druku 2+ linii | druk |
| `margins` | Margines / Margins | +120 odbitek za każdą linię przy krawędzi | linia |
| `petit` | Petit | +5 mnożnika, gdy drukujący klocek ma ≤ 3 pola | druk |
| `poster` | Afisz / Poster Type | +120 odbitek, gdy drukujący klocek ma ≥ 5 pól | druk |
| `ream` | Ryza / Ream | +3 arkusze w każdym zleceniu; **sprzedaż: 0** | pasywna |
| `numerator` | Numerator | +1 mnożnika za każdy poziom SERII | druk |
| `scrap` | Makulatura / Scrap Paper | każde suche ułożenie odkłada +30 odbitek (maks. 300); następny druk je wypłaca; bank zeruje się na starcie zlecenia | wzrost + druk |
| `first_impression` | Pierwsza odbitka / First Impression | ×2 mnożnika dla druków w pierwszych 8 arkuszach zlecenia | druk |

**Rzadkie (12)**

| ID | PL / EN | Efekt | Faza | Start/odbl. |
|---|---|---|---|---|
| `column_press` | Prasa kolumnowa / Column Press | wydrukowane kolumny: ×2 odbitek linii | linia | start |
| `monotype` | Monotypia / Monotype | ×2 mnożnika za każdą linię jednobarwną | druk | start |
| `journeyman` | Czeladnik / Journeyman | +X mnożnika; X = 1, +1 po każdym wyrobionym zleceniu | druk + wzrost | start |
| `archive` | Archiwum / Archive | +X odbitek do każdej linii; X rośnie o +1 za każdą wydrukowaną linię | linia + wzrost | start |
| `ink_well` | Kałamarz / Ink Well | +X mnożnika; X rośnie o +2 za każdą linię jednobarwną | druk + wzrost | start |
| `registration` | Pasery / Registration Marks | +2 mnożnika za każdy różny kolor w druku | druk | odbl. |
| `crossmark` | Krzyżyk / Crossmark | +3 mnożnika za każde przecięcie rzędu i kolumny | druk | odbl. |
| `type_case` | Kaszta / Type Case | schowek na 1 klocek (§3.3) | pasywna | odbl. |
| `clean_sheet` | Czysta forma / Clean Sheet | ×4 mnożnika, gdy druk 2+ linii zostawia pustą formę (nity ignorowane) | druk | odbl. |
| `stencil` | Szablon / Stencil | ×(1 + 0,5 × puste sloty), siebie nie licząc (sam: ×3; pełny stojak: ×1) | druk | odbl. |
| `momentum` | Rozpęd / Momentum | ×(1 + 0,1 × SERIA) mnożnika | druk | odbl. |
| `conveyor` | Taśmociąg / Conveyor | seria przetrwa +1 suche ułożenie; 50% SERII przechodzi do następnego zlecenia | pasywna | odbl. |

**Legendarne (5)**

| ID | PL / EN | Efekt | Faza | Start/odbl. |
|---|---|---|---|---|
| `gutenberg` | Gutenberg | ×X mnożnika; X = 1,5, +0,25 po każdym wyrobionym zleceniu | druk + wzrost | start |
| `hydraulic` | Prasa hydrauliczna / Hydraulic Press | ×3 mnożnika dla druków 3+ linii | druk | start |
| `golden_type` | Złota czcionka / Golden Type | każde pole w każdej linii ma 1/4 szansy wydrukować się ponownie (z efektami „na pole"); każde powtórzenie: ×1,1 mnożnika | pole + druk | odbl. |
| `mirror` | Lustro / Mirror Plate | kopiuje efekty drukowe matrycy po prawej | wg sąsiada | odbl. |
| `split_fountain` | Druk irysowy / Split Fountain | ×1,5 mnożnika za każdą linię z 3+ kolorami | druk | odbl. |

### 8.3 Reguły Lustra (Mirror)
1. Na swojej pozycji w stojaku uruchamia efekty sąsiada z prawej we wszystkich fazach, w których sąsiad działa (pole/linia/druk).
2. Czyta bieżący licznik sąsiada; nigdy go nie zwiększa.
3. Nie kopiuje efektów pasywnych ani bankowania (Ryza, Kaszta, waga koloru, Taśmociąg, odkładanie Makulatury); kopiuje wypłatę Makulatury.
4. Kopia Złotej czcionki = druga, niezależna próba na pole (maks. 3 druki pola).
5. Warunki działają tak samo (np. Pierwsza odbitka). Lustra łańcuchują się w prawo.
6. Skrajnie prawe lub obok wyłączonej matrycy — karta wyszarzona „brak efektu".

### 8.4 Buildy
Monochrom (farba X + Monotypia + Kałamarz + Petit) · Tęcza (Pasery + Druk irysowy) · Wielka prasa (Wałek + Krzyżyk + Hydrauliczna + Afisz + Czysta forma) · Seria (Numerator + Rozpęd + Taśmociąg + Petit) · Skalowanie (Czeladnik + Archiwum + Gutenberg) · Geometria (Margines + Prasa kolumnowa) · Minimalizm (Szablon + 1–2 mocne) · Losowość (Złota czcionka + Lustro). Pula startowa zawiera co najmniej jeden kompletny zestaw: Monochrom, Wielka prasa (bez Krzyżyka), Seria (Numerator+Petit), Skalowanie, Geometria.

---

## 9. Oferta, przeładowanie, sprzedaż, dodruk

### 9.1 Oferta
- Pionowa lista kart na pełną szerokość (ikona 56 dp, nazwa ≤ 2 linie, opis ≤ 3 linie, rzadkość tekstem + styl ramki). Stuknięcie wybiera i rozwija; **„Weź" (56 dp)** zatwierdza. Na dole: „Pomiń · +3 arkusze", „Przeładuj". Panel „Następna edycja · zlecenie specjalne: …" po zleceniu specjalnym.
- Pełny stojak: tryb wymiany — karty stojaka pokazują „+N arkuszy", nowa matryca wchodzi na miejsce wymienionej; „Anuluj".
- **Przeładowanie:** 1 darmowe na run; potem reklama nagradzana: maks. 1 na ekran oferty i **3 na run**; przycisk reklamowy pojawia się dopiero po wykorzystaniu darmowego; licznik „Przeładowania: 0 darmowych · 2/3 za reklamę". Przeładowanie zachowuje liczbę kart i gwarancję rzadkiej.
- W wyzwaniu dnia: tylko 1 darmowe przeładowanie, bez reklamowych.

### 9.2 Sprzedaż
Stuknięcie karty w stojaku → arkusz szczegółów → „Sprzedaj · +N arkuszy" z „Cofnij" do następnego ułożenia lub 5 s. Wartość: zwykła **+1**, rzadka **+1**, legendarna **+2**, Ryza **0**. W trakcie zlecenia arkusze trafiają do bieżącego, między zleceniami — do następnego. Zablokowane tylko podczas tykania licznika (stuknięcie przewija licznik).

### 9.3 Dodruk (kontynuacja)
Raz na run (tylko tryb zwykły), po przegranej. **Pierwszy dodruk w życiu jest darmowy** („na koszt drukarni"), kolejne za reklamę nagradzaną (posiadacze „Bez reklam" — od razu).
- Po zacięciu: zdejmujemy zawartość 2 najpełniejszych rzędów i 2 najpełniejszych kolumn (remis → niższy indeks; nity zostają), nowa układalna taca.
- Po braku arkuszy: **+8 arkuszy**, SERIA zachowana. Ekran pokazuje brakującą różnicę nakładu.

---

## 10. Meta: wyzwanie dnia, osiągnięcia, statystyki

### 10.1 Wyzwanie dnia
- Seed: `PRESS-RRRR-MM-DD-r<wersjaZasad>` (data UTC ustalona w chwili startu runu). Pula matryc: **stała pula startowa 22** (niezależnie od odblokowań gracza). Reguła dnia: start z 1 wylosowaną matrycą zwykłą.
- **Bez dodruku i bez reklamowych przeładowań.** Podejścia: 1 darmowe + 1 dodatkowe za reklamę (posiadacze — od razu); liczy się najlepsze.
- Udostępnianie (Web Share / Capacitor Share, fallback schowek):
  ```
  PRESS · Wyzwanie dnia 2026-10-07 (r1)
  Zlecenia: 9/24 🟥🟧🟨🟩🟦🟥🟧🟨⬛
  Nakład: 48 210 · Najlepszy druk: 6 300
  ```
- Osobny zapis runu dnia (nie nadpisuje zwykłego runu).

### 10.2 Osiągnięcia i odblokowania (tempo: ~1 na 1–2 runy w pierwszych 10–15 runach)
| Osiągnięcie | Warunek | Odblokowuje |
|---|---|---|
| Pierwsza odbitka | wydrukuj linię | — |
| Kwadrans | wydrukuj 4 linie naraz | — |
| Krzyżówka | 15 druków z rzędem i kolumną naraz (łącznie) | Krzyżyk |
| Cztery farby | 4 kolory w jednym druku | Pasery |
| Pełna paleta | 5 kolorów w jednym druku | Druk irysowy |
| Biała karta | wyczyść formę drukiem 3+ linii | Czysta forma |
| Czeladnik drukarski | dojdź do edycji 3 | Kaszta |
| Mistrz | dojdź do edycji 6 | Lustro |
| Pełny nakład | wygraj run | Złota czcionka |
| Asceta | wyrób zlecenie specjalne edycji 3+ mając ≤ 1 matrycę | Szablon |
| Rytm maszyny | SERIA 12 | Taśmociąg |
| Maszyna parowa | SERIA 20 | Rozpęd |
| Wielki druk | jeden druk ≥ 10 000 | — |
| Kolekcjoner | 5 matryc naraz | — |
| Milioner | 1 000 000 nakładu łącznie | — |
| Stały bywalec | 3 wyzwania dnia | — |
| Bez końca | zlecenie 30 | — |

### 10.3 Statystyki
Runy, wygrane, najwięcej zleceń, rekord nakładu, najlepszy druk, łączne linie/druki/ułożenia, najdłuższa seria, najwięcej linii naraz, krzyże, linie jednobarwne, ulubiona matryca, seria dni wyzwania.

---

## 11. Monetyzacja

### 11.1 Zasady
| Element | Zasada |
|---|---|
| Reklama nagradzana — przeładowanie | po darmowym; ≤ 1/ekran, ≤ 3/run; nie w wyzwaniu dnia |
| Reklama nagradzana — dodruk | 1/run w trybie zwykłym; pierwszy w życiu darmowy |
| Reklama nagradzana — dodatkowe podejście do wyzwania dnia | 1/dzień |
| Interstitial | patrz 11.3 |
| Pierwsza sesja | **zero żądań reklam** (brak `initialize`) |
| Bez reklam (IAP) | jednorazowy, nie-konsumowalny `press_no_ads` (ID w `src/config.ts`, zamrożone); usuwa interstitiale; nagrody bez wideo (te same limity); u kupujących AdMob nie jest inicjalizowany |

### 11.2 Zgoda UMP (każdy zimny start od 2. sesji; nigdy w trakcie gry)
1. `requestConsentInfo({ tagForUnderAgeOfConsent: false })` (debug: geografia EEA + test device w buildach testowych).
2. Jeśli `status === REQUIRED && isConsentFormAvailable` → `showConsentForm()` — na ekranie tytułowym (pierwsza naturalna przerwa po pierwszym runie), nigdy w trakcie gry.
3. **Tylko gdy `canRequestAds === true`:** `initialize({ tagForChildDirectedTreatment: false, maxAdContentRating: 'ParentalGuidance' })`, potem preload. Żadne `prepare*/show*` przed krokiem 3 (test jednostkowy rzuca wyjątek).
4. `AndroidManifest`: `DELAY_APP_MEASUREMENT_INIT = true`.
5. Ustawienia → „Ustawienia prywatności" widoczne tylko, gdy `privacyOptionsRequirementStatus === REQUIRED` → `showPrivacyOptionsForm()` → ponowne `requestConsentInfo` i przeładowanie/zrzucenie reklam.
6. Błąd/offline → brak reklam w tej sesji, ponowienie przy końcu runu. Przyciski reklamowe ukryte, gdy nie można żądać reklam (kupujący widzą przyciski bez ikony reklamy).
7. AdMob → Privacy & messaging: komunikat GDPR (EEA+UK+CH, TCF 2.2) i US states.

### 11.3 Interstitial — reguły (testowane tabelą przypadków)
- Pokazywany **wyłącznie** po jawnym stuknięciu „Nowy run" lub „Menu" na ekranie Wyniku, **przed** nawigacją. Nigdy: przycisk wstecz, „Graj dalej (bez końca)", Pauza → Menu/porzucenie, zimny start, wznowienie, ekran Wyniku widoczny < 2 s.
- Pierwszy możliwy: `sesja ≥ 2` **i** `przegrane runy (łącznie) ≥ 2`.
- Odstęp: ≥ 2 zakończone runy od ostatniego interstitiala **i** ≥ 240 s od ostatniej reklamy pełnoekranowej dowolnego typu.
- Pomijany, jeśli w tym runie obejrzano reklamę nagradzaną albo reklama nie jest załadowana (bez czekania).
- Sesja = zimny start lub powrót po > 30 min w tle (czas reklamy się nie liczy).

### 11.4 Reklamy nagradzane — UI
Przycisk z ikoną ▶ i nagrodą („▶ Reklama → Dodruk (+8 arkuszy)") obok równego „Nie, dziękuję"; bez autoodtwarzania; przyciski nieaktywne 600 ms po pojawieniu się ekranu i poza strefą planszy/tacy; nagroda tylko w callbacku `Rewarded`; brak reklamy w 6 s → „Reklama niedostępna — spróbuj ponownie", szansa nie przepada.
**Cykl życia:** flaga `adShowing` (pauza/wznowienie aplikacji ignorowane), AudioContext wstrzymany na czas reklamy; przed reklamą zapis `pendingAd`, w callbacku natychmiast `rewardGranted = true`; po zimnym starcie z `pendingAd` nagroda jest stosowana albo oferowana ponownie.

### 11.5 Bez reklam — Billing (`@capgo/native-purchases`, Billing 9)
Przy każdym zimnym starcie i powrocie na pierwszy plan: `restorePurchases()` → `getPurchases({ productType: 'inapp' })`. Uprawnienie = zakup `press_no_ads` w stanie `purchaseState === '1'` (opłacony). Oczekujący (`'2'`) → „Płatność w toku — odblokujemy po potwierdzeniu", nic nie przyznajemy. Uprawnienie buforowane lokalnie (offline); cofane tylko po **udanym** zapytaniu bez produktu (zwrot). Cena z `getProducts()` (lokalizowana). `ITEM_ALREADY_OWNED` = przywrócenie; anulowanie użytkownika — cicho. „Przywróć zakup" na ekranie i w Ustawieniach. Reduktor uprawnień ma testy jednostkowe. Upsell: miękka karta na ekranie Wyniku po 3. interstitialu i link na ekranie Dodruku (≤ 1×/sesja). PWA: zakup ukryty.

### 11.6 ID reklam i konfiguracja
Debug/e2e/PWA zawsze **testowe ID Google**; w przeglądarce/PWA AdMob nie istnieje, więc reklamy są symulowane nakładką „Reklama testowa / Test ad” z tymi samymi regułami (D29). ID jednostek są wybierane przez bezpośrednie porównanie `import.meta.env.VITE_ADS_MODE`, więc bundle produkcyjny fizycznie nie zawiera testowych ID (D30). Release bierze ID z sekretów CI (`VITE_ADMOB_REWARDED_ID`, `VITE_ADMOB_INTERSTITIAL_ID`, `ADMOB_APP_ID` → `manifestPlaceholders`). Strażnik CI: release nie może zawierać `ca-app-pub-3940256099942544`. `app-ads.txt` w katalogu głównym domeny dewelopera. AdMob Blocking controls: hazard, randki, treści seksualne, alkohol, „szybkie bogacenie się".

### 11.7 Deklaracje Play Console (szczegóły w RELEASE.md)
Ads: Tak · Advertising ID: Tak · Data safety wg ujawnienia GMA SDK (lokalizacja przybliżona, interakcje, diagnostyka, identyfikatory urządzenia; cele: reklama, analityka, bezpieczeństwo; szyfrowanie w tranzycie) · zapisy gry tylko na urządzeniu (nie zbierane) · Target audience 18+ · IARC. Analityka/Remote Config: **nie w wersji 1.0** (abstrakcja z pustym dostawcą; rekomendacja w RELEASE.md).

---

## 12. UX i ekrany

### 12.1 Ekran gry (portret) — rysowany w całości w PixiJS
Pasma (dp): nagłówek **44** · nakład **36** · arkusze+seria **32** · stojak **64** (5 kart) · licznik druku **48** · **plansza** · taca **104** · odstępy 6×6 · marginesy 8. **Plansza = min(W − 32, H_użyteczne − 380)**, pole min. 34 dp, maks. 64 dp.
Kompakcja: T1 (H < 708) arkusze/seria w wierszu nakładu; T2 karty stojaka 56 dp (ikona + wartość); T3 pole 34 dp; T4 (< 580) stojak jako pasek ikon 40 dp otwierający arkusz.
Nagłówek: „EDYCJA 2" + 3 kropki postępu (3. = stempel zlecenia specjalnego) + chip utrudnienia nadchodzącego specjalnego + przyciski ⏸ i ⓘ (DOM, poza „kopertą przeciągania"). Numer „Zlecenie 5/24" w pauzie i w ⓘ.
Karta zlecenia = baner 1,5 s nad planszą („Zlecenie 2/3 · NAKŁAD 1 100 · 20 arkuszy"), zamykany pierwszym dotknięciem tacy.
Karty stojaka: odznaka wartości (cyfry tabelaryczne ≥ 12 sp), wyszarzenie + stempel ✕ przy awarii, strzałka → przy Lustrze, przerywany kontur pustych slotów.

### 12.2 Ekrany (DOM)
Tytuł (Wznów run / Graj · Wyzwanie dnia (w toku) · Matryce · Statystyki · Ustawienia · Bez reklam) · Pauza · Oferta · Szczegóły matrycy (◀ ▶, Sprzedaj) · Ostatnia szansa · Dodruk · Wynik · Zwycięstwo · Kolekcja · Osiągnięcia/Statystyki · Ustawienia · Bez reklam · Ostatni druk · Zasady zlecenia (ⓘ).

### 12.3 Przycisk wstecz (Android, predictive back przez App `backButton`)
| Kontekst | Wstecz |
|---|---|
| Przeciąganie | anuluj przeciąganie |
| Arkusz/dialog | zamknij |
| Gra | Pauza (podczas licznika: przewiń, potem Pauza) |
| Pauza | wznów |
| Oferta | nakładka Pauzy (oferta zostaje; nigdy wybór/pominięcie) |
| Tryb wymiany | wyjdź z trybu |
| Ostatnia szansa / Dodruk | dialog „Zakończyć bez …?" |
| Zwycięstwo | dialog „Zakończ / Graj dalej" |
| Wynik | Tytuł (bez interstitiala) |
| Samouczek | Pauza z „Pomiń samouczek" |
| Tytuł | `App.minimizeApp()` |
| Reklama | nic |

### 12.4 Zapis i wznowienie
Klucze: `press.run.normal`, `press.run.daily`, `press.meta`, `press.settings`, `press.ads`, `press.iap`. Run zapisywany w naprzemiennych slotach A/B jako `{schema, rulesVersion, seq, crc32, payload}`; przy wczytaniu wygrywa poprawny slot z najwyższym `seq`. Stan zawiera wszystko jawnie (taca, schowek, oferta i licznik przeładowań, nakład zlecenia, utrudnienia, pula). Inna `rulesVersion` → gramy dalej na zapisanych wartościach; inny `schema` → migracja albo odrzucenie z komunikatem. Zapisy łączone (jeden w locie, wygrywa najnowszy). Zapis po każdej akcji i przy przejściu w tło. Test fuzz: obcięcie/zmiana bajtu nigdy nie rzuca wyjątku.

---

## 13. Samouczek i wskazówki

Pierwsze uruchomienie, **3 kroki, nauka przez granie**, w piaskownicy (nie dotyka zapisów):
1. **Ułóż i drukuj:** prawie pełny rząd, 1 klocek; akceptowane tylko docelowe ułożenie (inne wracają); ręka (lub statyczna strzałka przy „Ogranicz ruch") powtarza się po 2 s bezczynności.
2. **Dwie linie naraz:** klocek domyka rząd i kolumnę; licznik ODBITKI × MNOŻNIK z podpisami; SERIA rośnie o 2.
3. **Pierwsze zlecenie:** prawdziwe zlecenie 1 z maks. 2 dymkami (nakład + arkusze na starcie; seria przy pierwszym drugim druku) i podpowiedzią na ofercie.
Opcja „Znam gry tego typu — pomiń" (pomija 1–2, zostawia 3). Powtórzenie z Ustawień. Samouczek jest zapisany jako ukończony w chwili startu prawdziwego runu (krok 3): po zamknięciu aplikacji w trakcie pierwszego zlecenia gracz widzi „Wznów run”, a nie ponowny samouczek (D28).

**Wskazówki w porę** (1 linia ≤ 60 zn. EN / ≤ 75 PL, nieblokujące, maks. 1 na zlecenie, zapamiętane): pierwsza matryca („Dotknij matrycy — szczegóły"), druga („Kolejność ma znaczenie — przeciągnij"), pierwszy pełny stojak, pierwsza zapowiedź zlecenia specjalnego, pierwsza wyschnięta kropla serii, pierwszy raz ≤ 3 arkusze bez nakładu (sprzedaż), pierwsza przegrana (dodruk). Ustawienia: „Wskazówki: wł./wył.", „Zresetuj wskazówki".

---

## 14. Art direction

Risograf/offset: papier, farby punktowe, raster, niedoskonały rejestr. **Zero cudzych assetów** — tekstury proceduralne, własne SVG, własny font.

### 14.1 Paleta (kontrast mierzony względem papieru)
| Rola | Kolor | Uwagi |
|---|---|---|
| Papier | `#F2ECDF` | włókna + ziarno |
| Tusz | `#231F20` | tekst, kontury |
| Fluo róż | `#FF4FA3` | tekst tuszem na różu 5,4:1 |
| Pomarańcz | `#FF7A2F` | tusz 6,3:1 |
| Żółć | `#FFD31A` | tusz 11,3:1 |
| Morska zieleń | **`#00806C`** | przyciemniona (deuteranopia róż–morska ΔE00 5,4 → 18,5; vs papier 4,1:1) |
| Błękit | `#2F6FD6` | biały tekst 4,8:1 |
| Ślepy tłok | biała płaszczyzna + bewel 2 dp + wytłoczony ✕ | |
| Ołów | `#8D8A86` + poziome kreskowanie (czcionka-blok) | |
| Nit | ciemny nit (ikona) | |

**Twarda zasada:** każde wypełnione pole ma kontur tuszem ≥ 1,5 dp (≥ 60% krycia) — krawędź ≥ 3:1 wobec pustych pól i papieru. Puste pola: papier + siatka tuszem 1 dp ~20%.

### 14.2 Faktury i efekty
- Tekstury (papier 512², ziarno, pola 5 farb + ślepy/ołów/nit × warianty krawędzi × normal/podświetlenie) **generowane proceduralnie podczas builda** (`scripts/build-textures.ts`, ten sam generator z seedem) do atlasu PNG ≤ 2048² (3×) — szybki start, odporność na utratę kontekstu GL.
- Raster pod kątami o wymiernych tangensach (0°, 18,43°, 26,57°, 45°, 71,57°) i z okresem dzielącym rozmiar pola — raster ciągnie się bez szwów przez cały klocek.
- Przesunięcie rejestru: druga warstwa ciemniejszej farby 1–2 px; nadruki `multiply`.
- Bez filtrów pełnoekranowych w czasie rzeczywistym.

### 14.3 Typografia
**PRESS Display** — własny ciężki geometryczny grotesk plakatowy, generowany z kodu (`scripts/build-font.ts`, opentype.js + polygon-clipping, kontury bez nakładek). Wersaliki A–Z + polskie znaki, cyfry tabelaryczne (600 j.), × − + / % : ! ? . , ' " ( ) # ★ „ ” – — … oraz spacje U+00A0/U+202F/U+2009. Metryki: ascender 950, descender −250 (akcenty i ogonki nigdy nieprzycięte). Tekst ciągły: font systemowy. Wersaliki przez CSS `text-transform` z `lang`.

### 14.4 Ikona i logo
Logo „PRESS" w PRESS Display, róż + błękit z przesunięciem rejestru. Ikona: czcionka-klocek z literą P (adaptive icon, wektorowy drawable).

---

## 15. Juice: animacje, haptyka

| Moment | Animacja | Haptyka |
|---|---|---|
| Chwyt | podniesienie (tween 90 ms) | lekka |
| Ułożenie | opad 1,08→1,0, kurz papieru | lekka |
| Druk | **stempel prasy** (płyta 1,25→1,0 w 90 ms), błysk tylko na drukowanych liniach, pola → płatki papieru, **rozbryzg farby**, plamy na papierze (zanik 2 s); linia jednobarwna: stempel „1 FARBA" | średnia |
| 3+ linie | shake ≤ 6 dp, ≤ 300 ms (scalany) | mocna |
| Licznik | tykanie odbitek/mnożnika, podskoki okienek i matryc, lecąca liczba | — |
| Nakład wyrobiony | pieczątka „ZATWIERDZONO / APPROVED" | sukces |
| Zacięcie | zgrzyt prasy, drżenie | błąd |

**Ogranicz ruch** (domyślnie z `prefers-reduced-motion`): bez shake i drżenia; stempel = fade 120 ms; bez cząsteczek/płatków; plamy statyczne (600 ms); bez lecących liczb; liczniki „Szybka"; natychmiastowe podniesienie.
**Limiter błysków (zawsze):** ≤ 3 błyski/s, ≤ 25% ekranu, ≤ +30% luminancji (test jednostkowy harmonogramu).

---

## 16. Dźwięk i muzyka
Całość syntetyzowana w Web Audio:
- Jeden `AudioContext` (`latencyHint: 'interactive'`), `resume()` przy każdym `pointerdown` do stanu `running`. Wstrzymanie (`suspend`) przy przejściu w tło (`appStateChange`, `visibilitychange`) i na czas reklamy; cisza ≤ 100 ms po „Home".
- Harmonogram muzyki: `setInterval` 25 ms, planowanie 200 ms naprzód (nigdy rAF).
- Ciężkie SFX (uderzenie prasy, zgniatanie, pieczątka) prerenderowane przez `OfflineAudioContext` przy pierwszym odblokowaniu; limit 16 głosów (kradzież najstarszego); tykanie ≤ 25/s ze schodkową wysokością; kompresor master (−10 dB, 12:1).
- Muzyka: generatywny lo-fi „groove drukarni" ~92 BPM; warstwa „maszynowa" narasta z serią; menu w wersji oszczędnej. Suwaki **Muzyka** i **Efekty**.

---

## 17. Dostępność i lokalizacja
- **Symbole farb** (pierwsza grupa Ustawień i Pauza): róż ●, pomarańcz ▲, żółć ■, morska ◆, błękit ✚ — 40% pola (min. 7 dp), tusz 55% (papierowy na błękicie); na planszy, tacy, cieniu, kartach matryc i w opisach.
- Cele dotykowe ≥ 48 dp, odstęp ≥ 8 dp. Sterowanie „Stuknięcia" + nakładka DOM 8×8 z `aria-label` + region `aria-live` po każdym druku („Druk: 2 linie, 640. Nakład 1 880 z 3 000. Zostało 11 arkuszy.").
- Tekst: natywnie `textZoom = 100`, skala systemowa przekazywana jako `--fs`; HUD do 1,3×, ekrany przewijane do 2,0×.
- Safe area: `viewport-fit=cover`, zmienne `--safe-area-inset-*` (Capacitor SystemBars, `insetsHandling: 'css'`) z fallbackiem `env()`; insety liczone „ignorując widoczność" (bez skoków layoutu).
- Tablety: `android:appCategory="game"`; układ wg rozmiaru okna (poziomy: W > H i H < 560 dp lub W ≥ 840 dp — kolumna HUD z prawej, taca przy kciuku); okno < 360×560 → auto-pauza „Powiększ okno".
- **Języki:** EN (domyślny), PL; wykrywanie języka systemu; `locales_config.xml` (per-app language). Liczba mnoga przez kategorie `Intl.PluralRules` (one/few/many/other), pełne zdania (bez sklejania), osobne warianty dla kolorów (przypadki). Liczby HUD: własny formatter z U+00A0 i grupowaniem od 4 cyfr; kompakt od 1 mln („56,2 MLN" / „56.2M"), notacja naukowa od 1e15; mnożnik do 2 miejsc („×12,25"). Budżety długości: etykiety HUD ≤ 8 zn., przyciski ≤ 14, nazwy matryc ≤ 20, opisy ≤ 90. Test pseudo-lokalizacji (+40%).

---

## 18. Technologia i architektura

### 18.1 Stos
Vite 7 + TypeScript 5.9 (strict, `noUncheckedIndexedAccess`), Vitest 4, Playwright, ESLint/Prettier. **PixiJS 8 (WebGL)** dla całego ekranu gry; DOM dla menu/modali. Capacitor 8 (App, Haptics, Preferences, Share, Status Bar/SystemBars, Splash), `@capacitor-community/admob` 8, `@capgo/native-purchases` 8. PWA: `vite-plugin-pwa`.

### 18.2 Dlaczego PixiJS (WebGL)
| Kryterium | Canvas 2D | PixiJS 8 | Wybór |
|---|---|---|---|
| Setki sprite'ów (pola, cząsteczki, płatki) | każde `drawImage` osobno | batching do kilku draw calli, `ParticleContainer` | Pixi |
| Efekty riso (multiply, rejestr) | przełączanie `globalCompositeOperation` | blend modes (kontenery pogrupowane wg trybu: normal → multiply → add, ≤ 12 draw calli w stanie ustalonym) | Pixi |
| HUD zsynchronizowany z FX (liczniki, stojak) | — | jeden ticker, jeden system wejścia, BitmapText z PRESS Display | Pixi |
| Rozmiar | 0 KB | ~150 KB gzip | akceptowalny |
**Wydajność:** `resolution = min(DPR, 1,5 | 2 | 2,5)` wg klasy urządzenia; `antialias: false`; nieprzezroczysta kanwa (papier w kanwie); własna obsługa wskaźnika (zdarzenia Pixi wyłączone); **render na żądanie** (ticker staje 500 ms po ostatniej animacji); limity cząsteczek 150/400/800, automatyczny spadek klasy przy p95 > 20 ms. Przy starcie: test WebGL i wersji WebView (ekran „Zaktualizuj Android System WebView").
**Utrata kontekstu GL:** tekstury z atlasu (źródło obrazu — ponowny upload), dynamiczne cache przebudowywane na `contextChange`; test Playwright `forceContextLoss()`.

### 18.3 Moduły
```
src/core/      czysta logika: rng, bitboard, board, pieces, generator, scoring, matrices,
               contracts, run, daily, save, meta, config/balance
src/sim/       bot + symulator (worker_threads) → docs/balance-report.md
src/render/    PixiJS: atlas, plansza, taca, przeciąganie, HUD, stojak, FX, kolejka prezentacji
src/ui/        ekrany DOM, i18n, formatowanie liczb
src/audio/     syntezator SFX + muzyka
src/platform/  Capacitor: storage (A/B), haptics, ads, consent, billing, back, lifecycle, insets
src/game/      kontroler: spina wszystko; API testowe window.__press (?debug=1)
```

### 18.4 Determinizm — tabela strumieni RNG
| Strumień | Klucz | Użycie |
|---|---|---|
| `tray` | (zlecenie, nrTacy) | kształty, potem kolory |
| `offer` | (nrOferty, nrPrzeładowania) | karty oferty |
| `golden` | (zlecenie, nrDruku) | próby Złotej czcionki w stałej kolejności (rzędy, kolumny, pola w linii) |
| `modifiers` | (edycja) | utrudnienia, remis koloru „Braku farby" |
| `board` | (zlecenie) | układ nitów/ołowiu |
| `failure` | (zlecenie) | wyłączona matryca |
| `daily` | (data) | reguła dnia |
Brak współdzielonego, zmiennego RNG runu. Bez `Math.pow`/`log10` w `src/core` (mnożenie iteracyjne). Test złotego pliku: stały seed + skrypt ruchów → migawka JSON tac, ofert i wyników.

### 18.5 API testowe
`?debug=1&seed=…` udostępnia `window.__press = { state(), layout(), place(slot, x, y) /* przez prawdziwą ścieżkę wejścia */, skipAnimations(on) }`. E2E pełnego runu prowadzi bot z symulatora (animacje pominięte, ≤ 2 min).

---

## 19. Balans i symulator

- Bot: beam search (szerokość 8, scalanie stanów po haszu planszy), ocena planszy na bitboardzie (dziury, przejścia, zdolność przyjęcia typowych klocków) + szybka ścieżka punktacji bez dziennika (test równości z pełną). Wybór matryc: heurystyka synergii z eksploracją.
- Uruchomienie: `npm run sim -- --runs 10000 --workers 4`; wyniki JSONL per worker; raport osobnym krokiem.
- Raport `docs/balance-report.md`: rozkład zleceń, zdawalność per zlecenie, krzywa nakładu vs mediana bota, premia terminowa per edycja, statystyki generatora, wpływ utrudnień, skuteczność matryc (pick rate, wynik z/bez) i **eksperyment wymuszonego wyboru z parami seedów** (z/bez matrycy X przy pierwszej ofercie), polityki przeładowań (0 / limit reklam / maks.).
- **Cele:** zlecenie 1 ≥ 97%; edycja 1 ≥ 85%; edycja 4 ≈ 45–60%; zwycięstwo ≈ 8–15%; dublety > single o ≥ 25% przy tej samej liczbie linii; każde utrudnienie −15…−40% mediany; premia 4 karty ≈ 30–50%, gwarancja rzadkiej ≈ 10–20%; żadna zwykła/rzadka matryca nie daje > 2× mediany efektu (legendarne ≤ 4×), żadna ≤ 0; różnica zwycięstw między „0 przeładowań" a „maks." ≤ +3 pp.

### 19.1 Wartości po balansie

Strojenie symulatorem (bot beam-search, ~26 tys. runów na wartościach końcowych; raport: [`balance-report.md`](balance-report.md)). Wersja wyjściowa była za łatwa: bot wygrywał 51,7% runów, zlecenia kończyły się po ~7 arkuszach, premie przed terminem przyznawano prawie zawsze, a skalujące matryce (Gutenberg, Czeladnik) dominowały.

| Parametr | Było | Jest | Po co |
|---|---|---|---|
| Krzywa nakładu `quotaStart × quotaGrowth^j` | 400 × 1,3^j | **1000 × 1,38^j** | zlecenia zużywają większość arkuszy; edycja 4 ≈ 55%, zwycięstwo ≈ 10% |
| Premia przed terminem (udział zużytych arkuszy) | 4 karty ≤ 60%, rzadka ≤ 40% | **≤ 50% / ≤ 30%** | premie 44% / 12% zamiast 90% / 75% |
| Mnożniki nakładu utrudnień | jam 0,85; wet_ink 0,8; big_format 1,0; leftover/failure/short_tray 0,9 | **0,7; 0,75; 0,85; 0,85** | każde utrudnienie −24…−34% (big_format był buffem +24%) |
| Wielki format | 20 arkuszy | **12 arkuszy** | duże klocki szybciej wypełniają formę |
| Nity (`jamCount`) | 2–4 wg edycji | **5** | utrudnienie realne od pierwszej edycji |
| Awaria matrycy | cały run zlecenia | **naprawa po `failureSheets` = 6 arkuszach** | −28% zamiast −52% (−79% w parze) |
| Wagi rzadkości od edycji 4 | 58/32/10 | **50/35/15** | późne oferty ciekawsze |
| Matryce | Wałek ×6 przy ≥2 liniach; Prasa hydrauliczna ×3; Czeladnik start +1; Kałamarz +2; Archiwum +1; Krzyżyk +3; Czysty arkusz ×4 przy ≥2 liniach | **Wałek +2 Mult × linie; Prasa ×1,5; Czeladnik start 0; Kałamarz +4; Archiwum +2; Krzyżyk +5; Czysty arkusz ×3 przy ≤ 8 polach po druku; Monotypia liczy linie w ≤ 2 farbach; Kaszta +2 arkusze** | brak martwych i za silnych matryc w eksperymencie wymuszonego wyboru |

Wynik (próba 4000 runów, przeładowanie darmowe, bez dodruku): zlecenie 1 — 98,4%, edycja 1 — 91,8%, edycja 4 — 55,1%, zwycięstwo — 10,1%, dublet vs 2 single — 1,37×, premia 4 karty — 43,7%, gwarancja rzadkiej — 11,7%, maks. reklamowych przeładowań vs 0 — +1,8 pp. **Wszystkie cele z §19 spełnione.**

`RULES_VERSION` zostaje 1: nic nie zostało jeszcze wydane, więc seed wyzwania dnia i zapisy nie wymagają podbicia (podbić przy pierwszej zmianie zasad po premierze).

---

## 20. Dziennik decyzji

| # | Decyzja | Uzasadnienie |
|---|---|---|
| D1 | Forma czyszczona na starcie zlecenia | samodzielne rundy, bezpieczne utrudnienia |
| D2 | Każda rozdana taca układalna (z budżetem obliczeń) | uczciwość; przegrana z decyzji gracza |
| D3 | Brak waluty; sprzedaż/pominięcie płacą arkuszami | mniej systemów, realne decyzje |
| D4 | Natychmiastowy koniec zlecenia + premia terminowa z udziału zużytych arkuszy bazowych | tempo; brak pętli sprzedaż→premia |
| D5 | Odbitki per linia; mnożnik bazowy = L | kwadratowa nagroda za multi-linie |
| D6 | **SERIA liczona w liniach (+L), tolerancja 3** | (v1.1) wcześniej single dominowały |
| D7 | Kolejność matryc ma znaczenie; wszystkie efekty mnożnika w fazie druku | czytelna, istotna kolejność |
| D8 | 24 zlecenia + tryb bez końca | run 25–35 min |
| D9 | Utrudnienie znane od początku edycji, pokazane na ofercie i w HUD | planowanie tam, gdzie zapada decyzja |
| D10 | Cały ekran gry w PixiJS, menu w DOM | synchronizacja HUD z FX, przeciągany klocek nigdy pod HUD-em, wydajność |
| D11 | Własny font z kodu (opentype.js + polygon-clipping) | zero cudzych assetów |
| D12 | Reklamowe przeładowania: ≤ 1/ekran, ≤ 3/run; nie w wyzwaniu dnia | brak pay-to-win |
| D13 | „Bez reklam" = brak interstitiali + nagrody bez wideo + brak inicjalizacji AdMob | realna wartość, limity chronią balans |
| D14 | Wyzwanie dnia: seed z daty UTC + wersja zasad, stała pula 22, bez dodruku/reklam | identyczne dla wszystkich, bez przewag |
| D15 | EN: Plates, Job, Quota, Prints, Sheets, Reprint, Streak | terminologia drukarska |
| D16 | Dokumentacja PL, kod EN | właściciel PL |
| D17 | Nity blokują druk linii (zamiast liczyć się jako pełne) | (v1.1) zlecenia ograniczone arkuszami — wypełnianie było buffem |
| D18 | Krzywa nakładu: jedna formuła 400 × 1,3^j | (v1.1) brak „piły" |
| D19 | Ostatnia szansa przed przegraną z braku arkuszy | (v1.1) nie karać, gdy gracz może sprzedać |
| D20 | Pierwszy dodruk w życiu darmowy; zero reklam w pierwszej sesji | (v1.1) F3; uczy mechaniki |
| D21 | Zgoda UMP przed `initialize`, przy każdym starcie od 2. sesji | (v1.1) wymóg Google |
| D22 | Tekstury pieczone przy buildzie do atlasu | (v1.1) szybki start, utrata kontekstu GL |
| D23 | Zapis A/B z CRC i seq; osobne sloty run/daily | (v1.1) brak utraty runu |
| D24 | Tryb pełnoekranowy (immersive sticky) domyślnie, wyłączalny w Ustawieniach | wymóg „pełny ekran"; opcja dla osób chcących widzieć zegar/baterię |
| D25 | Brak Firebase w 1.0; warstwa analityki z pustym dostawcą | wymaga konta/plików właściciela i zmian w Data safety |
| D26 | Ucieczka przez Kasztę nie jest zacięciem | silnik ogłaszał koniec runu, choć odłożenie ostatniego klocka dawało nową tacę (wykryte przez symulator) |
| D27 | Awaria losowana po kolejności nabycia matryc | przestawianie stojaka w ofercie pozwalało sterować, która matryca padnie |
| D28 | Samouczek ukończony od startu prawdziwego runu | e2e wykrył, że restart w trakcie 1. zlecenia nadpisywał zapisany run piaskownicą |
| D29 | PWA: symulowane reklamy z etykietą „Test ad”, te same reguły | jedna ścieżka kodu i testów e2e; PWA nie jest monetyzowana |
| D30 | ID reklam wybierane statycznie przez `import.meta.env` | odczyt przez alias zostawiał testowe ID w bundlu produkcyjnym — strażnik CI blokowałby każde wydanie |
| D31 | Debug APK w CI niezależny od lint/testów; AAB wymaga checks + e2e | instalowalny build i sygnał z Gradle po każdym pushu, brama jakości przed wydaniem |
| D32 | Balans wg symulatora: krzywa 1000 × 1,38^j, ostrzejsze progi premii, mocniejsze utrudnienia, awaria naprawiana po 6 arkuszach, przestrojone matryce | cele §19 spełnione na ~26 tys. runów bota (§19.1) |
