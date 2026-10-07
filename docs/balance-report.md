# PRESS — raport balansu (symulator)

> Wygenerowane przez `npm run sim -- report` z 26200 runów bota (główna próba: **4000** runów, wariant `reroll=free,continue=never`). Nie edytować ręcznie — regenerować. Liczby odnoszą się do silnego bota heurystycznego (§11), nie do przeciętnego gracza.

## 1. Cele GDD §19 — podsumowanie

| Cel | Docelowo | Wynik |  |
| :--- | ---: | :--- | :---: |
| Zlecenie 1 wyrobione | ≥ 97% | 98.4% | ✅ |
| Edycja 1 ukończona | ≥ 85% | 91.8% | ✅ |
| Edycja 4 ukończona | 45–60% | 55.1% | ✅ |
| Zwycięstwo | 8–15% | 10.1% | ✅ |
| Dublet vs 2 single (mediana po SERII) | ≥ 1,25× | 1.37 | ✅ |
| Każde utrudnienie | −15…−40% | jam -29%, leftover -24%, big_format -28%, rush -34%, failure -28%, out_of_ink -25%, short_tray -28%, rows_only -31%, wet_ink -29% | ✅ |
| Premia 4 karty | 30–50% | 43.7% | ✅ |
| Gwarancja rzadkiej | 10–20% | 11.7% | ✅ |
| Matryce: brak martwych / za silnych | 0 / 0 | 0 / 0 | ✅ |
| Zwycięstwa: maks. przeładowań − 0 | ≤ +3 pp | 1.8 pp | ✅ |

## 2. Rozkład wyrobionych zleceń

Liczba runów: **4000**. „Wyrobione” = liczba wygranych zleceń (0–24); zlecenie, na którym run się kończy, to wyrobione + 1.

| Percentyl | p10 | p25 | p50 (mediana) | p75 | p90 | średnia |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| zlecenia wyrobione | 5 | 9 | 12 | 17 | 24 | 13.09 |

**Zwycięstwa (24/24): 10.1% ± 0.5%** · ukończona edycja 1 (≥ 3): 91.8% · edycja 4 (≥ 12): 55.1% · edycja 6 (≥ 18): 23.8%

Przyczyny porażek: brak nakładu 3595 (89.9%)

| Wyrobione | Runy | % | ≥ k (przeżycie) | Histogram |
| ---: | ---: | ---: | ---: | :--- |
| 0 | 65 | 1.6% | 100.0% | ████ |
| 1 | 56 | 1.4% | 98.4% | ████ |
| 2 | 208 | 5.2% | 97.0% | ██████████████ |
| 3 | 12 | 0.3% | 91.8% | █ |
| 4 | 10 | 0.3% | 91.5% | █ |
| 5 | 62 | 1.6% | 91.2% | ████ |
| 6 | 30 | 0.8% | 89.7% | ██ |
| 7 | 83 | 2.1% | 88.9% | ██████ |
| 8 | 295 | 7.4% | 86.9% | ████████████████████ |
| 9 | 239 | 6.0% | 79.5% | ████████████████ |
| 10 | 293 | 7.3% | 73.5% | ████████████████████ |
| 11 | 442 | 11.1% | 66.2% | ██████████████████████████████ |
| 12 | 304 | 7.6% | 55.1% | █████████████████████ |
| 13 | 286 | 7.1% | 47.5% | ███████████████████ |
| 14 | 257 | 6.4% | 40.4% | █████████████████ |
| 15 | 185 | 4.6% | 34.0% | █████████████ |
| 16 | 124 | 3.1% | 29.3% | ████████ |
| 17 | 98 | 2.5% | 26.2% | ███████ |
| 18 | 76 | 1.9% | 23.8% | █████ |
| 19 | 68 | 1.7% | 21.9% | █████ |
| 20 | 90 | 2.3% | 20.2% | ██████ |
| 21 | 85 | 2.1% | 17.9% | ██████ |
| 22 | 119 | 3.0% | 15.8% | ████████ |
| 23 | 108 | 2.7% | 12.8% | ███████ |
| 24 | 405 | 10.1% | 10.1% | ███████████████████████████ |

## 3. Zdawalność per zlecenie i krzywa nakładu vs wynik bota

Zdawalność warunkowa = wyrobione / osiągnięte. „Wynik projekt.” = nakład na arkusz × arkusze bazowe (zlecenie kończy się natychmiast po wyrobieniu, więc surowy nakład jest ucięty na progu). Kolumna p25 / mediana / p75 dotyczy wyniku projektowanego; „×próg” = mediana projekt. / mediana progu.

