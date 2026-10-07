# PRESS — raport balansu (symulator)

> Wygenerowane przez `npm run sim -- report` z 4500 runów bota (główna próba: **2000** runów, wariant `reroll=free,continue=never`). Nie edytować ręcznie — regenerować. Liczby odnoszą się do silnego bota heurystycznego (§11), nie do przeciętnego gracza.

## 1. Cele GDD §19 — podsumowanie

| Cel | Docelowo | Wynik |  |
| :--- | ---: | :--- | :---: |
| Zlecenie 1 wyrobione | ≥ 97% | 100.0% | ✅ |
| Edycja 1 ukończona | ≥ 85% | 99.9% | ✅ |
| Edycja 4 ukończona | 45–60% | 99.5% | ❌ |
| Zwycięstwo | 8–15% | 51.7% | ❌ |
| Dublet vs 2 single (mediana po SERII) | ≥ 1,25× | 1.57 | ✅ |
| Każde utrudnienie | −15…−40% | jam -5%, leftover -19%, out_of_ink -27%, big_format 24%, rush -30%, wet_ink -12%, short_tray -18%, failure -52%, rows_only -28% | ❌ |
| Premia 4 karty | 30–50% | 90.4% | ❌ |
| Gwarancja rzadkiej | 10–20% | 74.9% | ❌ |
| Matryce: brak martwych / za silnych | 0 / 0 | 1 / 0 | ❌ |
| Zwycięstwa: maks. przeładowań − 0 | ≤ +3 pp | 8.4 pp | ❌ |

## 2. Rozkład wyrobionych zleceń

Liczba runów: **2000**. „Wyrobione” = liczba wygranych zleceń (0–24); zlecenie, na którym run się kończy, to wyrobione + 1.

| Percentyl | p10 | p25 | p50 (mediana) | p75 | p90 | średnia |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| zlecenia wyrobione | 17 | 20 | 24 | 24 | 24 | 21.83 |

**Zwycięstwa (24/24): 51.7% ± 1.1%** · ukończona edycja 1 (≥ 3): 99.9% · edycja 4 (≥ 12): 99.5% · edycja 6 (≥ 18): 88.8%

Przyczyny porażek: brak nakładu 966 (48.3%)

| Wyrobione | Runy | % | ≥ k (przeżycie) | Histogram |
| ---: | ---: | ---: | ---: | :--- |
| 0 | 0 | 0.0% | 100.0% |  |
| 1 | 0 | 0.0% | 100.0% |  |
| 2 | 3 | 0.1% | 100.0% | ▏ |
| 3 | 0 | 0.0% | 99.9% |  |
| 4 | 0 | 0.0% | 99.9% |  |
| 5 | 1 | 0.1% | 99.9% | ▏ |
| 6 | 0 | 0.0% | 99.8% |  |
| 7 | 0 | 0.0% | 99.8% |  |
| 8 | 1 | 0.1% | 99.8% | ▏ |
| 9 | 0 | 0.0% | 99.8% |  |
| 10 | 0 | 0.0% | 99.8% |  |
| 11 | 6 | 0.3% | 99.8% | ▏ |
| 12 | 7 | 0.4% | 99.5% | ▏ |
| 13 | 4 | 0.2% | 99.1% | ▏ |
| 14 | 35 | 1.8% | 98.9% | █ |
| 15 | 22 | 1.1% | 97.2% | █ |
| 16 | 33 | 1.7% | 96.0% | █ |
| 17 | 112 | 5.6% | 94.4% | ███ |
| 18 | 66 | 3.3% | 88.8% | ██ |
| 19 | 84 | 4.2% | 85.5% | ██ |
| 20 | 278 | 13.9% | 81.3% | ████████ |
| 21 | 74 | 3.7% | 67.4% | ██ |
| 22 | 44 | 2.2% | 63.7% | █ |
| 23 | 196 | 9.8% | 61.5% | ██████ |
| 24 | 1034 | 51.7% | 51.7% | ██████████████████████████████ |

## 3. Zdawalność per zlecenie i krzywa nakładu vs wynik bota

Zdawalność warunkowa = wyrobione / osiągnięte. „Wynik projekt.” = nakład na arkusz × arkusze bazowe (zlecenie kończy się natychmiast po wyrobieniu, więc surowy nakład jest ucięty na progu). Kolumna p25 / mediana / p75 dotyczy wyniku projektowanego; „×próg” = mediana projekt. / mediana progu.

