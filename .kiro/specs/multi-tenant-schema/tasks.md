# Implementation Plan: Multi-Tenant Schema (Faza 5)

## Overview

Rozszerza aplikacje tracker o model multi-tenant oparty na Workspace'ach. Kazdy Resource i Event nalezy do dokladnie jednego Workspace. Implementacja obejmuje: nowe tabele SQLite i Postgres, migracje kolumny path na typ ltree w Postgres, rozszerzenie RLS na workspace_id, outbox pattern dla encji workspace, WorkspaceStore (Zustand), komponenty UI (WorkspaceSwitcher, WorkspaceSettingsPanel, WorkspaceCreateModal, InviteAcceptView) oraz integracje z istniejacym kodem sync.

## Tasks

- [ ] 1. Narzedzia ltree i rozszerzenia typow
  - [ ] 1.1 Utworz src/lib/utils/ltree.ts z funkcjami pathToLtree i ltreeToPath
    - Zaimplementuj pathToLtree(path: string): string - zamien kazdy - na _ i kazdy / na .
    - Zaimplementuj ltreeToPath(ltree: string): string - zamien kazdy _ na - i kazdy . na /
    - Obie funkcje musza byc czyste (brak efektow ubocznych)
    - pathToLtree rzuca Error dla pustego stringa lub znakow innych niz cyfry szesnastkowe, myslniki i ukosniki
    - ltreeToPath rzuca Error dla pustego stringa lub znakow innych niz cyfry szesnastkowe, podkreslenia i kropki
    - _Requirements: 5.3, 5.4, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [ ] 1.2 Rozszerz src/lib/db/types.ts o nowe interfejsy i typy
    - Dodaj interfejsy Workspace, WorkspaceMembership, Invite
    - Rozszerz OutboxEntity z 'resource' | 'event' na 'resource' | 'event' | 'workspace' | 'workspace_membership'
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 7.3_

  - [ ] 1.3 Rozszerz src/lib/sync/types.ts - zaktualizuj typ Entity
    - Zmien Entity z 'resource' | 'event' na 'resource' | 'event' | 'workspace' | 'workspace_membership'
    - _Requirements: 7.3, 10.5_

- [ ] 2. Migracja SQLite - schemat i dane
  - [ ] 2.1 Zaktualizuj src/lib/db/schema.ts - dodaj nowe tabele i zmodyfikuj istniejace
    - Dodaj DDL dla tabeli workspaces z CHECK constraint na length(name) BETWEEN 1 AND 255
    - Dodaj DDL dla tabeli workspace_memberships z PRIMARY KEY (workspace_id, user_id) i FK do workspaces
    - Dodaj indeksy: idx_workspaces_owner, idx_workspaces_active, idx_wm_user
    - Zaktualizuj CHECK constraint w sync_outbox - rozszerz entity o 'workspace' i 'workspace_membership'
    - Odtworzenie sync_outbox przez CREATE TABLE sync_outbox_new ... INSERT SELECT ... DROP ... RENAME (SQLite nie obsluguje ALTER COLUMN)
    - _Requirements: 1.5, 1.6, 7.3, 10.2, 10.5_

  - [ ] 2.2 Zaktualizuj src/lib/db/connection.ts - dodaj logike migracji Fazy 5
    - Dodaj funkcje runPhase5Migration(db) wykonujaca migracje w jednej transakcji SQLite
    - Krok 1: CREATE TABLE IF NOT EXISTS workspaces i workspace_memberships
    - Krok 2: wywolaj getOrCreateLocalWorkspace() i wstaw wiersz workspace + membership (INSERT OR IGNORE)
    - Krok 3: ALTER TABLE resources ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE + UPDATE backfill
    - Krok 4: ALTER TABLE events ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE + UPDATE backfill
    - Krok 5: odtworzenie sync_outbox z rozszerzonym CHECK (CREATE new, INSERT SELECT, DROP, RENAME)
    - Wywolaj runPhase5Migration w getDb() po SCHEMA_SQL (idempotentnie - sprawdz czy kolumna juz istnieje)
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 10.2, 10.3, 10.4, 10.5_

