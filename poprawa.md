# Plan poprawek po audycie architektury

Ten dokument zbiera najwazniejsze rzeczy do poprawy w projekcie `tracker`.
Priorytety sa ustawione pod jakosc danych, bezpieczenstwo i utrzymywalnosc.

Status walidacji z audytu:

- `pnpm typecheck` - OK
- `pnpm lint` - OK
- `pnpm test` - OK, 110 testow
- `pnpm build` - OK, ale z ostrzezeniami o duzych chunkach
- `cargo check` - OK
- `cargo clippy -- -D warnings` - OK
- `pnpm test:cov` - FAIL, brak `@vitest/coverage-v8`

## P0 - krytyczne

### 1. Zastap `withTx` prawdziwymi transakcjami

Problem:

`src/lib/db/tx.ts` serializuje operacje, ale nie robi prawdziwej transakcji. Komentarz wprost mowi, ze awaria w polowie zostawia czesciowy stan. To jest najwieksze ryzyko utraty spojnosci danych.

Dotkniete miejsca:

- `src/lib/db/tx.ts`
- `src/lib/db/queries.ts`
- `src/lib/db/workspaceQueries.ts`
- `src/lib/assignments/assignmentService.ts`
- `src/lib/activity/activityLog.ts`

Ryzyko:

- workspace bez membershipu
- event bez outbox rowa albo activity logu
- soft delete zasobu bez soft delete eventow
- czesciowo przepisane sciezki drzewa
- niespojny `cached_minutes`

Proponowane rozwiazanie:

1. Przeniesc krytyczne mutacje SQLite do Rust/Tauri commands.
2. Uzyc `sqlx::Transaction` po stronie Rust.
3. Zrobic komendy per use case, np.:
   - `create_resource`
   - `rename_resource`
   - `move_resource`
   - `soft_delete_subtree`
   - `create_event`
   - `update_event`
   - `delete_event`
   - `create_workspace`
   - `delete_membership`
4. Frontend powinien wolac domenowe komendy, a nie skladac wielokrokowe operacje SQL samodzielnie.

Kryteria akceptacji:

- awaria w polowie operacji nie zostawia czesciowych danych
- test integracyjny potwierdza rollback dla minimum `createWorkspace`, `createEvent`, `moveResource`
- komentarze "single transaction" w TS sa prawdziwe albo usuniete

### 2. Napraw mapowanie `events.user_id` w sync

Problem:

`mapToCloud()` w `src/lib/sync/worker.ts` zawsze nadpisuje `user_id` aktualnie zalogowanym uzytkownikiem. Po Fazie 6 `events.user_id` oznacza autora logu, wiec edycja cudzego wpisu moze zmienic autora.

Dotkniete miejsca:

- `src/lib/sync/worker.ts`
- `src/lib/sync/__tests__/worker.test.ts`
- `src/lib/sync/__tests__/tick.test.ts`
- `src/components/History/HistoryView.tsx`

Proponowane rozwiazanie:

1. Rozdzielic mapery:
   - `mapResourceToCloud(data, currentUserId)` - moze nadal uzupelniac legacy `user_id`, jesli schema tego wymaga
   - `mapEventToCloud(data)` - musi zachowac `data.user_id`
   - `mapActivityLogToCloud(data)` - musi zachowac autora wpisu
2. Usunac test, ktory utrwala bledne zalozenie, ze kazdy payload dostaje `user_id = currentUserId`.
3. Dodac test: edycja eventu stworzonego przez user A, wyslana przez user B, nadal ma `user_id = A`.

Kryteria akceptacji:

- team report nie zmienia autorstwa po edycji
- sync eventow zachowuje `payload.user_id`
- testy pokrywaja ten przypadek

### 3. Napraw semantyke hard delete dla `workspace_memberships`

Problem:

`lwwMerge()` traktuje lokalny wiersz, ktorego nie ma w chmurze, jako local-only i wrzuca go do outboxa. To jest niebezpieczne dla encji usuwanych hard delete, szczegolnie `workspace_memberships`.