| # | Ed. | Specjalne (top 3) | Osiągn. | Zdawalność | Bezwarunkowo | Próg | Mediana nakładu | Wynik projekt. p25 / med / p75 | ×próg | Śr. arkusze |
| ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 |  | 2000 | 100.0% | 100.0% | 400 | 480 | 960 / 1 200 / 1 371 | 3.00 | 8.9 |
| 2 | 1 |  | 2000 | 100.0% | 100.0% | 520 | 780 | 1 484 / 1 932 / 2 477 | 3.72 | 8.4 |
| 3 | 1 | ★ rush:699 jam:678 big_format:623 | 2000 | 99.9% | 99.9% | 540–680 | 920 | 1 800 / 2 688 / 4 000 | 4.72 | 6.7 |
| 4 | 2 |  | 1997 | 100.0% | 99.9% | 880 | 1 400 | 3 300 / 4 550 / 6 400 | 5.17 | 6.6 |
| 5 | 2 |  | 1997 | 100.0% | 99.9% | 1 100 | 1 800 | 4 767 / 6 657 / 9 370 | 6.05 | 5.9 |
| 6 | 2 | ★ big_format:680 rush:661 jam:656 | 1997 | 99.9% | 99.8% | 1 200–1 500 | 2 288 | 5 790 / 8 640 / 13 000 | 6.65 | 5.3 |
| 7 | 3 |  | 1996 | 100.0% | 99.8% | 1 900 | 3 150 | 8 571 / 12 459 / 18 000 | 6.56 | 5.6 |
| 8 | 3 |  | 1996 | 100.0% | 99.8% | 2 500 | 4 085 | 10 933 / 16 000 / 23 333 | 6.40 | 5.8 |
| 9 | 3 | ★ out_of_ink:277 wet_ink:264 short_tray:263 | 1996 | 99.9% | 99.8% | 2 800–2 900 | 4 480 | 10 832 / 16 000 / 25 316 | 5.71 | 6.1 |
| 10 | 4 |  | 1995 | 100.0% | 99.8% | 4 200 | 6 720 | 16 686 / 25 067 / 37 333 | 5.97 | 6.1 |
| 11 | 4 |  | 1995 | 100.0% | 99.8% | 5 500 | 8 400 | 20 571 / 30 150 / 46 800 | 5.48 | 6.3 |
| 12 | 4 | ★ short_tray:264 rush:258 leftover:256 | 1995 | 99.7% | 99.5% | 6 100–6 500 | 9 360 | 19 717 / 30 800 / 50 400 | 4.74 | 6.9 |
| 13 | 5 |  | 1989 | 99.6% | 99.1% | 9 300 | 13 920 | 30 086 / 46 873 / 77 350 | 5.04 | 6.9 |
| 14 | 5 |  | 1982 | 99.8% | 98.9% | 12 000 | 17 314 | 36 755 / 57 600 / 98 000 | 4.80 | 7.1 |
| 15 | 5 | ★ jam:239 wet_ink:237 rush:223 | 1978 | 98.2% | 97.2% | 13 000–14 000 | 19 054 | 33 000 / 58 696 / 104 138 | 4.52 | 8.2 |
| 16 | 6 |  | 1943 | 98.9% | 96.0% | 20 000 | 27 990 | 50 960 / 93 100 / 168 000 | 4.66 | 7.8 |
| 17 | 6 |  | 1921 | 98.3% | 94.4% | 27 000 | 36 125 | 62 424 / 114 667 / 215 600 | 4.25 | 8.4 |
| 18 | 6 | ★ rush:220 out_of_ink:218 short_tray:215 | 1888 | 94.1% | 88.8% | 28 000–31 000 | 38 710 | 51 963 / 109 202 / 227 132 | 3.77 | 9.8 |
| 19 | 7 |  | 1776 | 96.3% | 85.5% | 45 000 | 59 516 | 84 952 / 183 992 / 371 671 | 4.09 | 9.2 |
| 20 | 7 |  | 1710 | 95.1% | 81.3% | 58 000 | 76 050 | 103 824 / 235 200 / 469 325 | 4.06 | 9.6 |
| 21 | 7 | ★ big_format+rush:39 leftover+rush:36 short_tray+failure:34 | 1626 | 82.9% | 67.4% | 52 000–61 000 | 69 127 | 63 362 / 157 858 / 358 400 | 2.87 | 12.2 |
| 22 | 8 |  | 1348 | 94.5% | 63.7% | 99 000 | 132 300 | 190 749 / 415 330 / 810 000 | 4.20 | 9.3 |
| 23 | 8 |  | 1274 | 96.5% | 61.5% | 130 000 | 169 960 | 252 532 / 533 574 / 989 356 | 4.10 | 9.0 |
| 24 | 8 | ★ jam+out_of_ink:34 rush+leftover:32 rush+jam:30 | 1230 | 84.1% | 51.7% | 110 000–130 000 | 152 093 | 148 627 / 338 470 / 791 498 | 2.82 | 12.0 |

## 4. Premia terminowa per edycja

Progi: ≤ 60% arkuszy bazowych → 4 karty; ≤ 40% → gwarancja rzadkiej. Cel GDD: 4 karty ≈ 30–50%, rzadka ≈ 10–20%.

