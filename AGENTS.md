# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the extension source. Use `src/components/` for page-level Vue components such as `ProfileFetch.vue`, `SeriesFetch.vue`, and `HotListFetch.vue`. Put shared logic in `src/composables/` (`useSocialData.js`) and request/config helpers in `src/utils/`. Locale files live in `src/locales/`. Static assets belong in `public/` or `src/assets/`. Production output is generated into `dist/` and is committed for publishing.

## Build, Test, and Development Commands
- `npm run dev`: start the Vite dev server in development mode.
- `npm run build`: build the production bundle into `dist/`.
- `npm run build:test`: build against the test environment.
- `npm run build:prod`: explicit production build alias.
- `npm run preview`: preview the built app locally on port `4173`.

Run `npm run build` before submitting or publishing changes.

## Coding Style & Naming Conventions
Use Vue 3 with `<script setup>` and Composition API patterns. Follow the existing code style: 2-space indentation, semicolon-terminated JavaScript, and concise helper functions near their usage. Name Vue components in PascalCase (`KeywordSearch.vue`); name composables and utilities in camelCase (`useSocialData.js`, `platformConfig.js`). Keep UI copy consistent with the existing Chinese interface unless a feature already uses English labels.

## Testing Guidelines
There is no dedicated automated test suite in this repository yet. Validate changes by running `npm run build` and manually checking the affected extension flow in Feishu/Lark Base. For data-export features, verify both “新建表格” and “使用现有表格” paths when relevant.

## Commit & Pull Request Guidelines
Recent history uses short subjects with scoped prefixes such as `opt:新增主页短剧获取`. Prefer concise, imperative commit messages in that style. Pull requests should include a short summary, impacted user flow, any required backend/config assumptions, and screenshots for visible UI changes. Mention if `dist/` was rebuilt.

## Security & Configuration Tips
Do not hardcode API hosts or secrets in components. Use the existing Vite environment configuration and `src/utils/request.js`. Treat API keys as user data stored through the Feishu SDK bridge, and avoid logging sensitive values.
