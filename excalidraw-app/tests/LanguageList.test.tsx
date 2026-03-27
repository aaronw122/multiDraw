import { defaultLang } from "@excalidraw/excalidraw/i18n";
import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  screen,
  fireEvent,
  waitFor,
  render,
  act,
} from "@excalidraw/excalidraw/tests/test-utils";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

import ExcalidrawApp from "../App";

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: "test" }),
  };
});

vi.mock("../../excalidraw-app/data/firebase.ts", () => {
  const loadFromFirebase = async () => null;
  const saveToFirebase = () => {};
  const isSavedToFirebase = () => true;
  const loadFilesFromFirebase = async () => ({
    loadedFiles: [],
    erroredFiles: [],
  });
  const saveFilesToFirebase = async () => ({
    savedFiles: new Map(),
    erroredFiles: new Map(),
  });

  return {
    loadFromFirebase,
    saveToFirebase,
    isSavedToFirebase,
    loadFilesFromFirebase,
    saveFilesToFirebase,
  };
});

vi.mock("../../excalidraw-app/data/ProjectStore", () => ({
  listProjects: async () => [],
  createProject: async (name: string) => ({
    id: "test",
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
  updateProject: async () => {},
  deleteProject: async () => {},
  renameProject: async () => {},
  getProject: async () => null,
}));

const { h } = window;

describe("Test LanguageList", () => {
  it("rerenders UI on language change", async () => {
    await render(
      <MemoryRouter initialEntries={["/project/test"]}>
        <ExcalidrawApp />
      </MemoryRouter>,
    );

    // select rectangle tool to show properties menu
    UI.clickTool("rectangle");
    // english lang should display `thin` label
    expect(screen.queryByTitle(/thin/i)).not.toBeNull();
    // Open the main menu by setting appState
    act(() => {
      h.setState({ openMenu: "canvas" });
    });

    await waitFor(() =>
      expect(
        document.querySelector(".dropdown-select__language"),
      ).not.toBeNull(),
    );

    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: "de-DE" },
    });
    // switching to german, `thin` label should no longer exist
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).toBeNull());
    // reset language
    fireEvent.change(document.querySelector(".dropdown-select__language")!, {
      target: { value: defaultLang.code },
    });
    // switching back to English
    await waitFor(() => expect(screen.queryByTitle(/thin/i)).not.toBeNull());
  });
});