| Edycja | Wygrane zlecenia | 4 karty | Gwar. rzadka | Śr. udział zużytych arkuszy |
| :--- | ---: | ---: | ---: | ---: |
| 1 | 5997 | 93.5% | 56.2% | 41.6% |
| 2 | 5990 | 98.3% | 85.8% | 30.8% |
| 3 | 5987 | 97.7% | 88.5% | 29.6% |
| 4 | 5979 | 94.5% | 83.3% | 32.7% |
| 5 | 5903 | 89.5% | 76.3% | 36.6% |
| 6 | 5585 | 82.3% | 69.7% | 41.0% |
| 7 | 4684 | 77.8% | 64.8% | 44.4% |
| 8 | 2504 | 80.7% | 68.1% | 41.5% |
| **razem** | 42629 | **90.4%** | **74.9%** |  |

## 5. Wpływ utrudnień

Stosunek = wynik projektowany (nakład/arkusz × arkusze bazowe, więc „Krótki termin” liczy 14 arkuszy) zlecenia specjalnego ÷ wynik projektowany poprzedniego (zwykłego) zlecenia tego samego runu. Bez utrudnienia oczekiwany stosunek ≈ 1,0–1,3 (wzrost matryc); „Δ vs zwykłe” = stosunek ÷ 1,30 − 1 (porównanie „przy tym samym progu”, bo próg rośnie ×1,30 na zlecenie). Cel GDD: −15…−40%.

| Utrudnienie | Zlecenia | Zdawalność spec. | Zdawalność poprz. | Stosunek p25 / med / p75 | Δ vs zwykłe | k progu | Cel |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| big_format | 2194 | 99.9% | 100.0% | 1.15 / **1.62** / 2.29 | 24.3% | 1.00 | ❌ |
| failure | 903 | 91.9% | 100.0% | 0.34 / **0.62** / 0.95 | -52.3% | 0.90 | ❌ |
| jam | 2280 | 99.4% | 100.0% | 0.86 / **1.24** / 1.74 | -4.7% | 0.85 | ❌ |
| leftover | 917 | 99.9% | 100.0% | 0.76 / **1.05** / 1.47 | -19.4% | 0.90 | ✅ |
| out_of_ink | 947 | 97.6% | 100.0% | 0.63 / **0.95** / 1.42 | -26.6% | 0.85 | ✅ |
| rows_only | 409 | 96.8% | 100.0% | 0.58 / **0.94** / 1.32 | -28.0% | 0.75 | ✅ |
| rush | 2295 | 99.2% | 100.0% | 0.63 / **0.91** / 1.31 | -29.6% | 0.80 | ✅ |
| short_tray | 958 | 99.6% | 100.0% | 0.75 / **1.07** / 1.52 | -18.0% | 0.90 | ✅ |
| wet_ink | 951 | 98.8% | 100.0% | 0.79 / **1.14** / 1.59 | -12.1% | 0.80 | ❌ |

**Edycje 7–8 (dwa utrudnienia):**

| Para / utrudnienie | Zlecenia | Zdawalność spec. | Zdawalność poprz. | Stosunek p25 / med / p75 | Δ vs zwykłe | k progu |  |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| failure (w parze) | 714 | 52.1% | 100.0% | 0.09 / **0.21** / 0.47 | -84.2% | 0.90 |  |
| out_of_ink (w parze) | 698 | 86.0% | 100.0% | 0.48 / **0.79** / 1.14 | -39.1% | 0.85 |  |
| wet_ink (w parze) | 657 | 89.0% | 100.0% | 0.56 / **0.88** / 1.25 | -32.3% | 0.80 |  |
| leftover (w parze) | 629 | 91.9% | 100.0% | 0.49 / **0.72** / 1.09 | -44.8% | 0.90 |  |
| big_format (w parze) | 625 | 90.7% | 100.0% | 0.65 / **1.06** / 1.48 | -18.8% | 1.00 |  |
| rows_only (w parze) | 623 | 85.9% | 100.0% | 0.41 / **0.72** / 1.09 | -44.6% | 0.75 |  |
| rush (w parze) | 606 | 87.6% | 100.0% | 0.38 / **0.66** / 0.90 | -49.4% | 0.80 |  |
| jam (w parze) | 594 | 85.4% | 100.0% | 0.45 / **0.80** / 1.16 | -38.8% | 0.85 |  |
| short_tray (w parze) | 566 | 86.4% | 100.0% | 0.48 / **0.79** / 1.14 | -38.9% | 0.90 |  |
| big_format+rush | 66 | 98.5% | 100.0% | 0.74 / **0.90** / 1.35 | -31.0% | 0.80 |  |
| jam+out_of_ink | 64 | 85.9% | 100.0% | 0.45 / **0.75** / 1.09 | -42.2% | 0.72 |  |
| short_tray+failure | 62 | 56.5% | 100.0% | 0.12 / **0.19** / 0.53 | -85.1% | 0.81 |  |
| rush+leftover | 62 | 95.2% | 100.0% | 0.44 / **0.59** / 0.83 | -54.3% | 0.72 |  |
| jam+failure | 59 | 50.8% | 100.0% | 0.05 / **0.20** / 0.37 | -84.5% | 0.77 |  |
| rows_only+wet_ink | 58 | 94.8% | 100.0% | 0.53 / **0.77** / 1.07 | -40.9% | 0.60 |  |
| rush+jam | 56 | 85.7% | 100.0% | 0.47 / **0.65** / 0.86 | -50.0% | 0.68 |  |
| jam+big_format | 56 | 96.4% | 100.0% | 0.72 / **1.09** / 1.35 | -15.9% | 0.85 |  |
| short_tray+wet_ink | 54 | 94.4% | 100.0% | 0.76 / **1.15** / 1.40 | -11.7% | 0.72 |  |
| rush+out_of_ink | 53 | 90.6% | 100.0% | 0.49 / **0.73** / 0.98 | -43.6% | 0.68 |  |
| leftover+rush | 53 | 94.3% | 100.0% | 0.40 / **0.67** / 0.84 | -48.1% | 0.72 |  |

