import { decompressData } from "@excalidraw/excalidraw/data/encode";
import { MIME_TYPES } from "@excalidraw/common";

import type { FileId } from "@excalidraw/element/types";
import type {
  BinaryFileData,
  BinaryFileMetadata,
  DataURL,
} from "@excalidraw/excalidraw/types";

const BACKEND_V2_BASE = import.meta.env.VITE_APP_BACKEND_V2_GET_URL;

export const saveFilesToBackend = async (
  sceneId: string,
  files: { id: FileId; buffer: Uint8Array }[],
): Promise<{ savedFiles: FileId[]; erroredFiles: FileId[] }> => {
  const savedFiles: FileId[] = [];
  const erroredFiles: FileId[] = [];

  await Promise.all(
    files.map(async ({ id, buffer }) => {
      try {
        const response = await fetch(`${BACKEND_V2_BASE}files/${sceneId}`, {
          method: "POST",
          headers: { "X-File-Id": id },
          body: new Uint8Array(buffer),
        });
        if (response.ok) {
          savedFiles.push(id);
        } else {
          erroredFiles.push(id);
        }
      } catch {
        erroredFiles.push(id);
      }
    }),
  );

  return { savedFiles, erroredFiles };
};

export const loadFilesFromBackend = async (
  sceneId: string,
  decryptionKey: string,
  filesIds: readonly FileId[],
): Promise<{
  loadedFiles: BinaryFileData[];
  erroredFiles: Map<FileId, true>;
}> => {
  const loadedFiles: BinaryFileData[] = [];
  const erroredFiles = new Map<FileId, true>();

  await Promise.all(
    [...new Set(filesIds)].map(async (id) => {
      try {
        const response = await fetch(
          `${BACKEND_V2_BASE}files/${sceneId}/${id}`,
        );
        if (response.status < 400) {
          const arrayBuffer = await response.arrayBuffer();

          const { data, metadata } = await decompressData<BinaryFileMetadata>(
            new Uint8Array(arrayBuffer),
            { decryptionKey },
          );

          const dataURL = new TextDecoder().decode(data) as DataURL;

          loadedFiles.push({
            mimeType: metadata.mimeType || MIME_TYPES.binary,
            id,
            dataURL,
            created: metadata?.created || Date.now(),
            lastRetrieved: metadata?.created || Date.now(),
          });
        } else {
          erroredFiles.set(id, true);
        }
      } catch (error: any) {
        erroredFiles.set(id, true);
        console.error(error);
      }
    }),
  );

  return { loadedFiles, erroredFiles };
};
