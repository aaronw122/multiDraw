import { UI } from "@excalidraw/excalidraw/tests/helpers/ui";
import {
  mockBoundingClientRect,
  render,
  restoreOriginalGetBoundingClientRect,
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

describe("Test MobileMenu", () => {
  const { h } = window;
  const dimensions = { height: 400, width: 800 };

  beforeAll(() => {
    mockBoundingClientRect(dimensions);
  });

  beforeEach(async () => {
    await render(
      <MemoryRouter initialEntries={["/project/test"]}>
        <ExcalidrawApp />
      </MemoryRouter>,
    );
    h.app.refreshEditorInterface();
  });

  afterAll(() => {
    restoreOriginalGetBoundingClientRect();
  });

  it("should set editor interface correctly", () => {
    expect(h.app.editorInterface.formFactor).toBe("phone");
  });

  it("should initialize with welcome screen and hide once user interacts", async () => {
    expect(document.querySelector(".welcome-screen-center")).toMatchSnapshot();
    UI.clickTool("rectangle");
    expect(document.querySelector(".welcome-screen-center")).toBeNull();
  });
});