## 6. Matryce — oferty, wybory, wyniki

Oferowana = liczba ekranów oferty (po przeładowaniach), na których karta była do wzięcia; „wybór” = wzięcia / oferowania (w tym eksploracja ε). Kolumny „z/bez przy #6/#12” = średnia wyrobionych zleceń runów, które dotarły do zlecenia 6 / 12 i miały / nie miały tej matrycy na jego starcie (korelacja, nie przyczynowość — patrz §7). „Zwycięstwa gdy na końcu” = odsetek zwycięstw wśród runów kończących z tą matrycą.

| Matryca | Rzadkość | Pula | Oferowana | Wzięta | Wybór | Z przy #6 (n) | Bez #6 | Z przy #12 (n) | Bez #12 | Zwycięstwa gdy na końcu (n) |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `ink_pink` | zwykła | start | 5356 | 250 | 4.7% | 22.10 (135) | 21.84 | 21.47 (75) | 21.89 | 100.0% (6) |
| `ink_orange` | zwykła | start | 5438 | 288 | 5.3% | 21.63 (172) | 21.88 | 20.58 (93) | 21.94 | 100.0% (11) |
| `ink_yellow` | zwykła | start | 5223 | 335 | 6.4% | 21.79 (226) | 21.87 | 21.78 (139) | 21.88 | 100.0% (31) |
| `ink_teal` | zwykła | start | 5279 | 329 | 6.2% | 21.46 (210) | 21.91 | 21.59 (143) | 21.90 | 100.0% (26) |
| `ink_blue` | zwykła | start | 5348 | 283 | 5.3% | 22.21 (160) | 21.83 | 21.64 (100) | 21.89 | 100.0% (17) |
| `proof` | zwykła | start | 7513 | 646 | 8.6% | 21.65 (564) | 21.94 | 20.22 (59) | 21.93 | 100.0% (4) |
| `guillotine` | zwykła | start | 7160 | 849 | 11.9% | 21.62 (615) | 21.97 | 21.68 (236) | 21.90 | 100.0% (16) |
| `roller` | zwykła | start | 7737 | 400 | 5.2% | 21.58 (392) | 21.93 | 24.00 (1) | 21.88 | — |
| `margins` | zwykła | start | 4762 | 1524 | 32.0% | 21.69 (440) | 21.91 | 21.80 (1011) | 21.95 | 100.0% (743) |
| `petit` | zwykła | start | 7937 | 284 | 3.6% | 21.33 (242) | 21.94 | 19.93 (15) | 21.89 | 100.0% (1) |
| `poster` | zwykła | start | 7886 | 249 | 3.2% | 21.56 (216) | 21.90 | 22.62 (21) | 21.87 | — |
| `ream` | zwykła | start | 8060 | 68 | 0.8% | 21.90 (52) | 21.86 | — | 21.88 | 0.0% (3) |
| `numerator` | zwykła | start | 7722 | 359 | 4.6% | 21.61 (328) | 21.91 | 18.00 (5) | 21.89 | 100.0% (1) |
| `scrap` | zwykła | start | 6945 | 779 | 11.2% | 21.73 (322) | 21.89 | 21.60 (318) | 21.93 | 100.0% (170) |
| `first_impression` | zwykła | start | 3504 | 1960 | 55.9% | 21.74 (688) | 21.92 | 21.71 (1552) | 22.45 | 100.0% (848) |
| `column_press` | rzadka | start | 4281 | 1025 | 23.9% | 21.79 (309) | 21.88 | 21.45 (522) | 22.03 | 100.0% (110) |
| `monotype` | rzadka | start | 5098 | 26 | 0.5% | 21.20 (15) | 21.87 | 17.67 (3) | 21.88 | — |
| `registration` | rzadka | odbl. | 4364 | 993 | 22.8% | 21.70 (652) | 21.94 | 21.09 (353) | 22.05 | 100.0% (73) |
| `journeyman` | rzadka | start | 2158 | 1603 | 74.3% | 22.58 (852) | 21.33 | 22.34 (1448) | 20.66 | 100.0% (883) |
| `archive` | rzadka | start | 4971 | 384 | 7.7% | 21.87 (338) | 21.86 | 22.11 (79) | 21.87 | 100.0% (16) |
| `crossmark` | rzadka | odbl. | 5217 | 20 | 0.4% | 22.06 (18) | 21.86 | — | 21.88 | — |
| `type_case` | rzadka | odbl. | 5208 | 24 | 0.5% | 22.24 (17) | 21.86 | — | 21.88 | — |
| `clean_sheet` | rzadka | odbl. | 5295 | 20 | 0.4% | 20.60 (10) | 21.87 | 22.00 (6) | 21.88 | — |
| `stencil` | rzadka | odbl. | 4818 | 578 | 12.0% | 21.84 (571) | 21.87 | 21.03 (90) | 21.92 | — |
| `momentum` | rzadka | odbl. | 5137 | 72 | 1.4% | 21.74 (35) | 21.86 | 19.00 (1) | 21.88 | — |
| `conveyor` | rzadka | odbl. | 5137 | 21 | 0.4% | 22.94 (16) | 21.85 | — | 21.88 | — |
| `ink_well` | rzadka | start | 3589 | 1324 | 36.9% | 21.60 (827) | 22.05 | 21.26 (1019) | 22.52 | 100.0% (114) |
| `gutenberg` | legend. | start | 1632 | 1584 | 97.1% | 23.22 (463) | 21.45 | 23.09 (1133) | 20.29 | 100.0% (1031) |
| `hydraulic` | legend. | start | 4166 | 10 | 0.2% | 22.60 (5) | 21.86 | 22.67 (3) | 21.88 | — |
| `golden_type` | legend. | odbl. | 3597 | 847 | 23.5% | 22.16 (282) | 21.81 | 21.64 (362) | 21.93 | 100.0% (72) |
| `mirror` | legend. | odbl. | 1965 | 1622 | 82.5% | 21.82 (295) | 21.87 | 22.01 (995) | 21.75 | 100.0% (922) |
| `split_fountain` | legend. | odbl. | 3928 | 656 | 16.7% | 22.06 (339) | 21.82 | 21.58 (182) | 21.91 | 100.0% (26) |

