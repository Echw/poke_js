# Ice Reveal

Current loading, ICEMIST4 compression and resource ownership are documented in [LOADING.md](LOADING.md#lossless-preload-optimization). Historical file sizes and codec descriptions below predate the lossless transcode; density fields and the visual design are unchanged.

Ice łączy kartę i kryształy z przestrzenną mgłą. Animacja trwa 3,5 s; nie ma panelu ustawień ani osobnego trybu mgły. Pozostałe warianty revealu zachowują swoje animacje.

## Lodowa korona i karta

Korona wysuwa się między 0,4 a 1,1 s, zachowując wielkość i kształt każdej bryły. Instance matrices przesuwają kryształy wzdłuż ich osi; stała płaszczyzna we wnętrzu kuli ukrywa schowane części. Nie ma losowego rozpadu ani prostokątnego wycinania miejsca na kartę. Wysokie kryształy cofają się od 2,15 s, a krótkie kończą chowanie przed 2,85 s.

Desktop ma 9 większych i 9 mniejszych kryształów, z czego 5 tworzy przedni łuk. Mobile ma 6 większych i 6 mniejszych, w tym 3 z przodu. Korona jest asymetryczna, z najwyższą bryłą na lewo od środka i niższym środkiem. Trzy zamknięte warianty `ConvexGeometry` mają rzeczywiste skośne fasety, różne przekroje i zakończenia. Przednie odłamki są wydłużone, pochylone na zewnątrz i do przodu; pozostają przed pochyloną kartą i obejmują jej dolną ćwiartkę. 24/12 drobinek wystrzeliwuje przy wysuwaniu, obraca się i opada. Wszystkie transformy wynikają bezpośrednio z czasu, bez akumulowania kroków animacji.

`iceMaterial.ts` zawiera wspólne funkcje szumu i szczelin oraz fizyczny materiał korony. Kryształy korzystają z `MeshPhysicalMaterial`: `ior=1.31`, `transmission=0.82`, `roughness=0.035`, `opacity=1`. Każdy wariant przekazuje rzeczywiste półprzestrzenie otaczających go faset do shadera. Załamany promień przecina tę wypukłą bryłę; długość drogi w świecie steruje absorpcją, a trzy próbki wewnątrz bryły pokazują różne warstwy nieciągłych spękań i zmętnienia. Transformacja kierunku z przestrzeni świata uwzględnia niejednorodne skalowanie instancji. Stałe ziarno instancji różnicuje wzory; zmiana kierunku patrzenia zmienia położenie widocznych warstw względem powierzchni.

Ice tworzy raz prywatne środowisko odbić: proceduralne HDR 256×128 z trzema miękkimi panelami białobłękitnego światła, przefiltrowane przez PMREM istniejącym rendererem. Nie zmienia ono tła ani materiałów Poké Balla. Materiały korony i odłamków współdzielą wynik; efekt zwalnia target przy `dispose()`. Jasność grzbietów zależy od kąta patrzenia, refleksu i światła podstawy, a współpłaszczyznowe przekątne triangulacji są pomijane. Nie ma stałego technicznego obrysu ani jednolitego rozświetlania całych ścian. Transmisja tła nadal korzysta z natywnego przebiegu Three.js, bez wielokrotnego załamywania obrazu kolejnych przezroczystych kryształów.

Od 1,45 s karta ma osobną, nieprzezroczystą powierzchnię lodową z odbiciami i szczelinami. Od 2,15 do 2,85 s shader miesza ją z właściwą grafiką. Dzięki zapisowi głębi powierzchnia trafia do bufora transmisji przed renderowaniem kryształów. Oryginalny obrys, narożniki i halo karty pozostają aktywne; halo osiąga dotychczasową siłę 0,64 już w fazie frozen i utrzymuje ją po odsłonięciu grafiki. Zmiana typu przywraca pierwotne materiały karty. Klony materiałów współdzielą tekstury, ale nie przejmują ich ownership.

## Zegar i dane

Przez pierwsze 0,8 s zegar mgły biegnie 1×, zgodnie z otwieraniem pokrywy. Od 0,8 do 1,0 s prędkość płynnie wzrasta przez smoothstep do 51/26×, następnie pozostaje stała. Przy 3,5 s revealu osiąga dokładnie 6 s oryginalnej symulacji. Kontrakt opisuje `smokeTiming.ts`.

Każdy profil zawiera 211 stanów przy 60 FPS. Klatka wybiera oryginalny stan przez `smokeSourceFrame()`, bez interpolowania pól. Desktop zachowuje siatkę gęstości 128³, mobile 96³. Pełnej jakości fallback korzysta z solvera MAC 64³/48³ i tego samego mapowania czasu.

Zasoby Vite w `src/assets/mist-replay` to wyłącznie:

| Profil | Plik | Rozmiar | Poprzednie paczki FP16 |
| --- | --- | ---: | ---: |
| Desktop | `ice-desktop.bin` | 21 626 458 B | 64 868 966 B |
| Mobile | `ice-mobile.bin` | 9 563 893 B | 29 607 305 B |

Łącznie **31 190 351 B**, około **67% mniej**. Urządzenie pobiera tylko swój profil. Vite nadaje obu plikom hashowane nazwy produkcyjne.

Integracja [Fighting Reveal](FIGHTING_REVEAL.md) dodała identyfikator wariantu i hash wspólnej konfiguracji do nagłówka. Ponowny eksport potwierdził identyczność wszystkich 422 oryginalnych pól Ice oraz 422 pól po kwantyzacji. Wzrost o 101 B na plik dotyczy metadanych; ruch, gęstość i paleta Ice pozostały bez zmian.

Kontener `ICEMIST3` ma 16-bajtowy prefiks: osiem bajtów sygnatury, długość nagłówka JSON i długość danych, obie uint32 little-endian. Nagłówek zawiera metadane animacji, układ atlasu, preset, tożsamość źródeł/modelu/otwierania, paletę FP16 oraz położenia segmentów względem początku danych. Osobny manifest nie jest potrzebny.

Wybrany zapis ma skalę pierwiastkową 8-bitową: `round(255*sqrt(density/3))`, z dokładnym zerem. Paleta odtwarza `FP16(3*(code/255)^2)`. Jest to kwantyzacja wartości gęstości, zaakceptowana na podstawie porównania obrazu; nie jest zapisem bitowo identycznym z pierwotnym FP16. `sourceSHA256` identyfikuje oryginał, `densitySHA256` odtworzony atlas FP16. Format obsługuje również 12 bitów i dokładne FP16 do kolejnych porównań.

Każdy segment zawiera do czterech klatek: pierwszą pełną, kolejne jako XOR względem poprzedniej, następnie gzip. Przy 12 bitach dwie próbki zajmują trzy bajty. SHA-256 sprawdza nagłówek oraz każdy skompresowany segment. Hashe źródeł normalizują końce linii do LF; zmiana presetu, solvera, modelu lub otwierania wymaga ponownego eksportu.

## Odtwarzanie i zasłanianie

Pierwsze `play('ice')` pokazuje status przygotowania, pobiera właściwy plik i przygotowuje pipeline przed startem zegara. Worker przechowuje skompresowany kontener w RAM, sprawdza integralność i rozpakowuje tylko potrzebne segmenty. Przywraca FP16 przez paletę przed przekazaniem bufora do wątku głównego. Nie ma CacheStorage ani zapisu na dysku.

Odtwarzacz utrzymuje najwyżej dwa rozpakowane segmenty oraz dwa targety GPU R16F. Upload występuje tylko po zmianie klatki; pauza i tempo 0,2× nie powtarzają uploadu tego samego stanu. Rozdzielczość i koszt tekstur GPU nie zmieniły się. Desktop rezerwuje 8 650 752 B na dwie tekstury pola i do 34 603 008 B na dwa segmenty CPU, poza skompresowanym plikiem i przejściowymi buforami Workera.

`ready`, `prepare(time)`, `advanceTo(time)`, `reset()` i `dispose()` przyjmują sekundy revealu. Przy braku przygotowanej klatki pauzuje cała oś czasu. Zmiana efektu unieważnia oczekujący start; ukrycie dokumentu pauzuje animację. Błąd pliku, sumy kontrolnej lub zgodności uruchamia zachowany solver. Podczas normalnego odtwarzania bufory i materiały solvera nie są tworzone.

Depth pass obejmuje model, aktualne pozycje kryształów i lodową płytkę karty od chwili jej pojawienia. Korona i drobinki używają w tym przebiegu `MeshDepthMaterial` z tą samą płaszczyzną ukrycia; fizyczna transmisja nie uruchamia dodatkowego przebiegu w renderowaniu głębi. Zmiany pola, kamery, rozmiaru, karty, kryształów i parametrów unieważniają gotowy target mgły. Oświetlenie nadal korzysta z 8/6 próbek światła, 128/96 kroków promienia i targetu 0,75/0,6. Shader nie dekoduje danych. Nie dodano renderera, canvasa, RAF ani panelu. Pomiarowe zapytania GPU są wyłączone w produkcji.

Wygląd mgły jest niezależny od jej zapisanej gęstości. `gpuSmokeRender.ts` nadaje mlecznobłękitne oświetlenie, łagodne szaroniebieskie cienie i jaśniejsze rozpraszanie przy podstawie; `uIceLight` osiąga maksimum przy pełnej koronie i wygasa po rozpoczęciu odsłaniania karty. Ten uniform uczestniczy w kluczu cache. Pola, alpha wynikająca z gęstości, trajektorie, tempo i zasoby replay pozostają bez zmian. Istniejąca poświata podstawy ma osobny wariant Ice z niewielkim białym rdzeniem i niebieską otoczką, a istniejący point light osiąga intensywność 2,8. Nie dodano globalnego bloom.

## Narzędzia

- `pnpm dev` — aplikacja; `?reveal=ice` uruchamia pełny Ice developersko.
- `pnpm smoke:export --reference` — odtwarza solver przez istniejącą scenę i zapisuje dwa kontenery. Wymaga Vite na porcie 5173. Opcjonalne `--bits=8`, `--bits=12`, `--bits=16` wybiera kodowanie; `--output=<katalog>` pozwala kontrolować wynik poza repo. Oba profile powstają najpierw poza repo; następnie zastępują zasoby. `--reference` zachowuje również dokładne kontenery FP16 w wypisanym katalogu tymczasowym.
- `pnpm test:ice:visual` — porównuje wszystkie 211 klatek obu profili z przodu i z boku. Wymaga zmiennej `ICE_CLIP_REFERENCE` wskazującej katalog z `reference-desktop.bin` i `reference-mobile.bin`. `--motion` zapisuje rzeczywiste filmy obu wersji z obu kamer przy 1× i 0,2×. Wyniki i obrazy trafiają poza repo.
- `pnpm test:ice` — wszystkie stany CPU/GPU, przewijanie, restart, resize, pozostałe warianty, fallback, lifecycle i pomiar całej sceny Full HD. `--extra` uruchamia same scenariusze błędów i lifecycle, `--authoring` kontroluje eksport z solvera.
- `node scripts/verify-ice-crown.mjs` — ruch sztywnych brył, trzy zamknięte warianty z poprawnym kierunkiem ścian, prywatne i ponownie używane środowisko odbić, przedni łuk względem pochylonej karty, emisja podczas wysuwania, zachowany glow, przewijanie, przywracanie materiałów, resize i uruchomienie formularzem. Zapisuje 48 kadrów z obu kamer i profili, w tym pełną koronę przy 1,25 s. `--motion` dodaje 8 nagrań canvasa przy 1× i 0,2×. Wymaga Vite na porcie 5173; `ICE_CROWN_QA_DIR` opcjonalnie wskazuje katalog wyników.
- `pnpm build` — TypeScript i build produkcyjny. Po uruchomieniu `pnpm preview --port 5175`, `pnpm test:ice --production` sprawdza formularz wszystkich sześciu wariantów, pojedynczy pobrany profil i brak solvera w zwykłym Ice. Dodanie `--mobile` sprawdza produkcyjny wybór drugiego pliku w wąskim oknie.

Automatyzacja używa Playwright z `SATAKU_3D_AGENT_ROOT`. To samodzielna aplikacja Vite; nie instaluje runtime'u Sataku. Zrzuty diagnostyczne GPU są tworzone wyłącznie na żądanie testów.

## Wyniki kontroli

### Jaśniejsza, mlecznobłękitna mgła — 2026-11-08

Zmieniono wyłącznie trzy składowe radiancji mgły: światło otoczenia, rozproszenie kierunkowe i podświetlenie podstawy. Ograniczono nasycenie granatu i podniesiono jasność. Build TypeScript/Vite przeszedł. Podgląd WebGL obu profili przy 1,25/1,8/2,4 s nie wykazał błędów shaderów; we wszystkich sześciu stanach hashe pól CPU i GPU pozostały zgodne z zapisanymi danymi. Oceniono czytelność kryształów i glow karty. Kadry i raport: `C:/Users/Ewa-komp/AppData/Local/Temp/ice-mist-pale-1794130395294`. Zmiana palety nie dodaje operacji ani przebiegów renderowania; poniższy pomiar GPU dotyczy wcześniejszej palety.

### Szkliste wnętrze i chłodne światło — 2026-11-08

Build TypeScript/Vite, `verify-ice-crown.mjs --motion` i pełny `verify-ice-integration.mjs` przeszły dla nowego wyglądu. Test potwierdza trzy zamknięte, poprawnie zorientowane warianty o dodatniej objętości, wspólne prywatne środowisko inne niż środowisko sceny i ponowne użycie tego samego targetu po przewijaniu i przełączaniu efektów. Zachowane są 18/12 brył, 5/3 przednie odłamki, 24/12 drobinek przy wysuwaniu, sztywny ruch, identyczne macierze po cofnięciu, halo karty 0,64 oraz przywracanie materiałów innych efektów. Pełny test integracji ponownie potwierdził wszystkie 422 stany CPU/GPU, fallback oraz zwolnienie geometrii i tekstur, w tym nowego PMREM.

Zapisano **48 kadrów i 8 nagrań canvasa**. Oceniono pełną koronę przy 1,25 s z przodu i z boku, materiał przy zmianie kierunku patrzenia, frozen kartę przy 1,8 s, odsłanianie przy 2,4 s oraz wybrane fazy rzeczywistych nagrań. Katalog: `C:/Users/Ewa-komp/AppData/Local/Temp/ice-crown-1794129791290`; raport integracji: `C:/Users/Ewa-komp/AppData/Local/Temp/poke-ice-qa-1794129939313`. Nagrania 1× trwały 3502–3518 ms, a 0,2×: 17492–17519 ms. Ocenę obrazu i nagrywanie wykonano osobno od pomiaru GPU.

RTX 3050, ANGLE/D3D11, 1920×1080: mediana całej sceny **6,21 ms**, p95 **8,16 ms**, czas odtwarzania w pomiarze **3491 ms**. Poprzedni lokalny wynik wynosił 6,49/8,50 ms. Oba pojedyncze przebiegi mieszczą się w budżecie p95 ≤16,7 ms; nie stanowią dowodu przyspieszenia ani prognozy dla innych urządzeń. Profil mobile nadal oznacza wąskie okno na tej samej karcie GPU. Formalna walidacja Sataku zachowuje opisaną poniżej lukę adaptera; nie instalowano jej runtime'u ani nie zmieniano firmowych narzędzi.

### Korona fizyczna i frozen + glow — 2026-11-08

Build TypeScript/Vite oraz `verify-ice-crown.mjs --motion` i pełny `verify-ice-integration.mjs` przeszły. Test korony potwierdził 18/12 brył, 5/3 przednich kryształów przed pochyloną kartą, 24/12 aktywnych drobinek przy 0,75 s, stałą skalę podczas ruchu, identyczne instance matrices po cofnięciu czasu, halo 0,64 w fazie frozen oraz przywrócenie materiałów dla pięciu pozostałych efektów. Sprawdzono też formularz Summon, zmianę rozmiaru i powrót do Ice. Wszystkie 422 stany pola CPU/GPU pozostały zgodne; pełny test obejmuje fallback i zwolnienie zasobów.

Zapisano 44 kadry i 8 rzeczywistych nagrań canvasa: oba profile, obie kamery i tempo 1×/0,2×. Oceniono wybrane kadry z przodu i z boku oraz sekwencje klatek wyciągnięte z nagrań. Pliki i raport korony: `C:/Users/Ewa-komp/AppData/Local/Temp/ice-crown-1794127259304`; raport integracji: `C:/Users/Ewa-komp/AppData/Local/Temp/poke-ice-qa-1794127394833`. Mobile oznacza profil wąskiego okna na RTX, nie test fizycznego telefonu.

RTX 3050, ANGLE/D3D11, 1920×1080: mediana GPU całej sceny **6,49 ms**, p95 **8,50 ms**, czas revealu **3642 ms**. Wcześniejszy pomiar w tej dokumentacji wynosił 5,49/7,83 ms; różnica to około +1,00/+0,67 ms, z zachowaniem budżetu p95 ≤16,7 ms. Jest to porównanie dwóch pomiarów lokalnych, bez gwarancji wydajności na innych urządzeniach. Nagrywanie wideo wykonano osobno.

Przygotowanie i review `3d-change` zapisano w kanonicznym `.3d-workflow/ice-crown`. Standardowy harness Sataku wymaga `src/scripts/display.js`, a walidator kampanii wymaga kanonicznego `src/scripts/3D.js`; ten projekt jest samodzielną aplikacją Vite i nie zawiera tych plików. Podgląd aplikacji nie jest raportowany jako zaliczony harness Sataku. Nie instalowano runtime'u ani nie zmieniano firmowych narzędzi w celu obejścia tych warunków.

### Wcześniejsza walidacja zapisu mgły

Zweryfikowano mapowanie wszystkich 422 stanów do oryginalnych hashy FP16 oraz zgodność odtworzonych atlasów CPU i GPU z hashami nowego kontenera. Wszystkie **844 porównania końcowego obrazu** w obszarze mgły przeszły progi średniej ≤1/255 i p99 ≤3/255. Najgorsze średnie: desktop **0,0611/255**, mobile **0,06394/255**; najgorsze p99 obu profili **1/255**. Porównania obejmują rant, cienie, cienkie zakończenia i wygaszanie. Odtworzone pola po cofnięciu są bitowo identyczne; test obrazu dopuszcza jeden poziom RGB przy rasteryzacji krawędzi kryształów.

RTX 3050 6GB Laptop, ANGLE/D3D11, 1920×1080: GPU całej sceny mediana **5,49 ms**, p95 **7,83 ms**, rzeczywisty czas revealu **3587 ms**. Pomiar obejmuje upload, model, kryształy, kartę, głębię, mapę zajętości, renderowanie mgły i kompozycję. CPU dekodowania segmentu: mediana **41 ms**, p95 **54 ms**; CPU uploadu: mediana **0,5 ms**, p95 **0,7 ms**. Pobranie i weryfikacja desktopowego pliku na lokalnym serwerze trwały około **183 ms**, przygotowanie źródła około **321 ms**. To nie prognoza czasu pobierania przez internet. Ta zmiana zmniejsza głównie pobieranie i pamięć skompresowanych danych; nie obniża jakości renderowania ani rozdzielczości GPU.

Zapisano 16 rzeczywistych nagrań: oryginalne FP16 i nowy zapis, oba profile, obie kamery, 1× i 0,2×. Nowy zapis odtwarzał się w **3505–3530 ms** przy 1× oraz **17504–17518 ms** przy 0,2×. Nagrywanie nie służyło do pomiaru GPU. We wszystkich przebiegach pozostały najwyżej dwa segmenty CPU, a liczba przebiegów solvera wynosiła zero.

Profil mobile sprawdzono na RTX, nie na fizycznym telefonie. SwiftShader nie jest podstawą tych wyników. Ukrycie/powrót sprawdzono kontraktem zdarzenia widoczności dokumentu. Szczegółowe wyniki i nagrania pozostają w katalogach tymczasowych systemu.

Licencje i źródła odniesienia: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
