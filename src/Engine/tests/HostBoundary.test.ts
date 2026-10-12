import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanText, scanRepo } from '../../../tools/secret-scan.mjs';
import {
  rendererEventNames,
  hostSendNames,
  eventBoundaryProblems,
} from '../../../tools/verify-host-events.mjs';

/**
 * Two cross-language boundaries that a type checker cannot see.
 *
 * Both are here for the same reason, and it is the reason `WindowEvents.test.ts`
 * exists: the failure is silent. A tray item dispatches an event nobody listens
 * for; a field-notes separator renders as `Â·`. Nothing throws, nothing logs, and
 * every test that exercises the renderer directly still passes, because the
 * renderer is fine -- it is the *wiring* to it that is wrong.
 *
 * The mojibake half is here because it shipped to players. The field-notes panel is
 * the surface the README calls the ARG surface, reachable from the tray and from
 * Ctrl+Alt+F, and three of its strings rendered `Â·` where a middot was intended.
 * The cause was UTF-8 bytes read as Latin-1 at some point in the file's history,
 * which no compiler and no runtime can detect: `Â·` is a perfectly valid string.
 */

const ROOT = join(process.cwd(), '..', '..');

function repoFile(...parts: string): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

describe('host/renderer event boundary', () => {
  const windowEvents = repoFile('src', 'Engine', 'src', 'core', 'windowEvents.ts');
  const host = repoFile('src', 'AnomalyEngine', 'Core', 'WallpaperHost.cs');
  const tray = repoFile('src', 'AnomalyEngine', 'Core', 'TrayIcon.cs');
  const settings = repoFile('src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs');
  const engineApp = repoFile('src', 'AnomalyEngine', 'EngineApp.cs');
  const sources = [
    { file: join(ROOT, 'src', 'AnomalyEngine', 'Core', 'WallpaperHost.cs'), text: host },
    { file: join(ROOT, 'src', 'AnomalyEngine', 'Core', 'TrayIcon.cs'), text: tray },
    { file: join(ROOT, 'src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs'), text: settings },
    { file: join(ROOT, 'src', 'AnomalyEngine', 'EngineApp.cs'), text: engineApp },
  ];

  it('has no disagreement between the two sides', () => {
    expect(eventBoundaryProblems(sources, windowEvents)).toEqual([]);
  });

  it('sends each of the four tray world/anomaly events as a bare suffix', () => {
    // The exact defect: these four read `SendToRenderer("anomaly:world-next")`, and
    // SendToRenderer adds the prefix itself, so the page was told to listen for
    // `anomaly:anomaly:world-next`. Next World, Previous World, Trigger Event and
    // Field Notes did nothing from the tray, while Ctrl+Alt+W worked fine.
    const names = hostSendNames([
      { file: join(ROOT, 'src', 'AnomalyEngine', 'Core', 'TrayIcon.cs'), text: tray },
    ]).filter((n) => n.via === 'SendToRenderer');

    expect(names.map((n) => n.name).sort()).toEqual(['notes', 'trigger', 'world-next', 'world-prev']);
  });

  it('refuses an already-prefixed name instead of dispatching it', () => {
    // The runtime half of the fix. Without the allowlist, a future call site that
    // gets this wrong again is silent again; with it, the name is refused and logged.
    expect(host).toContain('RendererEventNames');
    expect(host).toMatch(/if \(!RendererEventNames\.Contains\(eventName\)\)/);
  });

  it('sends the motion level as a call, not as an event name', () => {
    // The mirror-image mistake, in the settings window: it wanted to evaluate a
    // statement and passed one to a method that dispatches an event, so the
    // statement became an event name and the renderer never got the call. The
    // window then printed "Motion level set to 50%." anyway.
    expect(settings).not.toMatch(/SendToRenderer\(\s*\$?"window\./);
    expect(settings).toMatch(/\.SetMotionIntensity\(value\)/);
  });

  it('declares SetMotionIntensity on the bridge every caller holds', () => {
    // The settings window depends on IEngineBridge, not the host, so adding a method
    // to the host alone would not have compiled -- and a stub bridge that quietly
    // lacks it would be the next thing to rot.
    expect(repoFile('src', 'AnomalyEngine', 'Core', 'IEngineBridge.cs')).toMatch(
      /void SetMotionIntensity\(double intensity\);/
    );
    expect(repoFile('tools', 'SettingsShot', 'MarshallingStubBridge.cs')).toMatch(
      /public void SetMotionIntensity\(double intensity\)/
    );
  });

  it('separates a fullscreen pause from a user pause', () => {
    // `HandleFullscreenChange` was implemented, commented with the reason it exists,
    // and called by nothing. EngineApp called Pause()/Resume() instead, which set the
    // *user* flag, so closing a fullscreen app resumed a wallpaper the user had
    // paused on purpose -- exactly the case the method was written to prevent.
    expect(engineApp).toMatch(/HandleFullscreenChange\(e\.IsFullscreen\)/);
    expect(engineApp).not.toMatch(/Fullscreen app detected[\s\S]{0,120}?\.Pause\(\)/);
  });
});

describe('text encoding', () => {
  it('renders the middot in the field-notes overlay, not a mangled pair', () => {
    // Three lines, all user-visible, all in the panel the README calls the ARG
    // surface. `Â·` is not a placeholder that renders as something; it is what the
    // player read.
    const fieldNotes = repoFile('src', 'Engine', 'src', 'platform', 'FieldNotes.ts');
    expect(fieldNotes).not.toMatch(/\u00c2\u00b7/);
    expect(fieldNotes).toMatch(/clues\.join\(' \u00b7 '\)/);
    expect(fieldNotes).toMatch(/\} \u00b7 \$\{this\._when\(e\.timestamp\)\}/);
  });

  it('finds no mojibake anywhere in the tracked repository', () => {
    // Scanned with the same walker the secret scan uses, so a new file is covered
    // without anyone remembering to add it to a list.
    const { problems, scanned } = scanRepo(ROOT);
    expect(scanned).toBeGreaterThan(100);
    expect(problems.filter((p: { rule: string }) => p.rule === 'mojibake')).toEqual([]);
  });

  it('detects the corruption it just fixed', () => {
    // A guard that cannot fail is not a guard. The fixture is assembled rather than
    // written out for the reason the secret scan assembles its keys: a literal
    // corruption sitting in a test file would itself be a finding.
    const BAD = '\u00c2\u00b7';
    const findings = scanText(`const sep = '${BAD}';`).filter((f: { rule: string }) => f.rule === 'mojibake');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(1);
  });

  it('does not mistake ordinary non-ASCII text for corruption', () => {
    // Every real string in this file is non-ASCII and none of it is mojibake. A rule
    // that flagged them would be silenced by disabling itself, which is worse than
    // not having it.
    expect(scanText(`const em = '\u2014'; const dot = '\u00b7'; const dia = '\u00e4';`)).toEqual([]);
  });
});