- [ ] 3. Migracja Postgres
  - [ ] 3.1 Utworz supabase/migrations/20260601000001_multi_tenant_schema.sql
    - CREATE EXTENSION IF NOT EXISTS ltree
    - Utworz tabele workspaces i workspace_memberships z FK do auth.users
    - Backfill: INSERT INTO workspaces dla kazdego auth.users bez workspace; INSERT INTO workspace_memberships dla owner
    - ALTER TABLE resources ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE + UPDATE backfill
    - ALTER TABLE events ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE + UPDATE backfill
    - Migracja ltree: ALTER TABLE resources ALTER COLUMN path TYPE ltree USING path::ltree (z guard IF data_type = 'text')
    - CREATE INDEX IF NOT EXISTS resources_path_gist_idx ON resources USING GIST (path)
    - Utworz tabele invites z kolumnami: id UUID, workspace_id, invited_email, invited_by, token UUID UNIQUE, created_at, expires_at, accepted_at
    - Cala migracja w jednym BEGIN ... COMMIT
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.9, 5.1, 5.2, 5.5, 5.6, 8.1, 10.1, 10.6_

  - [ ] 3.2 Dodaj funkcje is_workspace_member i polityki RLS do migracji
    - CREATE OR REPLACE FUNCTION is_workspace_member(p_workspace_id UUID) RETURNS BOOLEAN
    - ENABLE ROW LEVEL SECURITY na workspaces, workspace_memberships, invites
    - Policy workspace_member_access na workspaces (FOR ALL USING is_workspace_member(id))
    - Policy wm_select na workspace_memberships (FOR SELECT USING is_workspace_member(workspace_id))
    - Policy wm_owner_write na workspace_memberships (FOR ALL - tylko owner)
    - Zastap own_resources nowa policy workspace_resources (DROP + CREATE)
    - Zastap own_events nowa policy workspace_events (DROP + CREATE)
    - Policy invites_owner i invites_accept na invites
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 8.13_

- [ ] 4. Checkpoint
  - Uruchom pnpm typecheck && pnpm lint, zapytaj uzytkownika jesli pojawia sie pytania.

- [ ] 5. Zapytania workspace - warstwa danych
  - [ ] 5.1 Utworz src/lib/db/workspaceQueries.ts z funkcjami CRUD workspace
    - listWorkspaces(): Promise<Workspace[]> - wszystkie wiersze z tabeli workspaces
    - getWorkspace(id: string): Promise<Workspace | null>
    - listMemberships(workspaceId: string): Promise<WorkspaceMembership[]>
    - getUserMemberships(userId: string): Promise<WorkspaceMembership[]>
    - createWorkspace(input: { id: string; name: string; ownerId: string }): Promise<void> - INSERT do workspaces + INSERT do workspace_memberships (role='owner') + enqueue('workspace', 'upsert') + enqueue('workspace_membership', 'upsert') w jednej transakcji
    - renameWorkspace(id: string, name: string): Promise<void> - UPDATE workspaces SET name, updated_at + enqueue('workspace', 'upsert') w jednej transakcji
    - softDeleteWorkspace(id: string): Promise<void> - UPDATE workspaces SET deleted_at + enqueue('workspace', 'upsert') w jednej transakcji
    - insertMembership(m: WorkspaceMembership): Promise<void> - INSERT + enqueue('workspace_membership', 'upsert') w jednej transakcji
    - deleteMembership(workspaceId: string, userId: string): Promise<void> - DELETE + enqueue('workspace_membership', 'delete') w jednej transakcji
    - getOrCreateLocalWorkspace(): Promise<string> - zwraca stabilne UUID z tabeli kv_store; jesli nie istnieje, generuje UUID v4 i zapisuje; nigdy nie enqueue (Local_Personal_Workspace nie jest synchronizowany)
    - _Requirements: 1.5, 1.6, 1.9, 2.5, 3.1, 3.3, 3.4, 7.1, 7.2_

  - [ ]* 5.2 Napisz testy jednostkowe dla workspaceQueries.ts (src/lib/db/__tests__/workspaceQueries.test.ts)
    - Przetestuj createWorkspace - weryfikuj zapis do workspaces, workspace_memberships i sync_outbox
    - Przetestuj renameWorkspace - weryfikuj aktualizacje name i updated_at oraz wpis w outbox
    - Przetestuj softDeleteWorkspace - weryfikuj ustawienie deleted_at i wpis w outbox
    - Przetestuj deleteMembership - weryfikuj DELETE z workspace_memberships i wpis outbox z op='delete'
    - Przetestuj getOrCreateLocalWorkspace - idempotentnosc (wielokrotne wywolania zwracaja ten sam UUID)
    - _Requirements: 3.1, 3.3, 3.4, 7.1, 7.2_