## 7. Eksperyment wymuszonego wyboru (pary seedów)

Dla każdego seeda: run bazowy (bot wybiera sam) oraz runy, w których przy **pierwszej ofercie** bot musi wziąć matrycę X (gdy X nie ma w ofercie, wstawiamy ją w miejsce ostatniej karty przez snapshot/restore; kolumna „wstaw.”) albo pominąć ofertę (`skip`, +3 arkusze). Dalej bot gra normalnie (może wymienić wymuszoną matrycę, gdy uzna ją za słabą). Pary, w których bot nie wyrobił zlecenia 1, są pominięte (identyczne w obu ramionach). Δ = różnica sparowana (X − bazowy) ± błąd standardowy. **Efekt** = X − pominięcie (ta sama para seedów): ile matryca daje względem „nic + 3 arkusze”. MARTWA: efekt ≤ 0 lub nieistotny (efekt − 2·SE ≤ 0). ZA SILNA: efekt > 2× mediany efektu (zwykła/rzadka) lub > 4× (legendarna). Mediana efektu: **1.585** zlecenia.

| Wybór | Rzadkość | Pary | Wstaw. | Δ zleceń vs bazowy | Δ zwycięstw [pp] | Efekt (zlecenia) vs skip | Efekt zwycięstw [pp] | × mediany | Werdykt |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gutenberg` | legendary | 200 | 195 | +1.43 ± 0.23 | +25.0 ± 3.8 | +1.90 ± 0.29 | +30.0 | 1.20 | ok |
| `journeyman` | rare | 200 | 179 | +1.11 ± 0.20 | +9.0 ± 2.9 | +1.58 ± 0.28 | +14.0 | 1.00 | ok |
| `proof` | common | 200 | 166 | -0.07 ± 0.19 | -0.5 ± 2.4 | +0.40 ± 0.29 | +4.5 | 0.25 | **MARTWA** |
| `skip` | pominięcie | 200 | 0 | -0.47 ± 0.27 | -5.0 ± 3.2 | +0.00 ± 0.00 | +0.0 |  |  |

**Martwe (1):** `proof`

**Za silne (0):** —

## 8. Polityki przeładowań i dodruku

Te same seedy dla każdej polityki; Δ względem `reroll=none,continue=never` (sparowane). Cel GDD: różnica zwycięstw „0 przeładowań” vs „maks.” ≤ +3 pp.

| Polityka | Runy | Śr. zlecenia | Zwycięstwa | Darmowe przeł. | Reklamowe przeł. | Dodruk użyty | Δ zleceń / Δ zwycięstw |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| reroll=ads,continue=always | 250 | 22.76 | 68.0% ± 3.0% | 1.00 | 3.00 | 42.0% | +1.03 ± 0.16 / +16.4 ± 2.5 pp |
| reroll=ads,continue=never | 250 | 22.30 | 60.0% ± 3.1% | 1.00 | 3.00 | 0.0% | +0.56 ± 0.15 / +8.4 ± 2.5 pp |
| reroll=free,continue=always | 250 | 22.48 | 62.8% ± 3.1% | 1.00 | 0.00 | 48.0% | +0.74 ± 0.13 / +11.2 ± 2.3 pp |
| reroll=free,continue=never | 250 | 21.98 | 54.8% ± 3.1% | 1.00 | 0.00 | 0.0% | +0.24 ± 0.13 / +3.2 ± 2.0 pp |
| reroll=none,continue=always | 250 | 22.31 | 58.8% ± 3.1% | 0.00 | 0.00 | 50.0% | +0.58 ± 0.08 / +7.2 ± 1.6 pp |
| reroll=none,continue=never | 250 | 21.74 | 51.6% ± 3.2% | 0.00 | 0.00 | 0.0% | (odniesienie) |

## 9. Generator tac

Rozdania: **133 414** · fallback konstrukcyjny: **3 (0.002%)** · próbkowane przez `dealTray`: 133 414 (niezgodności z silnikiem: 0) · węzły solvera: średnio 1.1, maks. 493 · czas rozdania (Node, ten komputer): p50 ≤ 0.1 ms, p99 ≤ 0.1 ms, maks. 35.23 ms (cel GDD: p99 ≤ 4 ms na urządzeniu referencyjnym).

| Próby | Rozdania | % |
| :--- | ---: | ---: |
| 1 | 132820 | 99.55% |
| 2 | 360 | 0.27% |
| 3 | 89 | 0.07% |
| 4 | 45 | 0.03% |
| 5 | 20 | 0.01% |
| 6 | 24 | 0.02% |
| 7 | 20 | 0.01% |
| 8 | 14 | 0.01% |
| 9 | 7 | 0.01% |
| 10 | 5 | 0.00% |
| 11 | 4 | 0.00% |
| 12 | 6 | 0.00% |

## 10. Dublety vs single

Porównanie: średni wynik druku 2 linii przy SERII s (przed drukiem) vs suma dwóch pojedynczych druków przy SERII s i s+1 (tyle samo linii, ta sama seria wyjściowa). Cel GDD: dublet ≥ 1,25× dwóch singli.

**Analitycznie (zasady bazowe, bez matryc, linie wielobarwne):**

| SERIA s | Single @s | Single @s+1 | Dublet @s | Dublet / (2 single) |
| :--- | ---: | ---: | ---: | ---: |
| 0 | 80 | 160 | 480 | 2.00 |
| 1 | 160 | 240 | 640 | 1.60 |
| 2 | 240 | 320 | 800 | 1.43 |
| 3 | 320 | 400 | 960 | 1.33 |
| 5 | 480 | 560 | 1 280 | 1.23 |
| 8 | 720 | 800 | 1 760 | 1.16 |
| 12 | 1 040 | 1 120 | 2 400 | 1.11 |

**Z danych bota — pusty stojak:**

| SERIA s | Single @s | Single @s+1 | Dublet @s | n dubletów | Stosunek |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 0 | 90 | 167 | 488 | 223 | 1.90 |
| 1 | 167 | 246 | 648 | 153 | 1.57 |
| 2 | 246 | 303 | 811 | 89 | 1.48 |
| 3 | 303 | 393 | — | 0 | — |
| 4 | 393 | 446 | — | 2 | — |
| 5 | 446 | 572 | — | 0 | — |
| 6 | 572 | 663 | — | 1 | — |
| 7 | 663 | 683 | — | 0 | — |
| 8 | 683 | 780 | — | 2 | — |
| 9 | 780 | 823 | — | 0 | — |
| 10 | 823 | 840 | — | 4 | — |
| 11 | 840 | 997 | — | 1 | — |
| 12 | 997 | 1 080 | — | 1 | — |

**Z danych bota — wszystkie druki (z matrycami):**

| SERIA s | Single @s | Single @s+1 | Dublet @s | n dubletów | Stosunek |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 0 | 21 531 | 10 098 | 24 386 | 3235 | 0.77 |
| 1 | 10 098 | 6 304 | 19 055 | 1384 | 1.16 |
| 2 | 6 304 | 6 306 | 11 604 | 633 | 0.92 |
| 3 | 6 306 | 6 492 | 14 006 | 366 | 1.09 |
| 4 | 6 492 | 6 252 | 16 152 | 240 | 1.27 |
| 5 | 6 252 | 6 041 | 15 728 | 182 | 1.28 |
| 6 | 6 041 | 5 805 | 14 008 | 112 | 1.18 |
| 7 | 5 805 | 4 346 | 15 344 | 63 | 1.51 |
| 8 | 4 346 | 3 687 | 9 597 | 37 | 1.19 |
| 9 | 3 687 | 2 649 | 7 879 | 10 | 1.24 |
| 10 | 2 649 | 2 627 | 3 919 | 13 | 0.74 |
| 11 | 2 627 | 2 134 | — | 4 | — |
| 12 | 2 134 | 2 164 | 9 275 | 5 | 2.16 |

## 11. Wydajność bota i symulatora

| Miara | Wartość |
| :--- | ---: |
| decyzje (ułożenia) | 341 900 |
| ms / decyzja — średnio | 0.308 |
| ms / decyzja — mediana (przedział) | 0.1–0.2 |
| ms / decyzja — p90 / p99 (przedział od) | 0.5 / 4.0 |
| ms / decyzja — maks. | 76.4 |
| węzły planera / decyzja | 389 |
| decyzje z poszerzonym ponownym wyszukiwaniem | 3 (0.00%) |
| ms / run — mediana / p90 (w wątku roboczym) | 67.6 / 130.9 |
| ostatni wsad (meta.json): czas ścienny · przepustowość | 41 s · 2942 runów/min · 4 wątki; 28 s · 2165 runów/min · 4 wątki; 31 s · 2902 runów/min · 4 wątki |

## 12. Ostatnia szansa, dodruk, Kaszta

Polityki w tej próbie: free/never. Sprzedaże w „Ostatniej szansie”: 1238 zleceń (uratowane: 272, 22.0%). Dodruk użyty w 0 runach (0.0%); zlecenie uratowane po dodruku: 0. Przyczyny dodruku: —. Runy z Kasztą: 24, odłożeń: 213 (8.9 na run).

### 12a. To samo dla próby polityk (z dodrukiem)

Polityki w tej próbie: none/never, none/always, free/never, free/always, ads/never, ads/always. Sprzedaże w „Ostatniej szansie”: 861 zleceń (uratowane: 251, 29.2%). Dodruk użyty w 350 runach (23.3%); zlecenie uratowane po dodruku: 207. Przyczyny dodruku: quota 350. Runy z Kasztą: 42, odłożeń: 500 (11.9 na run).

## 13. Uwagi (automatyczne)

- Zwycięstwa 51.7% > 15%: krzywa nakładu rośnie wolniej niż siła stojaka (bot zwykle wyrabia zlecenie w 7.2 arkuszach).
- Utrudnienie `jam` obniża wynik tylko o 5% (cel ≥ 15%).
- Utrudnienie `big_format` PODNOSI wynik bota o 24% (cel: obniżka 15–40%) — działa jak bonus.
- Utrudnienie `wet_ink` obniża wynik tylko o 12% (cel ≥ 15%).
- Utrudnienie `failure` obniża wynik o 52% (cel ≤ 40%).
- Premia 4 kart w 90.4% wygranych (cel 30–50%) — progi premii terminowej są zbyt łatwe przy obecnej krzywej.
- Gwarancja rzadkiej w 74.9% wygranych (cel 10–20%).
- Martwe matryce wg eksperymentu wymuszonego wyboru: `proof`.

## 14. Parametry uruchomienia i wartości balansu

Wejścia: `/tmp/claude-0/sim/smoke/base`, `/tmp/claude-0/sim/smoke/forced`, `/tmp/claude-0/sim/smoke/policies` · rekordów: **4500** · wygenerowano: 2026-10-07T20:46:32.256Z

Bot: beam search (szerokość 8, scalanie stanów, wyszukiwanie z odkładaniem do Kaszty), ε-eksploracja ofert = 0.05, pula: all. Polityka główna: `reroll=free,continue=never` (darmowe przeładowanie przy słabej ofercie, bez dodruku).

| Grupa · wariant | Runy |
| :--- | ---: |
| forced · base | 200 |
| forced · force=gutenberg | 200 |
| forced · force=journeyman | 200 |
| forced · force=proof | 200 |
| forced · force=skip | 200 |
| policies · reroll=ads,continue=always | 250 |
| policies · reroll=ads,continue=never | 250 |
| policies · reroll=free,continue=always | 250 |
| policies · reroll=free,continue=never | 250 |
| policies · reroll=none,continue=always | 250 |
| policies · reroll=none,continue=never | 250 |
| run · reroll=free,continue=never | 2000 |

<details><summary>BALANCE (src/core/config/balance.ts)</summary>

```json
{
 "cellPrints": 10,
 "monoLineMult": 2,
 "streakGrace": 3,
 "editions": 8,
 "contractsPerEdition": 3,
 "baseSheets": 20,
 "quotaStart": 400,
 "quotaGrowth": 1.3,
 "specialFactor": 1,
 "modifierQuota": {
  "rush": 0.8,
  "big_format": 1,
  "wet_ink": 0.8,
  "jam": 0.85,
  "out_of_ink": 0.85,
  "leftover": 0.9,
  "failure": 0.9,
  "short_tray": 0.9,
  "rows_only": 0.75
 },
 "doubleModifierFromEdition": 7,
 "earlyShare4Cards": 0.6,
 "earlyShareRare": 0.4,
 "skipSheets": 3,
 "sellSheets": {
  "common": 1,
  "rare": 1,
  "legendary": 2
 },
 "freeRerollsPerRun": 1,
 "adRerollsPerOffer": 1,
 "adRerollsPerRun": 3,
 "continueSheets": 8,
 "continueClearRows": 2,
 "continueClearCols": 2,
 "slots": 5,
 "rarityWeights": {
  "common": 64,
  "rare": 30,
  "legendary": 6
 },
 "rarityWeightsLate": {
  "common": 58,
  "rare": 32,
  "legendary": 10
 },
 "rarityLateFromEdition": 4,
 "failureWeights": {
  "common": 1,
  "rare": 2,
  "legendary": 3
 },
 "colorAffinityWeight": 1,
 "bigFormatFactor": 3,
 "dealRetries": 12,
 "dealRetriesBeforeSmallBias": 6,
 "rushSheets": 14,
 "jamCount": [
  2,
  2,
  3,
  3,
  3,
  4,
  4,
  4
 ],
 "leftoverCount": [
  8,
  8,
  10,
  10,
  10,
  12,
  12,
  12
 ]
}
```

</details>

<details><summary>MX (src/core/matrices.ts)</summary>

```json
{
 "inkPrints": 20,
 "proofMult": 3,
 "guillotinePrints": 50,
 "rollerMult": 6,
 "marginsPrints": 120,
 "petitMult": 5,
 "petitMaxSize": 3,
 "posterPrints": 120,
 "posterMinSize": 5,
 "reamSheets": 3,
 "numeratorPerStreak": 1,
 "scrapPerPlacement": 30,
 "scrapMax": 300,
 "firstImpressionX": 2,
 "firstImpressionSheets": 8,
 "columnPressX": 2,
 "monotypeX": 2,
 "registrationPerInk": 2,
 "journeymanStart": 1,
 "journeymanStep": 1,
 "archiveStep": 1,
 "crossmarkMult": 3,
 "cleanSheetX": 4,
 "cleanSheetMinLines": 2,
 "stencilPerEmpty": 0.5,
 "momentumPerStreak": 0.1,
 "conveyorGrace": 1,
 "conveyorCarry": 0.5,
 "inkWellStep": 2,
 "gutenbergStart": 1.5,
 "gutenbergStep": 0.25,
 "hydraulicX": 3,
 "hydraulicMinLines": 3,
 "goldenChance": 0.25,
 "goldenX": 1.1,
 "splitFountainX": 1.5,
 "splitFountainMinInks": 3
}
```

</details>

## 15. Jak odtworzyć

```sh
# główna próba (wznawialna: ponowne uruchomienie pomija gotowe runy; długie wsady: nohup … &)
npm run sim -- run --runs 10000 --out /tmp/claude-0/sim/base
# eksperyment wymuszonego wyboru: wszystkie matryce + pominięcie, pary seedów
npm run sim -- forced --plates all --pairs 400 --out /tmp/claude-0/sim/forced
# porównanie polityk przeładowań / dodruku na tych samych seedach
npm run sim -- run --runs 2000 --reroll none,free,ads --continue never,always --group policies --seed-prefix pol --out /tmp/claude-0/sim/policies
# raport
npm run sim -- report --in /tmp/claude-0/sim/base,/tmp/claude-0/sim/forced,/tmp/claude-0/sim/policies --out docs/balance-report.md
# eksperymenty z wartościami bez edycji src/core:
npm run sim -- run --runs 2000 --set quotaGrowth=1.4,MX.gutenbergStep=0.15 --out /tmp/claude-0/sim/try1
```
