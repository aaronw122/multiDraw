import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listProjects,
  createProject,
  deleteProject,
  renameProject,
} from "../data/ProjectStore";
import type { ProjectMetadata } from "../data/ProjectStore";
import { STORAGE_KEYS } from "../app_constants";
import "./Dashboard.css";

const LAST_PROJECT_KEY = "excalibur-last-project-id";

type SortMode = "recent" | "name" | "created";

const formatRelativeDate = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: days > 365 ? "numeric" : undefined,
  });
};

const useTheme = (): "light" | "dark" => {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME);
    if (stored === "dark") {
      return "dark";
    }
    if (stored === "light") {
      return "light";
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_THEME);
      if (!stored) {
        setTheme(mq.matches ? "dark" : "light");
      }
    };
    mq.addEventListener("change", handler);

    // Also listen for storage changes (theme toggled in another tab)
    const storageHandler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.LOCAL_STORAGE_THEME) {
        if (e.newValue === "dark" || e.newValue === "light") {
          setTheme(e.newValue);
        }
      }
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      mq.removeEventListener("change", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  return theme;
};

const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
};

export const Dashboard = () => {
  const navigate = useNavigate();
  const theme = useTheme();

  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingProject, setDeletingProject] =
    useState<ProjectMetadata | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebounce(searchQuery, 200);

  // Load projects on mount
  useEffect(() => {
    const load = async () => {
      try {
        const list = await listProjects();
        setProjects(list);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Resume banner — find last opened project
  const lastProjectId = localStorage.getItem(LAST_PROJECT_KEY);
  const lastProject = useMemo(
    () => projects.find((p) => p.id === lastProjectId),
    [projects, lastProjectId],
  );

  // Filter and sort
  const filteredProjects = useMemo(() => {
    let filtered = projects;
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase().trim();
      filtered = projects.filter((p) => p.name.toLowerCase().includes(q));
    }

    const sorted = [...filtered];
    switch (sortMode) {
      case "recent":
        sorted.sort((a, b) => b.updatedAt - a.updatedAt);
        break;
      case "name":
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "created":
        sorted.sort((a, b) => b.createdAt - a.createdAt);
        break;
    }
    return sorted;
  }, [projects, debouncedSearch, sortMode]);

  const handleCreateProject = useCallback(async () => {
    const project = await createProject("Untitled Drawing");
    localStorage.setItem(LAST_PROJECT_KEY, project.id);
    navigate(`/project/${project.id}`);
  }, [navigate]);

  const handleOpenProject = useCallback(
    (projectId: string) => {
      localStorage.setItem(LAST_PROJECT_KEY, projectId);
      navigate(`/project/${projectId}`);
    },
    [navigate],
  );

  const handleStartRename = useCallback(
    (e: React.MouseEvent, project: ProjectMetadata) => {
      e.stopPropagation();
      setEditingId(project.id);
      setEditingName(project.name);
    },
    [],
  );

  const handleFinishRename = useCallback(async () => {
    if (!editingId) {
      return;
    }
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== projects.find((p) => p.id === editingId)?.name) {
      await renameProject(editingId, trimmed);
      setProjects((prev) =>
        prev.map((p) =>
          p.id === editingId
            ? { ...p, name: trimmed, updatedAt: Date.now() }
            : p,
        ),
      );
    }
    setEditingId(null);
    setEditingName("");
  }, [editingId, editingName, projects]);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName("");
  }, []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleFinishRename();
      } else if (e.key === "Escape") {
        handleCancelRename();
      }
    },
    [handleFinishRename, handleCancelRename],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingProject) {
      return;
    }
    await deleteProject(deletingProject.id);
    setProjects((prev) => prev.filter((p) => p.id !== deletingProject.id));
    if (lastProjectId === deletingProject.id) {
      localStorage.removeItem(LAST_PROJECT_KEY);
    }
    setDeletingProject(null);
  }, [deletingProject, lastProjectId]);

  const handleRequestDelete = useCallback(
    (e: React.MouseEvent, project: ProjectMetadata) => {
      e.stopPropagation();
      setDeletingProject(project);
    },
    [],
  );

  if (loading) {
    return (
      <div className={`exc-dashboard exc-dashboard--${theme}`}>
        <div className="exc-dashboard__header">
          <div className="exc-dashboard__title-row">
            <h1 className="exc-dashboard__title">Excalibur</h1>
          </div>
        </div>
      </div>
    );
  }

  // Empty state — no projects at all
  if (projects.length === 0) {
    return (
      <div className={`exc-dashboard exc-dashboard--${theme}`}>
        <div className="exc-dashboard__header">
          <div className="exc-dashboard__title-row">
            <h1 className="exc-dashboard__title">Excalibur</h1>
          </div>
        </div>
        <div className="exc-dashboard__empty">
          <div className="exc-dashboard__empty-icon">
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
          </div>
          <h2 className="exc-dashboard__empty-title">
            No drawings yet
          </h2>
          <p className="exc-dashboard__empty-subtitle">
            Create your first drawing to get started
          </p>
          <button
            type="button"
            className="exc-dashboard__empty-btn"
            onClick={handleCreateProject}
          >
            Create your first drawing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`exc-dashboard exc-dashboard--${theme}`}>
      {/* Header */}
      <div className="exc-dashboard__header">
        <div className="exc-dashboard__title-row">
          <h1 className="exc-dashboard__title">Excalibur</h1>
          <div className="exc-dashboard__controls">
            <input
              type="text"
              className="exc-dashboard__search"
              placeholder="Search drawings..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="exc-dashboard__sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              <option value="recent">Recent</option>
              <option value="name">Name</option>
              <option value="created">Created</option>
            </select>
            <button
              type="button"
              className="exc-dashboard__btn-primary"
              onClick={handleCreateProject}
            >
              + New Drawing
            </button>
          </div>
        </div>
      </div>

      {/* Resume banner */}
      {lastProject && (
        <div className="exc-dashboard__resume">
          <span className="exc-dashboard__resume-text">
            Continue where you left off:{" "}
            <strong>{lastProject.name}</strong>
          </span>
          <button
            type="button"
            className="exc-dashboard__resume-btn"
            onClick={() => handleOpenProject(lastProject.id)}
          >
            Resume
          </button>
        </div>
      )}

      {/* Project grid */}
      {filteredProjects.length > 0 ? (
        <div className="exc-dashboard__grid">
          {filteredProjects.map((project) => (
            <div
              key={project.id}
              className="exc-dashboard__card"
              onClick={() => {
                if (editingId !== project.id) {
                  handleOpenProject(project.id);
                }
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" && editingId !== project.id) {
                  handleOpenProject(project.id);
                }
              }}
            >
              <div className="exc-dashboard__card-thumbnail">
                {project.thumbnail ? (
                  <img src={project.thumbnail} alt={project.name} />
                ) : (
                  <span className="exc-dashboard__card-thumbnail-placeholder">
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 19l7-7 3 3-7 7-3-3z" />
                      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                      <path d="M2 2l7.586 7.586" />
                      <circle cx="11" cy="11" r="2" />
                    </svg>
                  </span>
                )}
              </div>
              <div className="exc-dashboard__card-body">
                {editingId === project.id ? (
                  <input
                    ref={editInputRef}
                    type="text"
                    className="exc-dashboard__card-name-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishRename}
                    onKeyDown={handleRenameKeyDown}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <h3
                    className="exc-dashboard__card-name"
                    onDoubleClick={(e) => handleStartRename(e, project)}
                    title="Double-click to rename"
                  >
                    {project.name}
                  </h3>
                )}
                <div className="exc-dashboard__card-meta">
                  <span className="exc-dashboard__card-date">
                    {formatRelativeDate(project.updatedAt)}
                  </span>
                  <div className="exc-dashboard__card-actions">
                    <button
                      type="button"
                      className="exc-dashboard__card-action-btn"
                      onClick={(e) => handleStartRename(e, project)}
                      title="Rename"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="exc-dashboard__card-action-btn exc-dashboard__card-action-btn--danger"
                      onClick={(e) => handleRequestDelete(e, project)}
                      title="Delete"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="exc-dashboard__no-results">
          No drawings match "{debouncedSearch}"
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deletingProject && (
        <div
          className="exc-dashboard__overlay"
          onClick={() => setDeletingProject(null)}
        >
          <div
            className="exc-dashboard__dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="exc-dashboard__dialog-title">Delete drawing?</h2>
            <p className="exc-dashboard__dialog-message">
              "{deletingProject.name}" will be permanently
              deleted. This action cannot be undone.
            </p>
            <div className="exc-dashboard__dialog-actions">
              <button
                type="button"
                className="exc-dashboard__dialog-btn exc-dashboard__dialog-btn--cancel"
                onClick={() => setDeletingProject(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="exc-dashboard__dialog-btn exc-dashboard__dialog-btn--delete"
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