- [ ] 6. Rozszerzenia sync - worker i pull
  - [ ] 6.1 Zaktualizuj src/lib/sync/worker.ts - obsluga encji workspace
    - Rozszerz CollapseResult.perEntity i supersededIds o klucze 'workspace' i 'workspace_membership'
    - Dodaj mapWorkspaceToCloud(data: Record<string, unknown>): Record<string, unknown> - konwertuje created_at, updated_at, deleted_at z Unix ms na ISO 8601; brak pola user_id (workspace ma owner_id)
    - Dodaj flushEntity dla 'workspace' (tabela 'workspaces') i 'workspace_membership' (tabela 'workspace_memberships')
    - Dla workspace_membership z op='delete': wywolaj supabase.from('workspace_memberships').delete() zamiast upsert
    - Zaktualizuj tick() - flush wszystkich czterech encji niezaleznie
    - Zaktualizuj collapseDuplicates - obsluz nowe typy encji
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

  - [ ] 6.2 Zaktualizuj src/lib/sync/pull.ts - pobieranie workspace'ow przed resources/events
    - Dodaj ensurePersonalWorkspace(userId: string): Promise<string> - sprawdz czy Personal_Workspace istnieje w Supabase; jesli nie - utworz go (name='My workspace', owner_id=userId) i wstaw membership; zwroc workspace_id
    - Dodaj cloudToLocalWorkspace i cloudToLocalMembership - konwersja ISO na Unix ms
    - Zmien kolejnosc w runInitialPull: (1) ensurePersonalWorkspace, (2) pobierz workspaces + memberships, (3) LWW merge workspace'ow -> zapis do SQLite, (4) pobierz resources + events, (5) LWW merge resources/events
    - Jesli fetch workspace'ow lub memberships sie nie powiedzie - ustaw status error i przerwij (nie pobieraj resources/events)
    - Konwertuj path z ltree na materialized path przez ltreeToPath przy pobieraniu resources
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 7.5_

- [ ] 7. Checkpoint
  - Uruchom pnpm typecheck && pnpm lint, zapytaj uzytkownika jesli pojawia sie pytania.

- [ ] 8. Integracja workspace_id z istniejacymi queries i store
  - [ ] 8.1 Zaktualizuj src/lib/db/queries.ts - dodaj workspace_id do mutacji resources i events
    - Dodaj parametr workspaceId: string do createResource i createEvent
    - Wstaw workspace_id w INSERT dla resources i events
    - Zaktualizuj listActiveResources - dodaj filtr WHERE workspace_id = $1 (parametr aktywnego workspace)
    - _Requirements: 1.7, 1.8, 4.5_

  - [ ] 8.2 Zaktualizuj src/store/projects.ts - przekaz activeWorkspaceId do zapytan
    - Pobierz activeWorkspaceId z WorkspaceStore w metodzie refresh()
    - Przekaz workspaceId do listActiveResources i createResource
    - _Requirements: 4.5_

