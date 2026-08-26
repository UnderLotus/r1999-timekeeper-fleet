# Keep the runtime static and browser-only

The deployed app remains a static GitHub Pages frontend: profiles stay in browser storage, and catalogs and assets are compiled into the repository before deployment instead of being fetched from game-data or wiki APIs at runtime. This trades account sync and live updates for privacy, simple deployment, reproducible releases, and independence from upstream outages; fresh game data therefore enters through reviewed sync and build outputs.