| # | Ed. | Specjalne (top 3) | Osiągn. | Zdawalność | Bezwarunkowo | Próg | Mediana nakładu | Wynik projekt. p25 / med / p75 | ×próg | Śr. arkusze |
| ---: | ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 |  | 4000 | 98.4% | 98.4% | 1 000 | 1 200 | 1 600 / 1 846 / 2 080 | 1.85 | 13.7 |
| 2 | 1 |  | 3935 | 98.6% | 97.0% | 1 400 | 1 680 | 2 400 / 2 880 / 3 520 | 2.06 | 12.5 |
| 3 | 1 | ★ rush:1319 jam:1285 big_format:1275 | 3879 | 94.6% | 91.8% | 1 300–1 600 | 1 882 | 2 299 / 3 037 / 3 990 | 2.02 | 10.3 |
| 4 | 2 |  | 3671 | 99.7% | 91.5% | 2 600 | 3 360 | 5 529 / 6 933 / 9 100 | 2.67 | 10.1 |
| 5 | 2 |  | 3659 | 99.7% | 91.2% | 3 600 | 4 724 | 8 025 / 10 444 / 14 400 | 2.90 | 9.5 |
| 6 | 2 | ★ big_format:1252 jam:1201 rush:1196 | 3649 | 98.3% | 89.7% | 3 500–4 300 | 5 360 | 7 740 / 10 560 / 15 022 | 2.64 | 8.4 |
| 7 | 3 |  | 3587 | 99.2% | 88.9% | 6 900 | 8 720 | 14 010 / 19 200 / 28 165 | 2.78 | 10.0 |
| 8 | 3 |  | 3557 | 97.7% | 86.9% | 9 500 | 11 751 | 16 862 / 24 000 / 36 205 | 2.53 | 11.1 |
| 9 | 3 | ★ jam:480 rush:449 wet_ink:446 | 3474 | 91.5% | 79.5% | 9 900–11 000 | 12 800 | 14 869 / 23 400 / 35 981 | 2.13 | 11.9 |
| 10 | 4 |  | 3179 | 92.5% | 73.5% | 18 000 | 20 960 | 24 958 / 38 896 / 60 458 | 2.16 | 12.7 |
| 11 | 4 |  | 2940 | 90.0% | 66.2% | 25 000 | 28 560 | 31 056 / 49 850 / 78 698 | 1.99 | 13.6 |
| 12 | 4 | ★ jam:354 wet_ink:344 out_of_ink:341 | 2647 | 83.3% | 55.1% | 26 000–29 000 | 31 824 | 29 402 / 50 000 / 82 486 | 1.72 | 14.0 |
| 13 | 5 |  | 2205 | 86.2% | 47.5% | 48 000 | 53 466 | 53 000 / 90 000 / 144 857 | 1.88 | 14.5 |
| 14 | 5 |  | 1901 | 85.0% | 40.4% | 66 000 | 74 109 | 73 579 / 125 342 / 199 296 | 1.90 | 14.5 |
| 15 | 5 | ★ rush:197 out_of_ink:189 leftover:185 | 1615 | 84.1% | 34.0% | 68 000–77 000 | 83 790 | 81 238 / 133 338 / 217 947 | 1.73 | 13.9 |
| 16 | 6 |  | 1358 | 86.4% | 29.3% | 130 000 | 145 913 | 147 351 / 249 906 / 389 151 | 1.92 | 14.5 |
| 17 | 6 |  | 1173 | 89.4% | 26.2% | 170 000 | 192 960 | 217 846 / 345 816 / 490 000 | 2.03 | 13.6 |
| 18 | 6 | ★ failure:141 out_of_ink:139 leftover:133 | 1049 | 90.7% | 23.8% | 180 000–200 000 | 224 455 | 250 246 / 380 000 / 545 738 | 1.90 | 13.0 |
| 19 | 7 |  | 951 | 92.0% | 21.9% | 330 000 | 371 869 | 411 944 / 610 416 / 871 200 | 1.85 | 14.2 |
| 20 | 7 |  | 875 | 92.2% | 20.2% | 450 000 | 501 636 | 566 021 / 774 900 / 1 090 759 | 1.72 | 14.5 |
| 21 | 7 | ★ rush+leftover:30 rush+out_of_ink:24 jam+out_of_ink:21 | 807 | 88.8% | 17.9% | 380 000–450 000 | 473 437 | 479 569 / 658 965 / 925 549 | 1.65 | 13.8 |
| 22 | 8 |  | 717 | 88.1% | 15.8% | 870 000 | 947 250 | 903 078 / 1 222 861 / 1 701 818 | 1.41 | 17.0 |
| 23 | 8 |  | 632 | 81.2% | 12.8% | 1 200 000 | 1 288 855 | 1 150 930 / 1 488 499 / 1 954 817 | 1.24 | 18.9 |
| 24 | 8 | ★ rush+rows_only:16 jam+wet_ink:16 rush+out_of_ink:14 | 513 | 78.9% | 10.1% | 980 000–1 200 000 | 1 152 861 | 903 960 / 1 366 517 / 1 774 869 | 1.24 | 16.8 |

## 4. Premia terminowa per edycja

Progi: ≤ 50% arkuszy bazowych → 4 karty; ≤ 30% → gwarancja rzadkiej. Cel GDD: 4 karty ≈ 30–50%, rzadka ≈ 10–20%.

