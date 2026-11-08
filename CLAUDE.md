@AGENTS.md

## Claude Code notes

- `packages/plugin` is a Claude Code plugin. Check hook event names, hook input/output fields, and plugin manifest format against the current Claude Code docs before relying on them.
- Rebuild with `pnpm --filter @aim/plugin build` after changing `packages/plugin/src`; hooks and the MCP server run the bundled `dist/aim.mjs`. Load the plugin locally with `claude --plugin-dir packages/plugin`.
- Hooks must never block on the network: record locally, hand off to a background process, return.
