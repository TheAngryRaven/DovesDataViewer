# Plugin framework

The app discovers plugins at startup from `src/plugins/<name>/index.ts`. Each
folder must default-export a `DataViewerPlugin` (see `types.ts`). Discovery uses
`import.meta.glob`, so a folder that is **absent at build time simply never
loads** — the app builds and runs without it. This is how private features
(e.g. AI coaching) stay out of the public/open-source build and out of Lovable.

## Writing a plugin

```ts
// src/plugins/example/index.ts
import type { DataViewerPlugin } from "@/plugins/types";

const plugin: DataViewerPlugin = {
  id: "example",
  name: "Example",
  setup(ctx) {
    // Contribute to extension points; consumers read them via getContributions.
    ctx.registry.contribute("demo", "hello from example");
  },
};

export default plugin;
```

## The private coaching plugin (submodule)

The `coaching/` folder is **gitignored** in this public repo — it's a slot for a
private plugin mounted as a git submodule in a private fork. The public repo and
Lovable never see it.

In a private fork, add it once:

```bash
git submodule add git@github.com:TheAngryRaven/Dataviewer_ai_plugin.git src/plugins/coaching
git submodule update --init
```

The submodule's `index.ts` default-exports a `DataViewerPlugin` exactly like any
first-party plugin. Because the public repo has **no** `.gitmodules` entry,
Lovable's plain clone is unaffected — it builds the public app with an empty
slot. The AI build is any deployment where you init the submodule (with repo
credentials + your AI secrets), which is why that build is self-hosted rather
than on Lovable.

Offline-first note: the plugin is *bundled internal code*. Only its runtime AI
model calls go online — the accepted compromise. The Supabase cloud stays purely
file-sync.
