/**
 * The project's secret-key registry: one table describing every credential the
 * project knows how to use.
 *
 * The failure this prevents is silent. A key that lives in a README, is read by
 * one module, and is never mentioned by the leak scan is a key nobody notices
 * leaking. Here `.env.example`, the scan and the tests all derive from this
 * table, so adding a provider is one entry and every guard follows it without
 * anyone having to remember three places to update.
 *
 * Import: import { SECRET_KEYS } from './secret-keys.mjs'
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * `name` is the environment variable name, in the conventional SCREAMING_SNAKE
 * form the scan greps for. `consumer` is the source file that would read it --
 * recorded so the registry cannot quietly describe a provider that no longer
 * exists, which is the same class of drift the asset licence gate checks for a
 * copied file describing bytes it no longer matches.
 */
export const SECRET_KEYS = [
  {
    name: 'OPENWEATHER_API_KEY',
    what: 'OpenWeatherMap current-weather key',
    provider: 'OpenWeatherMapProvider',
    consumer: 'src/Engine/src/systems/WeatherSystem.ts',
    optional: true,
    howToGet: 'https://home.openweathermap.org/api_keys',
    note:
      'The provider takes the key as a constructor argument and nothing constructs it yet, '
      + 'so the engine runs with no key at all. Supply one only if you wire the provider up.',
  },
];

/** Names we treat as credential-shaped when they appear in `.env.example`. */
const CREDENTIAL_SHAPED = /_(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/;

export function isCredentialShaped(name) {
  return CREDENTIAL_SHAPED.test(String(name));
}

/**
 * Problems with the registry itself. A registry nobody validates is a list that
 * drifts, and a drifted list is worse than no list: it reads as authoritative.
 */
export function registryProblems(keys = SECRET_KEYS, root = ROOT) {
  const problems = [];
  const seen = new Set();

  if (!Array.isArray(keys) || keys.length === 0) {
    return ['registry must be a non-empty array'];
  }

  for (const [i, k] of keys.entries()) {
    const at = `SECRET_KEYS[${i}]`;
    if (!k || typeof k !== 'object') { problems.push(`${at} is not an object`); continue; }

    const name = typeof k.name === 'string' ? k.name : '';
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      problems.push(`${at}.name ${JSON.stringify(name)} must be SCREAMING_SNAKE_CASE`);
      continue;
    }
    if (seen.has(name)) problems.push(`${at}.name "${name}" is declared twice`);
    seen.add(name);

    if (!isCredentialShaped(name)) {
      problems.push(`${at}.name "${name}" must end in _KEY, _TOKEN, _SECRET, _PASSWORD or _CREDENTIALS`);
    }
    if (!k.what || typeof k.what !== 'string') problems.push(`${at}.what must say what the key is for`);
    if (!k.provider || typeof k.provider !== 'string') problems.push(`${at}.provider must name the class that uses it`);
    if (typeof k.optional !== 'boolean') problems.push(`${at}.optional must be a boolean -- an undocumented required key is a surprise outage`);
    if (!k.howToGet || !/^https:\/\//.test(String(k.howToGet))) problems.push(`${at}.howToGet must be an https URL`);

    const consumer = typeof k.consumer === 'string' ? k.consumer : '';
    if (!consumer) {
      problems.push(`${at}.consumer must name the source file that reads it`);
    } else if (!existsSync(join(root, consumer))) {
      problems.push(`${at}.consumer "${consumer}" does not exist`);
    }
  }
  return problems;
}
