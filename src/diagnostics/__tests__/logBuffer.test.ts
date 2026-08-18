import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLogEntries,
  getLogEntries,
  installConsoleCapture,
  recordLog,
} from '../logBuffer';

/**
 * The ring buffer, and above all its redaction -- these entries are uploaded
 * with a crash report (see crashReport.ts), so anything it fails to strip
 * leaves the device.
 */

beforeEach(() => {
  clearLogEntries();
});

describe('redaction', () => {
  it('strips a JWT out of a message', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    recordLog('warn', [`[location] realtime heartbeat failed: token ${jwt} rejected`]);

    const [entry] = getLogEntries();
    expect(entry.message).not.toContain(jwt);
    expect(entry.message).not.toContain('eyJ');
    expect(entry.message).toContain('[token]');
  });

  it('strips a JWT nested inside a logged object', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.abcdefghijklmnop';
    recordLog('error', ['refresh failed', { access_token: jwt, status: 401 }]);

    const [entry] = getLogEntries();
    expect(entry.message).not.toContain(jwt);
    expect(entry.message).toContain('[token]');
    // The rest of the object survives -- redaction is a scalpel, not a bin.
    expect(entry.message).toContain('401');
  });

  it('shortens user ids instead of destroying them', () => {
    recordLog('warn', ['[meet] channel for bbbbbbbb-1111-2222-3333-444444444444 failed to join']);

    const [entry] = getLogEntries();
    expect(entry.message).not.toContain('bbbbbbbb-1111-2222-3333-444444444444');
    // Enough to tell two friends' channels apart within one report, which is
    // usually the whole question, and not enough to identify anyone outside it.
    expect(entry.message).toContain('bbbbbbbb…');
  });

  it('keeps two different ids distinguishable', () => {
    recordLog('warn', ['aaaaaaaa-1111-2222-3333-444444444444 and bbbbbbbb-1111-2222-3333-444444444444']);
    const [entry] = getLogEntries();
    expect(entry.message).toContain('aaaaaaaa…');
    expect(entry.message).toContain('bbbbbbbb…');
  });
});

describe('the buffer', () => {
  it('renders an Error by message rather than as an empty object', () => {
    recordLog('error', ['boom', new TypeError('cannot read property of undefined')]);
    expect(getLogEntries()[0].message).toBe(
      'boom TypeError: cannot read property of undefined',
    );
  });

  it('survives a circular object instead of throwing inside the logger', () => {
    const circular: Record<string, unknown> = { name: 'channel' };
    circular.self = circular;
    expect(() => recordLog('warn', ['state', circular])).not.toThrow();
    expect(getLogEntries()[0].message).toContain('[unserialisable object]');
  });

  it('drops the oldest entries rather than growing without bound', () => {
    for (let i = 0; i < 250; i++) recordLog('warn', [`entry ${i}`]);

    const held = getLogEntries();
    expect(held).toHaveLength(200);
    // The newest survive, the earliest are gone.
    expect(held[held.length - 1].message).toBe('entry 249');
    expect(held.some((e) => e.message === 'entry 0')).toBe(false);
  });
});

describe('console capture', () => {
  // Order matters, and getting it wrong is easy: `spyOn` replaces
  // `console.warn` outright, so spying *after* installation would swap the
  // capture wrapper back out and quietly test nothing. Spy first, install on
  // top of it -- and install twice here, so the idempotence claim below is
  // about a real second call rather than one the module had already absorbed.
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    installConsoleCapture();
    installConsoleCapture();
  });

  afterAll(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('records a warning and still passes it through to the console', () => {
    console.warn('[broadcast] refused (no-channel)');

    expect(warnSpy).toHaveBeenCalledWith('[broadcast] refused (no-channel)');
    expect(getLogEntries().at(-1)?.message).toBe('[broadcast] refused (no-channel)');
  });

  it('records each message once despite being installed twice', () => {
    console.warn('once');

    expect(getLogEntries()).toHaveLength(1);
  });

  it('captures errors as well as warnings', () => {
    console.error('journey service went away');

    expect(errorSpy).toHaveBeenCalled();
    expect(getLogEntries().at(-1)).toMatchObject({
      level: 'error',
      message: 'journey service went away',
    });
  });
});