- [ ] 9. WorkspaceStore
  - [ ] 9.1 Utworz src/store/workspace.ts - Zustand store zarzadzajacy workspace'ami
    - Zdefiniuj WorkspaceState z polami: workspaces, memberships, activeWorkspaceId, loading, error
    - Zaimplementuj selektory: activeWorkspace(), userWorkspaces() (non-deleted, sorted by created_at asc)
    - Zaimplementuj init(userId: string | null) - zaladuj workspace'y z SQLite, wywolaj restoreActiveWorkspace
    - Zaimplementuj createWorkspace(name: string): Promise<string> - walidacja 1-80 znakow, generuj UUID v4, wywolaj workspaceQueries.createWorkspace
    - Zaimplementuj renameWorkspace(id, name), deleteWorkspace(id) (soft-delete + przelacz active jesli potrzeba), setActiveWorkspace(id)
    - Zaimplementuj restoreActiveWorkspace(userId) - odczytaj z localStorage klucz tracker:activeWorkspaceId:{userId} (lub anonymous); fallback na pierwszy workspace; jesli brak - wywolaj provisioning
    - Zaimplementuj removeMember(workspaceId, userId) - najpierw Supabase DELETE, potem SQLite DELETE (nie przez outbox)
    - Zaimplementuj createInvite, cancelInvite, listInvites, acceptInvite - tylko Supabase (brak lokalnego SQLite dla invites)
    - Zaimplementuj refresh() - przeladuj workspace'y z SQLite
    - _Requirements: 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.2, 4.3, 4.4, 8.1, 8.2, 8.3, 9.1, 9.3_

  - [ ] 9.2 Zainicjalizuj WorkspaceStore w src/main.tsx
    - Wywolaj useWorkspaceStore.getState().init(userId) po zalogowaniu (w subskrypcji auth store)
    - Wywolaj init(null) dla trybu anonimowego
    - _Requirements: 2.5, 4.3, 4.4_

- [ ] 10. Checkpoint
  - Uruchom pnpm typecheck && pnpm lint, zapytaj uzytkownika jesli pojawia sie pytania.

- [ ] 11. Komponenty UI - Workspace
  - [ ] 11.1 Utworz src/components/Workspace/WorkspaceCreateModal.tsx
    - Modal z polem tekstowym na nazwe workspace (walidacja 1-80 znakow, inline error)
    - Przycisk Utworz (disabled podczas ladowania), przycisk Anuluj
    - Po sukcesie zamknij modal i przelacz na nowy workspace
    - _Requirements: 3.1, 3.2, 11.5_

  - [ ] 11.2 Utworz src/components/Workspace/WorkspaceSwitcher.tsx
    - Brak props - czyta z WorkspaceStore i AuthStore
    - Anonymous: wyswietl nazwe Local_Personal_Workspace (max 50 znakow), bez dropdown
    - Authed, 1 workspace: wyswietl nazwe (max 50 znakow), bez dropdown
    - Authed, >1 workspace: dropdown z lista + "New workspace" na dole
    - Klikniecie "New workspace" otwiera WorkspaceCreateModal
    - Ikona ustawien otwiera WorkspaceSettingsPanel
    - _Requirements: 4.1, 4.2, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_

  - [ ] 11.3 Utworz src/components/Workspace/WorkspaceSettingsPanel.tsx
    - Props: workspaceId: string, onClose: () => void
    - Sekcja nazwy: edytowalna dla owner (walidacja 1-80 znakow), read-only dla member
    - Sekcja czlonkow: lista z rolami; owner widzi przycisk Usun przy kazdym czlonku (poza soba)
    - Sekcja pending invites: lista z emailem i data wygasniecia; owner widzi przycisk Anuluj
    - Formularz invite (tylko owner): pole email z walidacja, przycisk Zaprosz, wyswietl link po sukcesie
    - Przycisk Usun workspace (tylko owner) z potwierdzeniem
    - Member widzi tylko read-only widok nazwy i liste czlonkow bez akcji; elementy owner-only sa calkowicie ukryte
    - _Requirements: 3.3, 3.7, 3.8, 8.2, 8.3, 8.4, 8.11, 8.12, 9.1, 9.3, 9.4, 11.6, 11.8, 11.9_

  - [ ] 11.4 Utworz src/components/Workspace/InviteAcceptView.tsx
    - Odczytaj token z URL (parametr ?token=... lub sciezka /invite/:token)
    - Pobierz invite z Supabase po tokenie; wyswietl nazwe workspace i email zapraszajacego
    - Jesli uzytkownik niezalogowany - przekieruj do AuthModal, po zalogowaniu wroc do flow
    - Obsluz bledy: token nie znaleziony, wygasly, juz uzyty
    - Po akceptacji: wstaw membership, ustaw accepted_at, dodaj workspace do lokalnego SQLite i WorkspaceStore
    - _Requirements: 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_

