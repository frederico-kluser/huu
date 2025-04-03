# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands
- `npm run build` - Production build
- `npm run dev-build` - Development build
- `npm run start` - Start development server
- `npm run dev` - Watch mode using nodemon
- `npm run prettier` - Format code

## Linting & Code Style
- ESLint with React App configuration
- Prettier: single quotes, trailing commas, parentheses for arrow functions
- TypeScript with strict mode enabled
- Console errors for debugging, alerts for user-facing errors

## Naming Conventions
- Components: PascalCase (e.g., `MainPage.tsx`)
- Utilities: camelCase (e.g., `isValidAgent.ts`)
- Types: PascalCase with `Type` prefix (e.g., `TypeAgent`)
- Blockly blocks: `Block` + PascalCase (e.g., `BlockGetStringVariable.ts`)
- Props: ComponentName + `Props` (e.g., `MainPageProps`)
- Event handlers: `handle` prefix (e.g., `handleCreateAgent`)
- Helpers: camelCase + `.helper.ts` (e.g., `extractCodeBlocks.helper.ts`)
- Enums: camelCase + `.enum.ts` (e.g., `gptModel.enum.ts`)

## Code Organization
- Imports order: external libraries, internal modules, types, styles
- Use relative paths with `../` notation, not path aliases
- React functional components only, no class components
- Component state: use React hooks for local state, chrome.storage for global

## Blockly Structure
- Blocks organized in numbered categories (0-4)
- Each block defined in separate file with consistent naming
- Use `blockConstructor` function for creating blocks
- Define JavaScript generator for each block

## Project Architecture
- src/blockly - Custom blocks, categorized by function
- src/components - Reusable UI components
- src/core - Core functionality (IA, storage, execution)
- src/pages - Chrome extension pages (Background, Content, Popup)
- src/helpers - Utility functions
- src/types - TypeScript type definitions