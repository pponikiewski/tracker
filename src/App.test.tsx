import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useAuthStore } from "@/store/auth";
import { useWorkspaceStore } from "@/store/workspace";
import type { Workspace } from "@/lib/db/types";

vi.mock("@/components/Workspace/WorkspaceEmptyState", () => ({
  WorkspaceEmptyState: () => <div data-testid="workspace-empty" />,
}));

vi.mock("@/components/Auth/LoginPage", () => ({
  LoginPage: () => <div data-testid="login-page" />,
}));

vi.mock("@/components/Sidebar/Sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));

vi.mock("./components/ProjectsView", () => ({
  ProjectsView: () => <div data-testid="projects-view" />,
}));

const staleWorkspace: Workspace = {
  id: "stale-ws",
  name: "Stale workspace",
  owner_id: "other-user",
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
};

describe("App workspace gate", () => {
  beforeEach(() => {
    useAuthStore.setState({
      state: {
        kind: "authed",
        user: { id: "current-user", email: "current@example.com" } as never,
        session: {} as never,
      },
      syncStatus: { kind: "idle" },
      pendingCount: 0,
      lastSyncAt: null,
    });
    useWorkspaceStore.setState({
      workspaces: [],
      memberships: [],
      activeWorkspaceId: null,
      loading: false,
      error: null,
    });
  });

  it("shows the empty workspace state when the current user has no accessible workspaces", async () => {
    useWorkspaceStore.setState({
      workspaces: [staleWorkspace],
      memberships: [],
      activeWorkspaceId: null,
      loading: false,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("workspace-empty")).toBeInTheDocument();
    });
  });
});
