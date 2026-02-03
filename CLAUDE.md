# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SocialDataBridge is a Feishu/Lark Base Extension plugin that fetches social media data (Douyin, Xiaohongshu) from creator profiles or keyword searches and exports it to Feishu multi-dimensional tables.

## Build Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production (alias for build:prod)
npm run build:test   # Build for test environment
npm run build:prod   # Build for production environment
npm run preview      # Preview production build on port 4173
```

## Architecture

**Entry Flow:** `index.html` → `src/main.js` → `src/App.vue` → `src/components/Form.vue`

**Core Component (Form.vue):**
- **Tab 1 - Profile Fetching:** Batch fetches posts from creator profile URLs
- **Tab 2 - Keyword Search:** Searches platforms by keyword with filters
- Both tabs poll task status every 3s (max 600s timeout) and export results to Feishu tables

**API Pattern:**
- Backend: `https://api.52choujiang.cn` (prod) or `https://test-lotto.weiyoubot.cn` (test)
- Endpoints: `/social/api/v1/feishu/social/task` (profile), `/social/api/v1/feishu/keyword/task` (search)
- Response format: `{ sta: 0, data: {...}, msg: string }`
- Task status: `0`=processing, `1`=success, `2`=failed

**Feishu Integration:**
- Uses `@lark-base-open/js-sdk`
- Creates sequential tables with numeric suffixes to avoid duplicates
- API key stored via `bitable.bridge.setData("api_key", value)`

**Vite Config:**
- Auto-imports Vue and Element Plus components
- Proxy configured for `/social/api` requests in development

## Tech Stack

- Vue 3 (Composition API with `<script setup>`)
- Vite 3, Element Plus
- @lark-base-open/js-sdk, Axios
- Environment variables: `.env.development`, `.env.test`, `.env.production`

## Key Conventions

- Use `<script setup>` syntax for Vue 3 components
- Chinese comments and UI text throughout
- Pagination: 20 items per page

## Publishing

Run `npm run build` before submitting. Include the `dist` directory and fill out the [share form](https://feishu.feishu.cn/share/base/form/shrcnGFgOOsFGew3SDZHPhzkM0e).