| Edycja | Wygrane zlecenia | 4 karty | Gwar. rzadka | Śr. udział zużytych arkuszy |
| :--- | ---: | ---: | ---: | ---: |
| 1 | 11485 | 23.1% | 2.1% | 65.2% |
| 2 | 10895 | 60.1% | 15.6% | 50.8% |
| 3 | 10210 | 55.1% | 17.6% | 54.0% |
| 4 | 7792 | 44.4% | 14.9% | 60.6% |
| 5 | 4874 | 43.4% | 13.4% | 62.3% |
| 6 | 3173 | 43.8% | 12.1% | 61.4% |
| 7 | 2399 | 32.1% | 5.1% | 67.5% |
| 8 | 1145 | 14.4% | 0.9% | 79.0% |
| **razem** | 51973 | **43.7%** | **11.7%** |  |

## 5. Wpływ utrudnień

Stosunek = wynik projektowany (nakład/arkusz × arkusze bazowe, więc „Krótki termin” liczy 14 arkuszy) zlecenia specjalnego ÷ wynik projektowany poprzedniego (zwykłego) zlecenia tego samego runu. Bez utrudnienia oczekiwany stosunek ≈ 1,0–1,3 (wzrost matryc); „Δ vs zwykłe” = stosunek ÷ 1,30 − 1 (porównanie „przy tym samym progu”, bo próg rośnie ×1,30 na zlecenie). Cel GDD: −15…−40%.

| Utrudnienie | Zlecenia | Zdawalność spec. | Zdawalność poprz. | Stosunek p25 / med / p75 | Δ vs zwykłe | k progu | Cel |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| big_format | 3543 | 95.4% | 100.0% | 0.72 / **1.00** / 1.38 | -27.7% | 0.85 | ✅ |
| failure | 1052 | 92.4% | 100.0% | 0.67 / **1.00** / 1.42 | -27.5% | 0.85 | ✅ |
| jam | 3583 | 89.8% | 100.0% | 0.63 / **0.98** / 1.40 | -28.8% | 0.70 | ✅ |
| leftover | 1081 | 91.2% | 100.0% | 0.66 / **1.04** / 1.47 | -24.4% | 0.85 | ✅ |
| out_of_ink | 1048 | 88.2% | 100.0% | 0.66 / **1.04** / 1.43 | -24.8% | 0.85 | ✅ |
| rows_only | 274 | 90.5% | 100.0% | 0.61 / **0.95** / 1.29 | -30.9% | 0.75 | ✅ |
| rush | 3615 | 92.9% | 100.0% | 0.64 / **0.91** / 1.26 | -34.1% | 0.80 | ✅ |
| short_tray | 1046 | 89.6% | 100.0% | 0.65 / **1.00** / 1.39 | -27.5% | 0.85 | ✅ |
| wet_ink | 1071 | 86.6% | 100.0% | 0.60 / **0.98** / 1.43 | -29.0% | 0.75 | ✅ |

**Edycje 7–8 (dwa utrudnienia):**

| Para / utrudnienie | Zlecenia | Zdawalność spec. | Zdawalność poprz. | Stosunek p25 / med / p75 | Δ vs zwykłe | k progu |  |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| out_of_ink (w parze) | 336 | 85.1% | 100.0% | 0.58 / **0.84** / 1.10 | -39.1% | 0.85 |  |
| wet_ink (w parze) | 327 | 92.7% | 100.0% | 0.62 / **0.84** / 1.11 | -38.8% | 0.75 |  |
| failure (w parze) | 322 | 87.0% | 100.0% | 0.59 / **0.87** / 1.06 | -37.1% | 0.85 |  |
| leftover (w parze) | 321 | 88.2% | 100.0% | 0.59 / **0.84** / 1.10 | -38.9% | 0.85 |  |
| jam (w parze) | 280 | 71.8% | 100.0% | 0.35 / **0.69** / 0.92 | -50.0% | 0.70 |  |
| short_tray (w parze) | 275 | 89.8% | 100.0% | 0.66 / **0.90** / 1.16 | -34.7% | 0.85 |  |
| rows_only (w parze) | 275 | 89.1% | 100.0% | 0.58 / **0.85** / 1.10 | -38.4% | 0.75 |  |
| rush (w parze) | 259 | 78.4% | 100.0% | 0.41 / **0.67** / 0.90 | -51.5% | 0.80 |  |
| big_format (w parze) | 245 | 80.0% | 100.0% | 0.45 / **0.71** / 0.90 | -48.3% | 0.85 |  |
| rush+leftover | 38 | 81.6% | 100.0% | 0.43 / **0.65** / 0.89 | -53.0% | 0.68 |  |
| rush+out_of_ink | 38 | 81.6% | 100.0% | 0.40 / **0.65** / 0.88 | -52.6% | 0.68 |  |
| jam+out_of_ink | 35 | 68.6% | 100.0% | 0.35 / **0.69** / 0.81 | -50.0% | 0.59 |  |
| big_format+wet_ink | 31 | 93.5% | 100.0% | 0.65 / **0.82** / 0.97 | -40.2% | 0.64 |  |
| big_format+leftover | 30 | 90.0% | 100.0% | 0.62 / **0.72** / 0.84 | -47.6% | 0.72 |  |
| rush+rows_only | 29 | 86.2% | 100.0% | 0.50 / **0.68** / 0.89 | -50.5% | 0.60 |  |
| rush+jam | 29 | 55.2% | 100.0% | 0.28 / **0.43** / 0.77 | -68.5% | 0.56 |  |
| out_of_ink+wet_ink | 28 | 92.9% | 100.0% | 0.69 / **0.88** / 1.17 | -36.1% | 0.64 |  |
| short_tray+leftover | 28 | 92.9% | 100.0% | 0.75 / **0.92** / 1.22 | -33.4% | 0.72 |  |
| wet_ink+failure | 28 | 92.9% | 100.0% | 0.60 / **0.91** / 1.20 | -34.4% | 0.64 |  |
| rows_only+short_tray | 28 | 92.9% | 100.0% | 0.82 / **0.92** / 1.47 | -33.6% | 0.64 |  |

