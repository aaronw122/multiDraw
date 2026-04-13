# Multidraw

A multi-project whiteboard app built on [Excalidraw](https://github.com/excalidraw/excalidraw). Save, organize, and switch between multiple drawings — all stored locally in your browser.

## What it does

Excalidraw gives you a single canvas. Multidraw wraps it with a project management dashboard so you can:

- **Save multiple drawings** — each with its own name, canvas state, and files
- **Dashboard view** — browse, rename, delete, and sort your projects
- **Auto-save** — drawings persist to IndexedDB automatically
- **Real-time collaboration** — share a drawing and edit together live
- **Export** — export individual drawings or bulk-export all projects
- **Local-first** — everything stays in your browser, no account required

## Tech stack

- **Frontend:** React + TypeScript, Vite
- **Canvas:** `@excalidraw/excalidraw` (npm package)
- **Storage:** IndexedDB via `idb-keyval` for projects, scenes, and binary files
- **Collaboration:** WebSocket-based real-time sync
- **Monorepo:** Yarn workspaces with packages for math, elements, common utils

## Getting started

```bash
yarn install
yarn start
```

## Development

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting
```

## Project structure

```
excalidraw-app/       # The Multidraw application
  pages/              # Dashboard + editor routes
  data/               # ProjectStore, SceneStore, storage logic
  collab/             # Real-time collaboration
packages/
  excalidraw/         # Core Excalidraw editor component
  common/             # Shared utilities
  element/            # Element types and operations
  math/               # Geometry and math utilities
```

## Based on Excalidraw

This project is a fork of [Excalidraw](https://github.com/excalidraw/excalidraw), an open-source virtual whiteboard with a hand-drawn aesthetic. The core drawing engine is unchanged — Multidraw adds the multi-project layer on top.
