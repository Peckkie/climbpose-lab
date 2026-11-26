# Contributing

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module layout and [docs/ROADMAP.md](docs/ROADMAP.md) for the plan.

## Branches and PRs

- One branch per change: `feat/…`, `fix/…`, `refactor/…`, `docs/…`
- Keep PRs small and, where possible, inside one module
- PRs touching analysis code (`src/core/**`) include eval results before/after
- PRs touching drawing (`src/render/**`) include screenshots of key frames (crux, send, route map)

## Data

- Never commit videos (`.gitignore` covers `*.mov`, `*.mp4`, `results/`)
- Pose fixtures (`tests/fixtures/*.pose.json`) only from clips whose owner agreed
- Clips from other people's social media are for local testing only

## Versions

v0.3 = end of Phase 1 · v0.4 = Phases 2–3 · v0.5 = Phase 4 · v0.6 = Phases 5–6 · v1.0 = Phase 7