## 6. Matryce — oferty, wybory, wyniki

Oferowana = liczba ekranów oferty (po przeładowaniach), na których karta była do wzięcia; „wybór” = wzięcia / oferowania (w tym eksploracja ε). Kolumny „z/bez przy #6/#12” = średnia wyrobionych zleceń runów, które dotarły do zlecenia 6 / 12 i miały / nie miały tej matrycy na jego starcie (korelacja, nie przyczynowość — patrz §7). „Zwycięstwa gdy na końcu” = odsetek zwycięstw wśród runów kończących z tą matrycą.

| Matryca | Rzadkość | Pula | Oferowana | Wzięta | Wybór | Z przy #6 (n) | Bez #6 | Z przy #12 (n) | Bez #12 | Zwycięstwa gdy na końcu (n) |
| :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `ink_pink` | zwykła | start | 5769 | 317 | 5.5% | 13.92 (222) | 14.22 | 15.42 (48) | 16.38 | — |
| `ink_orange` | zwykła | start | 5928 | 371 | 6.3% | 13.88 (256) | 14.23 | 14.48 (62) | 16.41 | — |
| `ink_yellow` | zwykła | start | 5785 | 371 | 6.4% | 14.18 (262) | 14.21 | 14.76 (58) | 16.40 | — |
| `ink_teal` | zwykła | start | 5817 | 366 | 6.3% | 14.42 (263) | 14.19 | 16.37 (67) | 16.36 | — |
| `ink_blue` | zwykła | start | 5897 | 344 | 5.8% | 13.76 (237) | 14.24 | 15.02 (42) | 16.39 | 100.0% (2) |
| `proof` | zwykła | start | 7283 | 1261 | 17.3% | 13.57 (1113) | 14.48 | 13.98 (107) | 16.47 | — |
| `guillotine` | zwykła | start | 7748 | 991 | 12.8% | 13.83 (769) | 14.30 | 15.96 (45) | 16.37 | — |
| `roller` | zwykła | start | 7570 | 967 | 12.8% | 13.20 (886) | 14.53 | 14.64 (33) | 16.39 | — |
| `margins` | zwykła | start | 7450 | 1170 | 15.7% | 13.62 (703) | 14.34 | 15.37 (349) | 16.52 | 100.0% (20) |
| `petit` | zwykła | start | 8056 | 399 | 5.0% | 13.29 (364) | 14.31 | 14.25 (4) | 16.37 | — |
| `poster` | zwykła | start | 5791 | 1995 | 34.5% | 14.22 (1231) | 14.20 | 16.03 (1137) | 16.62 | 100.0% (136) |
| `ream` | zwykła | start | 8378 | 84 | 1.0% | 14.53 (70) | 14.20 | 11.67 (3) | 16.37 | 0.0% (9) |
| `numerator` | zwykła | start | 7671 | 772 | 10.1% | 13.57 (702) | 14.35 | 15.00 (19) | 16.37 | — |
| `scrap` | zwykła | start | 7980 | 762 | 9.5% | 14.37 (549) | 14.18 | 15.17 (65) | 16.40 | 100.0% (3) |
| `first_impression` | zwykła | start | 4925 | 3057 | 62.1% | 13.56 (1600) | 14.71 | 16.01 (1764) | 17.08 | 100.0% (205) |
| `column_press` | rzadka | start | 5252 | 880 | 16.8% | 13.71 (403) | 14.27 | 14.75 (235) | 16.52 | 100.0% (10) |
| `monotype` | rzadka | start | 5232 | 940 | 18.0% | 14.29 (321) | 14.20 | 15.24 (304) | 16.51 | 100.0% (10) |
| `registration` | rzadka | odbl. | 4834 | 1318 | 27.3% | 13.74 (926) | 14.36 | 14.58 (358) | 16.64 | 100.0% (3) |
| `journeyman` | rzadka | start | 3861 | 1866 | 48.3% | 15.92 (1075) | 13.49 | 16.75 (1100) | 16.09 | 100.0% (217) |
| `archive` | rzadka | start | 4158 | 1437 | 34.6% | 14.65 (910) | 14.06 | 17.27 (830) | 15.95 | 100.0% (229) |
| `crossmark` | rzadka | odbl. | 5520 | 31 | 0.6% | 15.31 (26) | 14.20 | — | 16.36 | — |
| `type_case` | rzadka | odbl. | 5607 | 143 | 2.6% | 15.53 (92) | 14.17 | 11.50 (2) | 16.37 | — |
| `clean_sheet` | rzadka | odbl. | 4371 | 2120 | 48.5% | 12.93 (635) | 14.47 | 15.29 (1066) | 17.09 | 100.0% (82) |
| `stencil` | rzadka | odbl. | 5057 | 844 | 16.7% | 13.43 (793) | 14.42 | 12.88 (49) | 16.43 | — |
| `momentum` | rzadka | odbl. | 5327 | 243 | 4.6% | 14.36 (140) | 14.20 | 12.80 (15) | 16.39 | — |
| `conveyor` | rzadka | odbl. | 5614 | 34 | 0.6% | 12.74 (27) | 14.21 | — | 16.36 | — |
| `ink_well` | rzadka | start | 3451 | 2724 | 78.9% | 14.18 (1276) | 14.22 | 16.48 (1658) | 16.17 | 100.0% (201) |
| `gutenberg` | legend. | start | 2098 | 2015 | 96.0% | 19.88 (655) | 12.96 | 18.68 (1572) | 12.98 | 100.0% (405) |
| `hydraulic` | legend. | start | 4133 | 1507 | 36.5% | 14.71 (448) | 14.13 | 15.42 (589) | 16.64 | 100.0% (51) |
| `golden_type` | legend. | odbl. | 4688 | 708 | 15.1% | 14.86 (295) | 14.15 | 14.79 (126) | 16.44 | 100.0% (8) |
| `mirror` | legend. | odbl. | 2605 | 2022 | 77.6% | 14.96 (386) | 14.11 | 17.43 (1292) | 15.35 | 100.0% (399) |
| `split_fountain` | legend. | odbl. | 4784 | 680 | 14.2% | 14.22 (311) | 14.20 | 14.70 (130) | 16.45 | 100.0% (1) |