- [ ] 12. Integracja w App.tsx
  - [ ] 12.1 Dodaj WorkspaceSwitcher do headera w src/App.tsx
    - Umiesz WorkspaceSwitcher w nav obok SyncStatusBadge i AuthGate
    - _Requirements: 11.1_

- [ ] 13. Checkpoint
  - Uruchom pnpm typecheck && pnpm lint, zapytaj uzytkownika jesli pojawia sie pytania.

- [ ] 14. Testy
  - [ ]* 14.1 Napisz property test dla round-trip konwersji ltree (src/lib/utils/__tests__/ltree.test.ts)
    - Property 1: Round-trip konwersji ltree
    - Generuj losowe materialized paths (1-10 segmentow UUID v4 oddzielonych /) za pomoca fast-check
    - Weryfikuj: ltreeToPath(pathToLtree(path)) === path dla kazdego wygenerowanego path
    - Minimum 100 iteracji
    - Validates: Requirements 5.7, 12.3

  - [ ]* 14.2 Napisz property test dla poprawnosci pathToLtree (src/lib/utils/__tests__/ltree.test.ts)
    - Property 2: Poprawnosc konwersji pathToLtree
    - Weryfikuj: wynik nie zawiera - ani /; kazdy - zastapiony _, kazdy / zastapiony .
    - Validates: Requirements 5.3, 12.1

  - [ ]* 14.3 Napisz property test dla odrzucania niepoprawnych danych (src/lib/utils/__tests__/ltree.test.ts)
    - Property 3: Odrzucanie niepoprawnych danych przez pathToLtree i ltreeToPath
    - Generuj puste stringi i stringi z niedozwolonymi znakami
    - Weryfikuj: obie funkcje rzucaja Error z opisem
    - Validates: Requirements 12.4, 12.5

  - [ ]* 14.4 Napisz property test dla walidacji nazwy workspace (src/store/__tests__/workspace.test.ts)
    - Property 4: Walidacja nazwy workspace
    - Generuj stringi o roznych dlugosciach (po trim)
    - Weryfikuj: akceptowane 1-80 znakow; odrzucane puste, tylko whitespace, >80 znakow
    - Validates: Requirements 3.1, 3.2

  - [ ]* 14.5 Napisz property test dla idempotentnosci getOrCreateLocalWorkspace (src/lib/db/__tests__/workspaceQueries.test.ts)
    - Property 7: Idempotentnosc Local_Personal_Workspace
    - Wywolaj getOrCreateLocalWorkspace() wielokrotnie (N >= 2)
    - Weryfikuj: wszystkie wywolania zwracaja ten sam UUID
    - Validates: Requirements 2.5

  - [ ]* 14.6 Napisz property test dla LWW merge workspace'ow (src/lib/sync/__tests__/merge.test.ts)
    - Property 9: LWW Merge dla workspace'ow
    - Generuj losowe zestawy lokalnych i chmurowych wierszy workspace z id i updated_at
    - Weryfikuj: cloud-only -> writeSqlite; local-only -> pushOutbox; konflikt -> wyzszy updated_at wygrywa; rowne -> brak akcji
    - Validates: Requirements 7.6

  - [ ]* 14.7 Napisz property test dla konwersji znacznikow czasu workspace (src/lib/sync/__tests__/worker.test.ts)
    - Property 10: Konwersja znacznikow czasu workspace
    - Generuj poprawne Unix timestamps (dodatnie liczby calkowite w ms)
    - Weryfikuj: mapWorkspaceToCloud produkuje poprawne ISO 8601 dla created_at, updated_at; deleted_at konwertowane gdy non-null, null gdy null
    - Validates: Requirements 7.4

  - [ ]* 14.8 Napisz property test dla collapse duplikatow workspace w outbox (src/lib/sync/__tests__/worker.test.ts)
    - Property 13: Collapse duplikatow w outbox dla workspace
    - Generuj listy wierszy outbox z duplikatami (entity, entity_id) dla 'workspace' i 'workspace_membership'
    - Weryfikuj: collapseDuplicates zachowuje dokladnie jeden wiersz na unikalna pare - ten z najwyzszym id
    - Validates: Requirements 7.1, 7.2

