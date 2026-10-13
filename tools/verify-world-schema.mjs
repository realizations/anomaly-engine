/**
 * Keeps the C# world validator in step with the TypeScript world schema.
 *
 * `livingwall world validate` used to check a `manifest.json` requiring an
 * `entryScene` field, which no world has, and did not check `terrain`, which every
 * world has. It therefore rejected every world that would actually load and accepted
 * documents that would not. Nobody noticed because the command was never run against a
 * real world.
 *
 * The validator now lives in `src/AnomalyEngine/Core/WorldFolder.cs`, beside the loader
 * that has to agree with it, and it is the one the engine itself uses. That is the
 * right place for it and it removes the CLI's copy -- but it introduces a second
 * transcription of the schema, because the schema is a TypeScript interface in another
 * project. Two transcriptions drift, so this checks them against each other:
 *
 *   - every field the C# validator requires is a non-optional field of
 *     `WorldDefinition`;
 *   - every non-optional field of `WorldDefinition` is required by the C# validator;
 *   - the biome list is the same in both;
 *   - `livingwall` references the engine assembly rather than reimplementing it.
 *
 * The first check is the one that matters: a field required in C# and optional in
 * TypeScript means the command rejects a valid world.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const read = (...parts) => readFileSync(resolve(ROOT, ...parts), 'utf8');

/**
 * The interface body, as source text.
 *
 * Read as text rather than parsed because the goal is to catch drift, and a parser
 * that silently skips a member it cannot handle would itself be a source of drift. A
 * missing member shows up as a failed assertion rather than as a shorter list.
 */
/**
 * The fields the renderer's own validator requires.
 *
 * Read from the validator rather than from the interface's optionality markers,
 * because those two disagree: `author` is declared non-optional on `WorldDefinition`
 * but `validateWorldDefinition` does not require it, and `docs/world-format.md` calls
 * it "optional in practice". The validator is what decides whether a world loads, so it
 * is the authority here.
 */
export function requiredFieldsFromTypes(types) {
  const list = /for \(const field of \[([\s\S]*?)\] as const\)/.exec(types)?.[1];
  if (!list) return [];
  const strings = [...list.matchAll(/'([A-Za-z]\w*)'/g)].map((m) => m[1]);
  // `terrain` is required separately, as an object rather than as a string, and is
  // checked a few lines below in the same function.
  return [...strings, 'terrain'];
}

export function idPatternFromTypes(types) {
  return /!\/(\^\[a-z0-9\].*?\$)\/\.test\(w\.id\)/.exec(types)?.[1] ?? null;
}