## 7. Eksperyment wymuszonego wyboru (pary seedów)

Dla każdego seeda: run bazowy (bot wybiera sam) oraz runy, w których przy **pierwszej ofercie** bot musi wziąć matrycę X (gdy X nie ma w ofercie, wstawiamy ją w miejsce ostatniej karty przez snapshot/restore; kolumna „wstaw.”) albo pominąć ofertę (`skip`, +3 arkusze). Dalej bot gra normalnie (może wymienić wymuszoną matrycę, gdy uzna ją za słabą). Pary, w których bot nie wyrobił zlecenia 1, są pominięte (identyczne w obu ramionach). Δ = różnica sparowana (X − bazowy) ± błąd standardowy. **Efekt** = X − pominięcie (ta sama para seedów): ile matryca daje względem „nic + 3 arkusze”. MARTWA: efekt ≤ 0 lub nieistotny (efekt − 2·SE ≤ 0). ZA SILNA: efekt > 2× mediany efektu (zwykła/rzadka) lub > 4× (legendarna). Mediana efektu: **2.703** zlecenia.

| Wybór | Rzadkość | Pary | Wstaw. | Δ zleceń vs bazowy | Δ zwycięstw [pp] | Efekt (zlecenia) vs skip | Efekt zwycięstw [pp] | × mediany | Werdykt |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gutenberg` | legendary | 295 | 284 | +6.73 ± 0.40 | +33.2 ± 3.0 | +9.64 ± 0.46 | +34.9 | 3.57 | ok |
| `journeyman` | rare | 295 | 283 | +1.27 ± 0.47 | +7.8 ± 2.2 | +4.19 ± 0.45 | +9.5 | 1.55 | ok |
| `registration` | rare | 295 | 269 | +1.14 ± 0.38 | +2.4 ± 2.0 | +4.05 ± 0.41 | +4.1 | 1.50 | ok |
| `roller` | common | 295 | 252 | +0.90 ± 0.36 | +3.4 ± 1.8 | +3.82 ± 0.43 | +5.1 | 1.41 | ok |
| `proof` | common | 295 | 250 | +0.77 ± 0.38 | +3.4 ± 1.8 | +3.68 ± 0.45 | +5.1 | 1.36 | ok |
| `hydraulic` | legendary | 295 | 284 | +0.71 ± 0.38 | +1.4 ± 1.7 | +3.63 ± 0.40 | +3.1 | 1.34 | ok |
| `numerator` | common | 295 | 245 | +0.66 ± 0.34 | +2.0 ± 1.8 | +3.58 ± 0.42 | +3.7 | 1.32 | ok |
| `scrap` | common | 295 | 253 | +0.60 ± 0.37 | +3.4 ± 1.8 | +3.52 ± 0.40 | +5.1 | 1.30 | ok |
| `crossmark` | rare | 295 | 279 | +0.53 ± 0.38 | +2.7 ± 1.9 | +3.44 ± 0.42 | +4.4 | 1.27 | ok |
| `conveyor` | rare | 295 | 272 | +0.39 ± 0.41 | +1.4 ± 1.9 | +3.31 ± 0.42 | +3.1 | 1.23 | ok |
| `stencil` | rare | 295 | 275 | +0.38 ± 0.39 | +4.4 ± 2.0 | +3.30 ± 0.45 | +6.1 | 1.22 | ok |
| `poster` | common | 295 | 236 | +0.24 ± 0.37 | +1.4 ± 1.7 | +3.16 ± 0.40 | +3.1 | 1.17 | ok |
| `golden_type` | legendary | 295 | 278 | +0.18 ± 0.39 | +1.7 ± 1.7 | +3.10 ± 0.39 | +3.4 | 1.15 | ok |
| `petit` | common | 295 | 263 | +0.00 ± 0.39 | +1.4 ± 1.7 | +2.92 ± 0.43 | +3.1 | 1.08 | ok |
| `split_fountain` | legendary | 295 | 281 | -0.06 ± 0.39 | +3.4 ± 1.8 | +2.86 ± 0.38 | +5.1 | 1.06 | ok |
| `column_press` | rare | 295 | 273 | -0.15 ± 0.40 | +3.1 ± 1.9 | +2.77 ± 0.43 | +4.7 | 1.03 | ok |
| `margins` | common | 295 | 255 | -0.28 ± 0.36 | +0.0 ± 1.6 | +2.63 ± 0.41 | +1.7 | 0.97 | ok |
| `first_impression` | common | 295 | 250 | -0.35 ± 0.34 | -0.7 ± 1.5 | +2.57 ± 0.41 | +1.0 | 0.95 | ok |
| `ink_blue` | common | 295 | 259 | -0.37 ± 0.40 | +2.0 ± 1.8 | +2.55 ± 0.42 | +3.7 | 0.94 | ok |
| `ink_orange` | common | 295 | 275 | -0.37 ± 0.38 | -1.4 ± 1.7 | +2.55 ± 0.43 | +0.3 | 0.94 | ok |
| `ink_yellow` | common | 295 | 261 | -0.47 ± 0.38 | +0.0 ± 1.7 | +2.45 ± 0.43 | +1.7 | 0.91 | ok |
| `ream` | common | 295 | 244 | -0.54 ± 0.41 | +0.7 ± 1.7 | +2.38 ± 0.37 | +2.4 | 0.88 | ok |
| `ink_well` | rare | 295 | 275 | -0.55 ± 0.44 | +2.0 ± 1.9 | +2.37 ± 0.43 | +3.7 | 0.88 | ok |
| `guillotine` | common | 295 | 254 | -0.67 ± 0.35 | +0.0 ± 1.5 | +2.24 ± 0.40 | +1.7 | 0.83 | ok |
| `ink_teal` | common | 295 | 271 | -0.74 ± 0.37 | +0.3 ± 1.6 | +2.18 ± 0.40 | +2.0 | 0.81 | ok |
| `momentum` | rare | 295 | 272 | -0.74 ± 0.41 | +2.7 ± 1.9 | +2.18 ± 0.38 | +4.4 | 0.81 | ok |
| `ink_pink` | common | 295 | 256 | -0.83 ± 0.42 | +0.3 ± 1.8 | +2.09 ± 0.43 | +2.0 | 0.77 | ok |
| `type_case` | rare | 295 | 270 | -0.85 ± 0.44 | +0.3 ± 1.8 | +2.07 ± 0.41 | +2.0 | 0.77 | ok |
| `archive` | rare | 295 | 267 | -0.85 ± 0.46 | +4.4 ± 2.0 | +2.07 ± 0.38 | +6.1 | 0.76 | ok |
| `mirror` | legendary | 295 | 289 | -0.97 ± 0.44 | +2.7 ± 1.8 | +1.95 ± 0.39 | +4.4 | 0.72 | ok |
| `monotype` | rare | 295 | 274 | -1.19 ± 0.40 | +2.0 ± 1.9 | +1.73 ± 0.43 | +3.7 | 0.64 | ok |
| `clean_sheet` | rare | 295 | 274 | -1.39 ± 0.42 | -0.3 ± 1.8 | +1.53 ± 0.41 | +1.4 | 0.57 | ok |
| `skip` | pominięcie | 295 | 0 | -2.92 ± 0.45 | -1.7 ± 1.6 | +0.00 ± 0.00 | +0.0 |  |  |

**Martwe (0):** —

**Za silne (0):** —

## 8. Polityki przeładowań i dodruku

Te same seedy dla każdej polityki; Δ względem `reroll=none,continue=never` (sparowane). Cel GDD: różnica zwycięstw „0 przeładowań” vs „maks.” ≤ +3 pp.

| Polityka | Runy | Śr. zlecenia | Zwycięstwa | Darmowe przeł. | Reklamowe przeł. | Dodruk użyty | Δ zleceń / Δ zwycięstw |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| reroll=ads,continue=always | 2000 | 16.06 | 18.6% ± 0.9% | 0.95 | 2.53 | 88.9% | +2.83 ± 0.12 / +8.9 ± 0.8 pp |
| reroll=ads,continue=never | 2000 | 13.55 | 11.6% ± 0.7% | 0.85 | 2.18 | 0.0% | +0.32 ± 0.08 / +1.8 ± 0.6 pp |
| reroll=free,continue=always | 2000 | 15.72 | 16.3% ± 0.8% | 0.95 | 0.00 | 90.6% | +2.49 ± 0.11 / +6.6 ± 0.6 pp |
| reroll=free,continue=never | 2000 | 13.35 | 10.0% ± 0.7% | 0.85 | 0.00 | 0.0% | +0.11 ± 0.06 / +0.3 ± 0.4 pp |
| reroll=none,continue=always | 2000 | 15.48 | 15.3% ± 0.8% | 0.00 | 0.00 | 90.6% | +2.25 ± 0.09 / +5.7 ± 0.5 pp |
| reroll=none,continue=never | 2000 | 13.23 | 9.7% ± 0.7% | 0.00 | 0.00 | 0.0% | (odniesienie) |

## 9. Generator tac

Rozdania: **257 331** · fallback konstrukcyjny: **92 (0.036%)** · próbkowane przez `dealTray`: 257 331 (niezgodności z silnikiem: 0) · węzły solvera: średnio 1.4, maks. 2 713 · czas rozdania (Node, ten komputer): p50 ≤ 0.1 ms, p99 ≤ 0.1 ms, maks. 59.02 ms (cel GDD: p99 ≤ 4 ms na urządzeniu referencyjnym).

| Próby | Rozdania | % |
| :--- | ---: | ---: |
| 1 | 254413 | 98.87% |
| 2 | 1283 | 0.50% |
| 3 | 500 | 0.19% |
| 4 | 250 | 0.10% |
| 5 | 172 | 0.07% |
| 6 | 128 | 0.05% |
| 7 | 204 | 0.08% |
| 8 | 120 | 0.05% |
| 9 | 72 | 0.03% |
| 10 | 46 | 0.02% |
| 11 | 26 | 0.01% |
| 12 | 117 | 0.05% |

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
| 0 | 91 | 167 | 496 | 550 | 1.92 |
| 1 | 167 | 246 | 647 | 287 | 1.56 |
| 2 | 246 | 326 | 806 | 223 | 1.41 |
| 3 | 326 | 406 | 971 | 206 | 1.33 |
| 4 | 406 | 482 | 1 127 | 234 | 1.27 |
| 5 | 482 | 560 | — | 0 | — |
| 6 | 560 | 635 | — | 1 | — |
| 7 | 635 | 724 | — | 3 | — |
| 8 | 724 | 799 | 1 672 | 5 | 1.10 |
| 9 | 799 | 860 | — | 0 | — |
| 10 | 860 | 960 | — | 1 | — |
| 11 | 960 | 1 012 | — | 1 | — |
| 12 | 1 012 | — | — | 0 | — |

**Z danych bota — wszystkie druki (z matrycami):**

| SERIA s | Single @s | Single @s+1 | Dublet @s | n dubletów | Stosunek |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 0 | 19 927 | 18 157 | 42 835 | 6200 | 1.12 |
| 1 | 18 157 | 19 513 | 43 480 | 3272 | 1.15 |
| 2 | 19 513 | 20 001 | 43 257 | 2273 | 1.09 |
| 3 | 20 001 | 18 979 | 43 455 | 1617 | 1.11 |
| 4 | 18 979 | 23 396 | 41 599 | 1050 | 0.98 |
| 5 | 23 396 | 23 588 | 66 777 | 583 | 1.42 |
| 6 | 23 588 | 21 044 | 72 635 | 320 | 1.63 |
| 7 | 21 044 | 15 844 | 53 437 | 163 | 1.45 |
| 8 | 15 844 | 8 813 | 34 155 | 79 | 1.39 |
| 9 | 8 813 | 5 413 | 13 618 | 18 | 0.96 |
| 10 | 5 413 | 3 981 | 10 764 | 12 | 1.15 |
| 11 | 3 981 | 2 254 | — | 2 | — |
| 12 | 2 254 | 2 063 | — | 0 | — |

## 11. Wydajność bota i symulatora

| Miara | Wartość |
| :--- | ---: |
| decyzje (ułożenia) | 681 852 |
| ms / decyzja — średnio | 0.442 |
| ms / decyzja — mediana (przedział) | 0.1–0.2 |
| ms / decyzja — p90 / p99 (przedział od) | 0.5 / 6.0 |
| ms / decyzja — maks. | 547.5 |
| węzły planera / decyzja | 344 |
| decyzje z poszerzonym ponownym wyszukiwaniem | 17 (0.00%) |
| ms / run — mediana / p90 (w wątku roboczym) | 80.3 / 189.8 |
| ostatni wsad (meta.json): czas ścienny · przepustowość | 105 s · 2292 runów/min · 4 wątki; 142 s · 4301 runów/min · 4 wątki; 177 s · 4079 runów/min · 4 wątki |

## 12. Ostatnia szansa, dodruk, Kaszta

Polityki w tej próbie: free/never. Sprzedaże w „Ostatniej szansie”: 4609 zleceń (uratowane: 1080, 23.4%). Dodruk użyty w 0 runach (0.0%); zlecenie uratowane po dodruku: 0. Przyczyny dodruku: —. Runy z Kasztą: 141, odłożeń: 1622 (11.5 na run).

### 12a. To samo dla próby polityk (z dodrukiem)

Polityki w tej próbie: none/never, none/always, free/never, free/always, ads/never, ads/always. Sprzedaże w „Ostatniej szansie”: 15125 zleceń (uratowane: 4812, 31.8%). Dodruk użyty w 5403 runach (45.0%); zlecenie uratowane po dodruku: 3966. Przyczyny dodruku: quota 5403. Runy z Kasztą: 421, odłożeń: 4387 (10.4 na run).

## 13. Uwagi (automatyczne)

- brak odchyleń od celów

## 14. Parametry uruchomienia i wartości balansu

Wejścia: `/tmp/claude-0/sim/final/base`, `/tmp/claude-0/sim/final/forced`, `/tmp/claude-0/sim/final/policies` · rekordów: **26200** · wygenerowano: 2026-10-07T22:07:11.515Z

Bot: beam search (szerokość 8, scalanie stanów, wyszukiwanie z odkładaniem do Kaszty), ε-eksploracja ofert = 0.05, pula: all. Polityka główna: `reroll=free,continue=never` (darmowe przeładowanie przy słabej ofercie, bez dodruku).

| Grupa · wariant | Runy |
| :--- | ---: |
| forced · base | 300 |
| forced · force=archive | 300 |
| forced · force=clean_sheet | 300 |
| forced · force=column_press | 300 |
| forced · force=conveyor | 300 |
| forced · force=crossmark | 300 |
| forced · force=first_impression | 300 |
| forced · force=golden_type | 300 |
| forced · force=guillotine | 300 |
| forced · force=gutenberg | 300 |
| forced · force=hydraulic | 300 |
| forced · force=ink_blue | 300 |
| … (+29 wariantów) | 22600 |

<details><summary>BALANCE (src/core/config/balance.ts)</summary>

```json
{
 "cellPrints": 10,
 "monoLineMult": 2,
 "streakGrace": 3,
 "editions": 8,
 "contractsPerEdition": 3,
 "baseSheets": 20,
 "quotaStart": 1000,
 "quotaGrowth": 1.38,
 "specialFactor": 1,
 "modifierQuota": {
  "rush": 0.8,
  "big_format": 0.85,
  "wet_ink": 0.75,
  "jam": 0.7,
  "out_of_ink": 0.85,
  "leftover": 0.85,
  "failure": 0.85,
  "short_tray": 0.85,
  "rows_only": 0.75
 },
 "doubleModifierFromEdition": 7,
 "earlyShare4Cards": 0.5,
 "earlyShareRare": 0.3,
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
  "common": 50,
  "rare": 35,
  "legendary": 15
 },
 "rarityLateFromEdition": 4,
 "failureWeights": {
  "common": 1,
  "rare": 2,
  "legendary": 3
 },
 "failureSheets": 6,
 "colorAffinityWeight": 1,
 "bigFormatFactor": 3,
 "dealRetries": 12,
 "dealRetriesBeforeSmallBias": 6,
 "rushSheets": 14,
 "bigFormatSheets": 12,
 "jamCount": [
  5,
  5,
  5,
  5,
  5,
  5,
  5,
  5
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
 "rollerMult": 2,
 "marginsPrints": 120,
 "petitMult": 5,
 "petitMaxSize": 3,
 "posterPrints": 120,
 "posterMinSize": 4,
 "reamSheets": 3,
 "numeratorPerStreak": 1,
 "scrapPerPlacement": 30,
 "scrapMax": 300,
 "firstImpressionX": 2,
 "firstImpressionSheets": 12,
 "columnPressX": 2,
 "monotypeX": 2,
 "monotypeMaxInks": 2,
 "registrationPerInk": 2,
 "journeymanStart": 0,
 "journeymanStep": 1,
 "archiveStep": 2,
 "crossmarkMult": 5,
 "typeCaseSheets": 2,
 "cleanSheetX": 3,
 "cleanSheetMaxCells": 8,
 "stencilPerEmpty": 0.5,
 "momentumPerStreak": 0.1,
 "conveyorGrace": 1,
 "conveyorCarry": 0.5,
 "inkWellStep": 4,
 "gutenbergStart": 1.5,
 "gutenbergStep": 0.25,
 "hydraulicX": 1.5,
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
