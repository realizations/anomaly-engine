---
name: World Submission
about: Submit a world for inclusion
title: ''
labels: world-submission
assignees: ''
---

**World name**
The name of your world.

**World ID**
The unique identifier. Must be lowercase kebab-case, e.g. `my-mysterious-world`.

**Biome**
One of: `temperate-forest`, `salt-marsh`, `alpine`, `high-desert`, `coast`.

**Description**
One or two sentences about the place.

**Source**
A link to the `WorldDefinition` object, or a pull request adding it to
`src/Engine/src/worlds/registry.ts`.

**Screenshots**
Optional. `node tools/worlds.mjs <hour> <style>` renders every world to `build/worlds/`.

**Checklist**
- [ ] I have read [`docs/WORLD-FORMAT.md`](../../docs/WORLD-FORMAT.md)
- [ ] My world has a unique `terrain.seed`
- [ ] Every structure kind I used belongs to the biome
- [ ] `terrain.road` is `0` where a paved road makes no sense
- [ ] The world defines at least one `lore.deniability` line
- [ ] I did not add binary assets; a world is data, not art
- [ ] The world works offline and degrades gracefully