Dotkniete miejsca:

- `src/lib/sync/merge.ts`
- `src/lib/sync/pull.ts`
- `src/lib/db/workspaceQueries.ts`
- `src/store/workspace.ts`

Ryzyko:

- usuniety czlonek moze zostac "wskrzeszony" przez lokalny pull/push
- lokalny klient z opoznionym syncem moze odtworzyc membership po usunieciu przez ownera

Proponowane rozwiazanie:

Opcja preferowana:

1. Nie robic hard delete membershipow.
2. Dodac `deleted_at` do `workspace_memberships`.
3. Ujednolic model z reszta aplikacji: soft delete + LWW.

Opcja alternatywna:

1. Trzymac lokalne tombstone'y dla membership delete.
2. Pull musi rozrozniac "brak w chmurze, bo usuniete" od "lokalny row jeszcze nie wypchniety".
3. Local-only membership nie moze automatycznie isc do `pushOutbox`.

Kryteria akceptacji:

- usuniecie czlonka jest stabilne po pull/push z dwoch klientow
- test symuluje owner usuwa usera, drugi klient robi pull i nie odtwarza membershipu

## P1 - wysokie

### 4. Zmien kolejnosc flush w sync workerze

Problem:

`src/lib/sync/worker.ts` wypycha `resource` i `event` przed `workspace` oraz `workspace_membership`. Dla nowego workspace'u moze to generowac FK/RLS bledy i retry.

Obecnie:

1. resource
2. event
3. workspace
4. workspace_membership
5. assignment
6. activity_log

Powinno byc:

1. workspace
2. workspace_membership
3. resource
4. event
5. assignment
6. activity_log

Kryteria akceptacji:

- nowy workspace z projektem i eventem synchronizuje sie bez falszywych bledow RLS/FK
- test worker/tick sprawdza kolejnosc encji

### 5. Utwardz lokalne migracje SQLite

Problem:

Migracje w `src/lib/db/connection.ts` maja guardy typu "jesli tabela istnieje, pomin calosc". Po przerwanym starcie mozna zostac w pol-migracji.

Dotkniete miejsca:

- `runPhase5Migration`
- `runPhase6Migration`
- `ensureOutboxAllowsActivityLog`
- `ensureMembershipDisplayRoleColumns`
- `ensureOutboxUserIdColumn`

Proponowane rozwiazanie:

1. Dodac `schema_migrations` z numerami migracji.
2. Kazda migracja powinna byc malym, idempotentnym krokiem.
3. Guard ma sprawdzac konkretna kolumne/indeks/tabele, nie cala faze.
4. Dodac test migracji z czesciowo istniejaca schema.

Kryteria akceptacji:

- aplikacja naprawia czesciowo wykonana migracje
- `events.user_id`, `sync_outbox.user_id`, `activity_log` i `display_role` sa gwarantowane po starcie

### 6. Dodaj brakujace indeksy lokalne

Problem:

Zapytania workspace/date beda rosly razem z liczba eventow. Obecne indeksy sa z czasow single-user.

Dodac w SQLite:

```sql
CREATE INDEX IF NOT EXISTS idx_resources_workspace_active_path
  ON resources(workspace_id, deleted_at, path);

CREATE INDEX IF NOT EXISTS idx_events_workspace_date_active
  ON events(workspace_id, date, deleted_at);

CREATE INDEX IF NOT EXISTS idx_events_workspace_user_date_active
  ON events(workspace_id, user_id, date, deleted_at);
```

Dotkniete zapytania:

- `listActiveResources`
- `listEventsInRange`
- `listEventsForHistory`
- `computeMemberRows`

Kryteria akceptacji:

- EXPLAIN QUERY PLAN uzywa indeksow dla dashboard/history/team
- dashboard/history nie degraduja sie liniowo przy duzej liczbie eventow

### 7. Utwardz Tauri security boundary

Problem:

Tauri ma `csp: null`, a capability daje frontendowi szeroki dostep do SQL pluginu.

Dotkniete miejsca:

- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`

Proponowane rozwiazanie:

1. Wlaczyc CSP zamiast `null`.
2. Usunac `opener`, jesli nie jest potrzebny.
3. Ograniczyc bezposredni `sql:allow-execute/select` albo przeniesc operacje do Rust commands.
4. Docelowo frontend nie powinien miec dowolnego SQL execute.

Kryteria akceptacji:

- CSP nie blokuje aplikacji w dev/prod
- app dziala bez niepotrzebnych permissions
- krytyczne mutacje ida przez domenowe commandy

### 8. Napraw RLS dla `profiles`

Problem:

`profiles_select_authenticated` pozwala kazdemu zalogowanemu czytac wszystkie profile.

Plik:

- `supabase/migrations/20260615000001_team_features.sql`

Proponowane rozwiazanie:

1. Zmienic polityke SELECT tak, aby widoczne byly:
   - wlasny profil
   - profile uzytkownikow we wspolnych workspace'ach
2. Dodac pomocnicza funkcje SQL typu `shares_workspace_with(user_id)`.
3. Dopisac migracje naprawcza, nie edytowac historii migracji, jesli byla juz odpalana na instancji.

Kryteria akceptacji:

- user A nie widzi profilu usera B bez wspolnego workspace'u
- czlonkowie tego samego workspace'u widza swoje display names i avatary

### 9. Przenies join codes do normalnych migracji

Problem:

Kod uzywa `workspace_join_codes` i RPC `redeem_workspace_join_code`, ale SQL jest tylko w `docs/supabase`, nie w `supabase/migrations`.

Dotkniete miejsca:

- `src/lib/workspace/joinCodeService.ts`
- `docs/supabase/workspace-join-codes.sql`
- `docs/supabase/full-setup.sql`

Proponowane rozwiazanie:

1. Dodac migracje `supabase/migrations/..._workspace_join_codes.sql`.
2. Upewnic sie, ze `full-setup.sql` i migracje sa spojne.
3. Dodac runbook "fresh Supabase from migrations".

Kryteria akceptacji:

- nowa instancja Supabase po migracjach ma join codes i RPC
- JoinWorkspaceModal dziala bez recznego kopiowania SQL z docs

### 10. Napraw cleanup assignmentow

Problem:

`softDeleteAssignmentsForResource` i `softDeleteAssignmentsForUser` istnieja, ale nie sa uzyte w kluczowych flow.

Dotkniete miejsca:

- `src/lib/assignments/assignmentService.ts`
- `src/lib/db/queries.ts`
- `src/store/workspace.ts`

Proponowane rozwiazanie:

1. Przy `softDeleteSubtree` soft-delete assignmenty dla wszystkich zasobow w subtree.
2. Przy `removeMember` soft-delete assignmenty usuwanego usera.
3. Upewnic sie, ze outbox dostaje assignment upserty z `deleted_at`.

Kryteria akceptacji:

- usuniecie zasobu nie zostawia aktywnych assignmentow do martwego resource
- usuniecie czlonka nie zostawia aktywnych assignmentow do usera spoza workspace

### 11. Dopiac AssignmentPicker do UI albo usunac martwa funkcjonalnosc

Problem:

`AssignmentPicker` i specjalny `assignAction` w `ContextMenu` istnieja, ale `ProjectsView` nigdy nie dodaje takiego menu itemu.

Dotkniete miejsca:

- `src/components/Assignments/AssignmentPicker.tsx`
- `src/components/ContextMenu.tsx`
- `src/components/ProjectsView.tsx`

Proponowane rozwiazanie:

1. Dodac pozycje "Przypisz osoby" do menu zasobu, tylko dla workspace zespolowego.
2. Przekazac `resourceId` i `workspaceId`.
3. Upewnic sie, ze assignment store odswieza sie po zmianach z realtime/pull.

Kryteria akceptacji:

- z menu zasobu mozna przypisac/odpisac czlonka
- avatary przypisanych osob w drzewie odswiezaja sie po zmianie

## P2 - srednie

### 12. Zmien pull na inkrementalny i stronicowany

Problem:

`runPull()` pobiera cale tabele przez `select("*")`. To wystarczy dla malego datasetu, ale nie skaluje sie.

Dotkniete miejsce:

- `src/lib/sync/pull.ts`

Proponowane rozwiazanie:

1. Dodac lokalny cursor `last_pulled_at` per tabela/workspace.
2. Pobierac `updated_at > cursor`.
3. Dla initial pull uzyc paginacji Supabase `.range()`.
4. Nie pobierac danych workspace'ow nieaktywnych, jesli UI ich nie potrzebuje natychmiast.

Kryteria akceptacji:

- pull dziala dla datasetu > 1000 rows na tabele
- incremental pull nie pobiera calej historii co 120 sekund

### 13. Zmniejsz bundle i napraw code-splitting

Problem:

`pnpm build` pokazuje duze chunki:

- `index` ok. 557 kB minified
- `DashboardView` ok. 384 kB minified

Vite ostrzega, ze czesc dynamicznych importow nie dziala, bo moduly sa tez importowane statycznie.

Proponowane rozwiazanie:

1. Sprawdzic importy `worker`, `pull`, `workspace`, `projects`.
2. Wydzielic Recharts do osobnego chunka przez `manualChunks`.
3. Nie importowac statycznie ciezkich modulow w entrypoincie, jesli sa potrzebne tylko w lazy views.
4. Rozwazyc lazy load sync worker po autoryzacji.

Kryteria akceptacji:

- mniejszy glowny chunk
- brak ostrzezen Vite o nieskutecznych dynamic imports

### 14. Dodaj brakujacy provider coverage

Problem:

`pnpm test:cov` konczy sie bledem, bo brakuje `@vitest/coverage-v8`.

Proponowane rozwiazanie:

```powershell
pnpm add -D @vitest/coverage-v8
```

Kryteria akceptacji:

- `pnpm test:cov` przechodzi
- coverage dla `src/lib/sync/**` jest raportowane

### 15. Uporzadkuj duze moduly

Najbardziej rozrosniete pliki:

- `src/lib/sync/pull.ts`
- `src/lib/sync/worker.ts`
- `src/lib/db/queries.ts`
- `src/store/workspace.ts`
- `src/components/ProjectsView.tsx`

Proponowane rozbicie:

- `sync/mappers.ts`
- `sync/flush.ts`
- `sync/pullWorkspaces.ts`
- `sync/pullResources.ts`
- `db/resourceQueries.ts`
- `db/eventQueries.ts`
- `db/resourceMutations.ts`
- `db/eventMutations.ts`
- `store/workspace/actions/*.ts`

Kryteria akceptacji:

- pliki maja wyrazna odpowiedzialnosc
- testy da sie pisac na male funkcje, bez mockowania calego swiata

## Kolejnosc realizacji

1. Napraw `events.user_id` mapper i testy.
2. Zmien kolejnosc flush worker.
3. Ustal docelowy model usuwania `workspace_memberships`.
4. Dodaj indeksy lokalne.
5. Utwardz migracje lokalne.
6. Dodaj migracje join codes.
7. Napraw RLS `profiles`.
8. Zrob Rust/Tauri transaction boundary dla krytycznych mutacji.
9. Dopnij assignment cleanup i UI.
10. Napraw coverage.
11. Zoptymalizuj bundle.

## Definition of Done dla calego pakietu

- `pnpm typecheck` przechodzi
- `pnpm lint` przechodzi
- `pnpm test` przechodzi
- `pnpm test:cov` przechodzi
- `pnpm build` przechodzi bez istotnych ostrzezen chunk/circular import
- `cargo check` przechodzi
- `cargo clippy -- -D warnings` przechodzi
- scenariusz manualny: user A tworzy workspace, user B dolacza kodem, obaj loguja czas, owner usuwa B, sync po obu stronach nie odtwarza B
- scenariusz manualny: user B edytuje wpis usera A i autor wpisu pozostaje userem A
