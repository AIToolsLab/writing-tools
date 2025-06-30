# GitHub Copilot Instructions for Writing Tools

This repository contains a multi-component writing tools application with specific package managers and coding conventions.

## Project Structure

- **Frontend** (`/frontend`): TypeScript/React Microsoft Office Add-in
- **Backend** (`/backend`): Python FastAPI application  
- **LogViewer** (`/logViewer`): Observable Framework for log visualization

## Package Managers

**IMPORTANT**: Always use the correct package manager for each component:

### Frontend (`/frontend`)
- **Use `yarn`** - NOT npm
- Commands:
  - Install dependencies: `yarn` or `yarn install`
  - Run dev server: `yarn run dev-server`
  - Build: `yarn build`
  - Lint: `yarn lint` or `yarn lint --fix`
  - Test: `yarn test`

### Backend (`/backend`)
- **Use `uv`** - NOT pip or npm
- Commands:
  - Install dependencies: `uv sync`
  - Run commands: `uv run <command>`
  - Run server: `uv run python server.py` or `uv run uvicorn server:app --host localhost --port 8000 --reload`
  - Run tests: `uv run pytest`

### LogViewer (`/logViewer`)
- **Use `yarn`** - NOT npm
- Commands:
  - Install dependencies: `yarn install`
  - Run dev server: `yarn dev`
  - Build: `yarn build`
  - Deploy: `yarn deploy`

## Coding Conventions

### Frontend (TypeScript/React)
- Use function declarations for named components, arrow functions for unnamed components
- Use camelCase for variables and function names
- Prefer `const` over `let` and `var`
- Use `@/` prefix for internal imports (webpack alias)
- Follow ESLint rules defined in `.eslintrc.json`
- Use TypeScript strict mode
- React components should not import React explicitly (configured in ESLint)

### Backend (Python)
- Use `uv` for dependency management
- Follow PEP 8 style guidelines
- Use type hints for function parameters and return types
- Use `ruff` for linting (configured in `ruff.toml`)
- Use `mypy` for type checking
- Use `pytest` for testing
- Use snake_case for variables and function names
- Use CamelCase for class names

### General
- Use absolute paths when referencing files in the repository
- Lint and format code before committing
- Use descriptive commit messages
- Add appropriate error handling
- Include proper logging where applicable

## Development Commands

### Setup
```bash
# Root level - setup Python environment
uv sync

# Frontend setup
cd frontend
yarn install

# LogViewer setup  
cd logViewer
yarn install
```

### Running Services
```bash
# Frontend development server
cd frontend
yarn run dev-server

# Backend server (simple)
cd backend
uv run python server.py

# Backend server (with auto-reload)
cd backend
uv run uvicorn server:app --host localhost --port 8000 --reload

# LogViewer development
cd logViewer
yarn dev
```

### Testing and Linting
```bash
# Frontend linting
cd frontend
yarn lint --fix

# Backend testing
cd backend
uv run pytest

# Backend linting
cd backend
uv run ruff check
```

## Architecture Notes

- The frontend is a Microsoft Office Add-in that communicates with the backend API
- The backend provides API endpoints for text processing and AI-powered writing assistance
- The LogViewer provides analytics and monitoring of the application usage
- Authentication is handled through Auth0 in the frontend
- The backend uses Azure services for deployment and secrets management

## File Naming and Organization

- Use kebab-case for file names where possible
- Group related files in appropriate directories
- Use descriptive file names that indicate purpose
- Keep components modular and reusable
- Separate concerns between UI, logic, and API layers

## Common Patterns

### Frontend
- Use Jotai for state management
- Use custom hooks for reusable logic
- Implement proper error boundaries
- Use TypeScript interfaces for type safety
- Follow React best practices for component composition

### Backend
- Use FastAPI for API endpoints
- Implement proper error handling and validation
- Use dependency injection for testability
- Follow RESTful API conventions
- Use environment variables for configuration

Remember: Always use the correct package manager (`yarn` for frontend/logViewer, `uv` for backend) and follow the established coding conventions for each component.