- [ ] 15. Finalne testy i dokumentacja
  - [ ] 15.1 Zaktualizuj CLAUDE.md - dodaj notatki o Fazie 5
    - Opisz model multi-tenant (Workspace, WorkspaceMembership, Invite)
    - Opisz konwersje ltree (pathToLtree / ltreeToPath)
    - Opisz kolejnosc migracji SQLite (Faza 5)
    - Opisz nowe encje w outbox (workspace, workspace_membership)
    - Oznacz Faze 5 jako ukonczona
    - _Requirements: (dokumentacja)_

- [ ] 16. Finalny checkpoint
  - Uruchom pnpm typecheck && pnpm lint && pnpm test, zapytaj uzytkownika jesli pojawia sie pytania.

## Notes

- Zadania oznaczone * sa opcjonalne i moga byc pominiete dla szybszego MVP
- Kazde zadanie odwoluje sie do konkretnych wymagan dla pelnej identyfikowalnosci
- Checkpointy zapewniaja przyrostowa walidacje (typecheck + lint po kazdej fazie; testy od zadania 14)
- SQLite nie obsluguje ALTER TABLE ... ALTER COLUMN - migracja sync_outbox wymaga odtworzenia tabeli (CREATE new, INSERT SELECT, DROP, RENAME)
- workspace_id w SQLite dodawane przez ADD COLUMN (bez NOT NULL) + backfill; NOT NULL wymuszane przez walidacje TypeScript
- Local_Personal_Workspace: stabilne UUID generowane raz, przechowywane w SQLite (tabela kv_store lub dedykowany wiersz), nigdy nie synchronizowane z Supabase
- Usuwanie czlonka: najpierw Supabase DELETE, potem SQLite DELETE - nie przez outbox (operacja bezposrednia)
- mapWorkspaceToCloud: brak pola user_id (workspace ma owner_id, nie user_id)
- Initial Pull: workspace'y pobierane PRZED resources/events (FK constraint)
- Invite flow: tylko Supabase, brak lokalnego SQLite dla invites (invites sa efemeryczne)
- Kazda mutacja workspace w jednej transakcji SQLite: tabela + sync_outbox
- Testy PBT z fast-check, minimum 100 iteracji per wlasciwosc

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "3.2"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1", "6.2"] },
    { "id": 5, "tasks": ["8.1"] },
    { "id": 6, "tasks": ["8.2", "9.1"] },
    { "id": 7, "tasks": ["9.2"] },
    { "id": 8, "tasks": ["11.1"] },
    { "id": 9, "tasks": ["11.2", "11.3", "11.4"] },
    { "id": 10, "tasks": ["12.1"] },
    { "id": 11, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7", "14.8"] },
    { "id": 12, "tasks": ["15.1"] }
  ]
}
```
