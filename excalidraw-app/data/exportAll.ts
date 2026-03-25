import JSZip from "jszip";

import { listProjects } from "./ProjectStore";
import { loadScene } from "./SceneStore";

const sanitizeFilename = (name: string): string => {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled";
};

export const exportAllProjects = async (): Promise<void> => {
  const projects = await listProjects();

  if (projects.length === 0) {
    throw new Error("No projects to export");
  }

  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const project of projects) {
    const scene = await loadScene(project.id);

    let baseName = sanitizeFilename(project.name);
    let fileName = baseName;
    let counter = 1;
    while (usedNames.has(fileName)) {
      fileName = `${baseName} (${counter})`;
      counter++;
    }
    usedNames.add(fileName);

    const excalidrawData = {
      type: "excalidraw",
      version: 2,
      source: "excalibur",
      elements: scene?.elements ?? [],
      appState: scene?.appState ?? {},
    };

    zip.file(
      `${fileName}.excalidraw`,
      JSON.stringify(excalidrawData, null, 2),
    );
  }

  const blob = await zip.generateAsync({ type: "blob" });

  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `Excalibur-Export-${datePart}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(anchor.href);
};