export function biomeListFromTypes(types) {
  const block = /const BIOMES:\s*BiomeId\[\]\s*=\s*\[([\s\S]*?)\]/.exec(types);
  if (!block) return [];
  return [...block[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
}

export function schemaProblems(files) {
  const f = files ?? {
    TYPES: read('src', 'Engine', 'src', 'worlds', 'types.ts'),
    CS: read('src', 'AnomalyEngine', 'Core', 'WorldFolder.cs'),
    CLI: read('tools', 'livingwall', 'Program.cs'),
    CSPROJ: read('tools', 'livingwall', 'livingwall.csproj'),
    HOST: read('src', 'AnomalyEngine', 'Core', 'WallpaperHost.cs'),
  };
  const problems = [];

  const requiredInTs = requiredFieldsFromTypes(f.TYPES);
  if (!requiredInTs.length) problems.push('could not read WorldDefinition out of types.ts');

  // The C# list, read as the array literal it is.
  const block = /RequiredFields\s*=\s*\{([\s\S]*?)\}/.exec(f.CS)?.[1] ?? '';
  const requiredInCs = [...block.matchAll(/"([A-Za-z_]\w*)"/g)].map((m) => m[1]);

  if (!requiredInCs.length) problems.push('could not read RequiredFields out of WorldFolder.cs');

  for (const field of requiredInCs) {
    if (!requiredInTs.includes(field)) {
      problems.push(
        `WorldFolder requires "${field}", which WorldDefinition does not require. ` +
          'The command would reject a valid world.'
      );
    }
  }
  for (const field of requiredInTs) {
    if (!requiredInCs.includes(field)) {
      problems.push(
        `the renderer requires "${field}", which WorldFolder does not. ` +
          'The command would pass a world the engine refuses.'
      );
    }
  }

  // The id pattern, compared as source text. A stricter C# pattern is the failure that
  // matters: `world validate` refusing a world the engine would happily load.
  const idPatternTs = idPatternFromTypes(f.TYPES);
  const idPatternCs = /IdPattern\s*=\s*@"([^"]+)"/.exec(f.CS)?.[1] ?? null;
  if (!idPatternTs) problems.push('could not read the id pattern out of types.ts');
  if (!idPatternCs) problems.push('could not read IdPattern out of WorldFolder.cs');
  if (idPatternTs && idPatternCs && idPatternTs !== idPatternCs) {
    problems.push(
      `the id patterns differ: renderer /^${idPatternTs}/, CLI /^${idPatternCs}/. ` +
        'A stricter rule here means world validate refuses worlds the engine accepts.'
    );
  }

  // The biome list. Both are required: a CLI that skips the biome check would pass a
  // world the renderer then loads with a fallback terrain, which looks like the wrong
  // world rather than an error.
  const biomeBlock = /Biomes\s*=\s*\{([\s\S]*?)\}/.exec(f.CS)?.[1] ?? '';
  const biomesInCs = [...biomeBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  const biomesInTs = biomeListFromTypes(f.TYPES);
  if (!biomesInCs.length) {
    problems.push('WorldFolder does not list the biomes, so an unknown biome would pass validation.');
  }
  if (biomesInCs.length && biomesInTs.length) {
    const onlyTs = biomesInTs.filter((b) => !biomesInCs.includes(b));
    const onlyCs = biomesInCs.filter((b) => !biomesInTs.includes(b));
    if (onlyTs.length || onlyCs.length) {
      problems.push(
        `the biome lists disagree: only in the renderer ${onlyTs.join(', ') || '(none)'}; ` +
        `only in WorldFolder ${onlyCs.join(', ') || '(none)'}`
      );
    }
  }

  // The CLI must call the engine's validator rather than carrying its own.
  if (!/WorldFolder\.(Validate|Load)\(/.test(f.CLI)) {
    problems.push('livingwall does not call WorldFolder, so it has its own validator again.');
  }
  if (!/ProjectReference.+AnomalyEngine\.csproj/.test(f.CSPROJ)) {
    problems.push('livingwall.csproj does not reference the engine assembly.');
  }

  // And the host must actually load the folder, or `world install` writes somewhere
  // nothing reads -- which is the bug this whole file exists because of.
  if (!/WorldFolder\.Load\(/.test(f.HOST)) {
    problems.push('the host never reads the worlds folder, so installing a world does nothing.');
  }
  if (!/FileSystemWatcher/.test(f.HOST)) {
    problems.push('the host does not watch the worlds folder, so an install needs a restart.');
  }

  return problems;
}

/* --------------------------------- self-test --------------------------------- */

if (process.argv.includes('--selftest')) {
  const base = {
    TYPES: read('src', 'Engine', 'src', 'worlds', 'types.ts'),
    CS: read('src', 'AnomalyEngine', 'Core', 'WorldFolder.cs'),
    CLI: read('tools', 'livingwall', 'Program.cs'),
    CSPROJ: read('tools', 'livingwall', 'livingwall.csproj'),
    HOST: read('src', 'AnomalyEngine', 'Core', 'WallpaperHost.cs'),
  };
  const cases = [];
  const record = (name, files, shouldFail) => {
    const problems = schemaProblems(files);
    const ok = (problems.length > 0) === shouldFail;
    cases.push({ name, ok, problems });
  };

  record('the repository as it stands agrees', base, false);

  record(
    'a field required in C# but optional in TypeScript is caught',
    { ...base, CS: base.CS.replace('"biome", "terrain",', '"biome", "terrain", "palette",') },
    true
  );

  record(
    'a field required by the renderer but not by the CLI is caught',
    { ...base, CS: base.CS.replace('"description", "biome", "terrain",', '"biome", "terrain",') },
    true
  );

  record(
    'a field added to WorldDefinition and not to the validator is caught',
    {
      ...base,
      TYPES: base.TYPES.replace("'biome'] as const", "'biome', 'waterLevel'] as const"),
    },
    true
  );

  record(
    'a stricter id pattern in the CLI is caught',
    { ...base, CS: base.CS.replace('"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"', '"^[a-z0-9]+(-[a-z0-9]+)*$"') },
    true
  );

  record(
    'a diverged biome list is caught',
    { ...base, CS: base.CS.replace('"salt-marsh",', '"salt-marsh", "new-biomone",') },
    true
  );

  record(
    'the host not reading the folder is caught',
    { ...base, HOST: base.HOST.replace('WorldFolder.Load(', 'SomethingElse.Load(') },
    true
  );

  record(
    'the CLI carrying its own validator again is caught',
    { ...base, CLI: base.CLI.replace(/WorldFolder\.(Validate|Load)\(/g, 'MyOwnValidator(') },
    true
  );

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) for (const p of c.problems) process.stdout.write(`        ${p}\n`);
  }
  process.stdout.write(
    failed ? `\n${failed} assertion(s) failed.\n` : '\nThe world-schema check behaves.\n'
  );
  process.exit(failed ? 1 : 0);
}

/* ------------------------------- the repository ------------------------------ */

const problems = schemaProblems();
if (problems.length) {
  console.error('FAIL  the world validator does not match the world schema:');
  for (const p of problems) console.error(`      ${p}`);
  process.exit(1);
}
console.log('PASS  the C# world validator, the CLI and the TypeScript schema all agree');