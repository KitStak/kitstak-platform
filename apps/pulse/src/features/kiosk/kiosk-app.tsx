'use client';
/**
 * The floor tablet. No sign in: a person picks their name and types a 4 digit PIN, picks a job
 * card, types the units on a number pad, sets people and hours each, and saves. One job at a
 * time, a big confirmation, then the next job. It locks itself after a short idle time.
 *
 * When the wifi drops, entries wait on the tablet and are sent later with the same id, so nothing
 * is logged twice. This screen never shows money.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CloudOff,
  Delete,
  Lock,
  Minus,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trash2,
  Users,
  Wifi,
} from 'lucide-react';
import { cn } from '@/components/ui/cn';
import { formatHours, formatNumber, formatPace } from '@/lib/format';
import { laborHoursFromCrew, productivityBp, unitsPerHour } from '@/lib/profit';
import type { KioskJobDTO, KioskPersonDTO, KioskSaveDTO, KioskSessionDTO, KioskStateDTO } from '@/lib/types';
import { kioskPost, loadQueue, newClientRef, storeQueue, type QueuedEntry } from './kiosk-client';

type Screen = 'names' | 'pin' | 'jobs' | 'entry' | 'done';

interface Unlocked {
  readonly session: string;
  readonly person: KioskPersonDTO;
}

interface DoneState {
  readonly job: KioskJobDTO;
  readonly queued: boolean;
  readonly result: KioskSaveDTO | null;
  readonly units: number;
  readonly hours: number;
}

const big =
  'inline-flex min-h-16 items-center justify-center gap-2 rounded-2xl px-6 text-xl font-semibold transition-colors select-none focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40';
const primary = cn(big, 'bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active');
const quiet = cn(big, 'border border-border-input bg-panel text-fg hover:bg-muted active:bg-pressed');

export function KioskApp({ token, initial }: { readonly token: string; readonly initial: KioskStateDTO }) {
  const [state, setState] = useState(initial);
  const [screen, setScreen] = useState<Screen>('names');
  const [person, setPerson] = useState<KioskPersonDTO | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState<Unlocked | null>(null);
  const [jobs, setJobs] = useState<readonly KioskJobDTO[]>([]);
  const [job, setJob] = useState<KioskJobDTO | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const [queue, setQueue] = useState<QueuedEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [dead, setDead] = useState(false);
  const queueRef = useRef<QueuedEntry[]>([]);
  const unlockedRef = useRef<Unlocked | null>(null);
  const flushing = useRef(false);

  const saveQueue = useCallback(
    (next: QueuedEntry[]) => {
      queueRef.current = next;
      setQueue(next);
      storeQueue(token, next);
    },
    [token],
  );

  const lock = useCallback(() => {
    unlockedRef.current = null;
    setUnlocked(null);
    setPerson(null);
    setPin('');
    setPinError(null);
    setJob(null);
    setDone(null);
    setScreen('names');
  }, []);

  /** Sends waiting entries one at a time, oldest first. A retry carries the same id, so it is safe. */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const entry of [...queueRef.current]) {
        if (entry.failed) continue;
        const session = unlockedRef.current?.session ?? entry.session;
        const result = await kioskPost<KioskSaveDTO>('production', {
          token,
          session,
          clientRef: entry.clientRef,
          jobId: entry.jobId,
          workDate: entry.workDate,
          unitsGood: entry.unitsGood,
          unitsScrap: entry.unitsScrap,
          headcount: entry.headcount,
          hoursEach: entry.hoursEach,
        });
        if (result.ok) {
          saveQueue(queueRef.current.filter((item) => item.clientRef !== entry.clientRef));
          setOnline(true);
          continue;
        }
        if (result.code === 'NETWORK_ERROR') {
          setOnline(false);
          break;
        }
        setOnline(true);
        if (result.code === 'UNAUTHENTICATED') {
          // The session it was typed under ran out. It goes out after the next unlock.
          saveQueue(
            queueRef.current.map((item) =>
              item.clientRef === entry.clientRef ? { ...item, needsUnlock: true } : item,
            ),
          );
          if (!unlockedRef.current) break;
          continue;
        }
        if (result.code === 'RATE_LIMITED') break;
        saveQueue(
          queueRef.current.map((item) =>
            item.clientRef === entry.clientRef ? { ...item, failed: result.message } : item,
          ),
        );
      }
    } finally {
      flushing.current = false;
    }
  }, [saveQueue, token]);

  useEffect(() => {
    // What was typed before a reload or a dead battery is still on the tablet: pick it up and send it.
    const start = setTimeout(() => {
      const stored = loadQueue(token);
      queueRef.current = stored;
      setQueue(stored);
      setOnline(navigator.onLine);
      void flush();
    }, 0);
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = setInterval(() => void flush(), 20_000);
    return () => {
      clearTimeout(start);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(timer);
    };
  }, [flush, token]);

  // Idle lock: any touch or key restarts the clock.
  useEffect(() => {
    if (!unlocked) return;
    let timer = setTimeout(lock, state.idleSeconds * 1000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, state.idleSeconds * 1000);
    };
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, reset);
    };
  }, [lock, state.idleSeconds, unlocked]);

  // Keep the lock screen fresh (new day, new names) while the tablet sits there.
  useEffect(() => {
    if (unlocked) return;
    const refresh = async () => {
      const result = await kioskPost<KioskStateDTO>('state', { token });
      if (result.ok) {
        setState(result.data);
        setOnline(true);
      } else if (result.code === 'NOT_FOUND') setDead(true);
      else if (result.code === 'NETWORK_ERROR') setOnline(false);
    };
    const timer = setInterval(() => void refresh(), 120_000);
    return () => clearInterval(timer);
  }, [token, unlocked]);

  async function tryUnlock(code: string) {
    if (!person) return;
    setBusy(true);
    setPinError(null);
    const result = await kioskPost<KioskSessionDTO>('unlock', { token, userId: person.id, pin: code });
    setBusy(false);
    if (!result.ok) {
      setPin('');
      if (result.code === 'NETWORK_ERROR') {
        setOnline(false);
        setPinError(
          'No connection. The tablet needs wifi to check your PIN. Entries you already saved are safe.',
        );
      } else if (result.code === 'NOT_FOUND') setDead(true);
      else setPinError(result.message);
      return;
    }
    setOnline(true);
    setUnlocked({ session: result.data.session, person: result.data.person });
    unlockedRef.current = { session: result.data.session, person: result.data.person };
    setJobs(result.data.jobs);
    setPin('');
    setScreen('jobs');
    void flush();
  }

  function typePin(digit: string) {
    if (busy) return;
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    setPinError(null);
    if (next.length === 4) void tryUnlock(next);
  }

  async function refreshJobs() {
    if (!unlocked) return;
    const result = await kioskPost<KioskJobDTO[]>('jobs', { token, session: unlocked.session });
    if (result.ok) {
      setJobs(result.data);
      setOnline(true);
    } else if (result.code === 'UNAUTHENTICATED') lock();
    else if (result.code === 'NETWORK_ERROR') setOnline(false);
  }

  async function saveEntry(input: { units: number; scrap: number; people: number; hoursEach: number }) {
    if (!unlocked || !job) return;
    const entry: QueuedEntry = {
      clientRef: newClientRef(),
      jobId: job.jobId,
      jobLabel: `${job.jobNumber} ${job.jobName}`,
      workDate: state.today,
      unitsGood: String(input.units),
      unitsScrap: String(input.scrap),
      headcount: String(input.people),
      hoursEach: String(input.hoursEach),
      session: unlocked.session,
      personName: unlocked.person.name,
      savedAt: new Date().toISOString(),
    };
    // Stored on the tablet first, so a dropped connection or a closed tab cannot lose it.
    saveQueue([...queueRef.current, entry]);
    setBusy(true);
    const result = await kioskPost<KioskSaveDTO>('production', {
      token,
      session: entry.session,
      clientRef: entry.clientRef,
      jobId: entry.jobId,
      workDate: entry.workDate,
      unitsGood: entry.unitsGood,
      unitsScrap: entry.unitsScrap,
      headcount: entry.headcount,
      hoursEach: entry.hoursEach,
    });
    setBusy(false);
    const hours = laborHoursFromCrew(input.people, input.hoursEach);
    if (result.ok) {
      setOnline(true);
      saveQueue(queueRef.current.filter((item) => item.clientRef !== entry.clientRef));
      setJobs((list) =>
        list.map((item) =>
          item.jobId === job.jobId
            ? { ...item, todayUnits: result.data.todayUnits, todayHours: result.data.todayHours }
            : item,
        ),
      );
      setDone({ job, queued: false, result: result.data, units: input.units, hours });
      setScreen('done');
      return;
    }
    if (result.code === 'NETWORK_ERROR') {
      setOnline(false);
      setDone({ job, queued: true, result: null, units: input.units, hours });
      setScreen('done');
      return;
    }
    // The server said no (closed month, day marked complete, job closed). Nothing waits in the queue.
    saveQueue(queueRef.current.filter((item) => item.clientRef !== entry.clientRef));
    if (result.code === 'UNAUTHENTICATED') {
      lock();
      return;
    }
    return result.message;
  }

  if (dead) return <NotActive />;

  const waiting = queue.filter((entry) => !entry.failed).length;
  const failed = queue.filter((entry) => entry.failed);

  return (
    <div data-testid="kiosk" className="flex min-h-dvh flex-col bg-app text-fg">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-subtle bg-panel px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{state.siteName}</p>
          <p className="truncate text-sm text-fg-muted">
            {new Date(`${state.today}T12:00:00`).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
            {unlocked ? `. Logging as ${unlocked.person.name}` : ''}
          </p>
        </div>
        <span
          role="status"
          data-testid="kiosk-connection"
          className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium',
            !online || waiting > 0
              ? 'bg-warning-subtle text-warning-text'
              : 'bg-success-subtle text-success-text',
          )}
        >
          {!online ? <CloudOff aria-hidden className="size-4" /> : <Wifi aria-hidden className="size-4" />}
          {waiting > 0
            ? `${waiting} saved on this tablet. Will send when online.`
            : online
              ? 'Online'
              : 'No connection'}
        </span>
        {waiting > 0 && online ? (
          <button
            type="button"
            className={cn(quiet, 'min-h-11 rounded-xl px-4 text-base')}
            onClick={() => void flush()}
          >
            <RefreshCw aria-hidden className="size-5" /> Send now
          </button>
        ) : null}
        {unlocked ? (
          <button type="button" className={cn(quiet, 'min-h-11 rounded-xl px-4 text-base')} onClick={lock}>
            <Lock aria-hidden className="size-5" /> Lock
          </button>
        ) : null}
      </header>

      {failed.length > 0 ? (
        <div role="alert" className="border-b border-danger/40 bg-danger-subtle px-5 py-3 text-danger-text">
          <p className="text-base font-semibold">
            {failed.length === 1
              ? 'One entry was not accepted.'
              : `${failed.length} entries were not accepted.`}{' '}
            Tell a manager, then clear it.
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {failed.map((entry) => (
              <li key={entry.clientRef} className="flex flex-wrap items-center gap-3 text-base">
                <span className="min-w-0 flex-1">
                  {entry.jobLabel}: {formatNumber(entry.unitsGood, { maxDigits: 0 })} units by{' '}
                  {entry.personName}. {entry.failed}
                </span>
                <button
                  type="button"
                  className={cn(quiet, 'min-h-11 rounded-xl px-4 text-base')}
                  onClick={() =>
                    saveQueue(queueRef.current.filter((item) => item.clientRef !== entry.clientRef))
                  }
                >
                  <Trash2 aria-hidden className="size-5" /> Clear
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <main className="flex flex-1 flex-col px-5 py-6">
        {screen === 'names' ? (
          <Names
            people={state.people}
            onPick={(picked) => {
              setPerson(picked);
              setPin('');
              setPinError(null);
              setScreen('pin');
            }}
          />
        ) : null}
        {screen === 'pin' && person ? (
          <PinPad
            person={person}
            pin={pin}
            busy={busy}
            error={pinError}
            onDigit={typePin}
            onBack={() => (setPin(pin.slice(0, -1)), setPinError(null))}
            onCancel={lock}
          />
        ) : null}
        {screen === 'jobs' && unlocked ? (
          <JobCards
            jobs={jobs}
            onPick={(picked) => {
              setJob(picked);
              setScreen('entry');
            }}
            onRefresh={() => void refreshJobs()}
          />
        ) : null}
        {screen === 'entry' && job ? (
          <Entry
            key={job.jobId}
            job={job}
            shiftHours={Number(state.shiftHours) || 8}
            busy={busy}
            onSave={saveEntry}
            onBack={() => setScreen('jobs')}
          />
        ) : null}
        {screen === 'done' && done ? (
          <Done
            done={done}
            sent={done.queued && waiting === 0 && failed.length === 0}
            onNext={() => {
              setDone(null);
              setJob(null);
              setScreen('jobs');
              void refreshJobs();
            }}
            onLock={lock}
          />
        ) : null}
      </main>
    </div>
  );
}

export function NotActive() {
  return (
    <div
      data-testid="kiosk"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-app px-6 py-10 text-center text-fg"
    >
      <span aria-hidden className="flex size-24 items-center justify-center rounded-3xl bg-muted text-icon">
        <Lock className="size-12" strokeWidth={1.5} />
      </span>
      <h1 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
        This tablet link is not active
      </h1>
      <p className="max-w-xl text-lg text-fg-secondary sm:text-xl">
        The link may have run out or been turned off. Ask a manager to make a new one in Pulse under Log work,
        Floor tablet, then open it on this tablet.
      </p>
    </div>
  );
}

function Names({
  people,
  onPick,
}: {
  readonly people: readonly KioskPersonDTO[];
  readonly onPick: (person: KioskPersonDTO) => void;
}) {
  if (people.length === 0) {
    return (
      <div className="m-auto flex max-w-2xl flex-col items-center gap-5 text-center">
        <span
          aria-hidden
          className="flex size-24 items-center justify-center rounded-3xl bg-primary-subtle text-primary-text"
        >
          <Users className="size-12" strokeWidth={1.5} />
        </span>
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Nobody has a PIN yet</h1>
        <p className="text-xl text-fg-secondary">
          To log work here, a person needs a 4 digit PIN. Sign in to Pulse on a phone or computer, open Log
          work, tap Floor tablet and set your PIN. Your name then shows up on this screen.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">Who is logging?</h1>
        <p className="mt-1 text-xl text-fg-secondary">Tap your name.</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {people.map((person) => (
          <li key={person.id}>
            <button
              type="button"
              className={cn(quiet, 'min-h-24 w-full justify-start gap-4 px-6 text-left text-2xl')}
              onClick={() => onPick(person)}
            >
              <span
                aria-hidden
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-xl font-semibold text-primary-text"
              >
                {person.name
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase() ?? '')
                  .join('')}
              </span>
              <span className="min-w-0 truncate">{person.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const padKey = cn(quiet, 'min-h-20 text-3xl tabular-nums');

function PinPad({
  person,
  pin,
  busy,
  error,
  onDigit,
  onBack,
  onCancel,
}: {
  readonly person: KioskPersonDTO;
  readonly pin: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onDigit: (digit: string) => void;
  readonly onBack: () => void;
  readonly onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) onDigit(event.key);
      else if (event.key === 'Backspace') onBack();
      else if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onCancel, onDigit]);
  return (
    <div className="m-auto flex w-full max-w-md flex-col items-center gap-5">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">Hi {person.name.split(' ')[0]}</h1>
        <p className="mt-1 text-xl text-fg-secondary">Type your 4 digit PIN.</p>
      </div>
      <div className="flex gap-4" role="status" aria-label={`${pin.length} of 4 digits typed`}>
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={cn(
              'size-6 rounded-full border-2 transition-colors',
              index < pin.length ? 'border-primary bg-primary' : 'border-border-strong bg-transparent',
            )}
          />
        ))}
      </div>
      <p
        role="alert"
        data-testid="pin-error"
        className={cn(
          'min-h-14 text-center text-lg font-medium',
          error ? 'text-danger-text' : 'text-fg-muted',
        )}
      >
        {error ?? (busy ? 'Checking' : '')}
      </p>
      <div className="grid w-full grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button key={digit} type="button" className={padKey} disabled={busy} onClick={() => onDigit(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" className={cn(padKey, 'text-xl')} onClick={onCancel}>
          Not me
        </button>
        <button type="button" className={padKey} disabled={busy} onClick={() => onDigit('0')}>
          0
        </button>
        <button
          type="button"
          className={padKey}
          aria-label="Delete the last digit"
          disabled={busy || pin.length === 0}
          onClick={onBack}
        >
          <Delete aria-hidden className="size-8" />
        </button>
      </div>
    </div>
  );
}

function JobCards({
  jobs,
  onPick,
  onRefresh,
}: {
  readonly jobs: readonly KioskJobDTO[];
  readonly onPick: (job: KioskJobDTO) => void;
  readonly onRefresh: () => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="m-auto flex max-w-2xl flex-col items-center gap-5 text-center">
        <h1 className="text-3xl font-semibold tracking-[-0.02em]">No jobs are running at this site</h1>
        <p className="text-xl text-fg-secondary">
          A manager adds jobs in Pulse. Once a job is active and its start day has come, it shows here.
        </p>
        <button type="button" className={quiet} onClick={onRefresh}>
          <RefreshCw aria-hidden className="size-6" /> Look again
        </button>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <h1 className="text-3xl font-semibold tracking-[-0.02em]">Which job?</h1>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map((job) => {
          const logged = Number(job.todayUnits) > 0 || Number(job.todayHours) > 0;
          return (
            <li key={job.jobId}>
              <button
                type="button"
                data-testid="kiosk-job"
                onClick={() => onPick(job)}
                className="flex min-h-36 w-full flex-col items-start gap-2 rounded-2xl border border-border-input bg-panel p-5 text-left transition-colors hover:bg-muted focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus active:bg-pressed"
              >
                <span className="text-base font-medium text-fg-secondary tabular-nums">{job.jobNumber}</span>
                <span className="line-clamp-2 text-2xl leading-tight font-semibold">{job.jobName}</span>
                <span className="text-lg text-fg-secondary">{job.clientName}</span>
                <span
                  className={cn(
                    'mt-auto inline-flex items-center gap-2 rounded-full px-3 py-1 text-base font-medium',
                    logged ? 'bg-success-subtle text-success-text' : 'bg-muted text-fg-secondary',
                  )}
                >
                  {logged ? <Check aria-hidden className="size-4" /> : null}
                  {logged
                    ? `Today: ${formatNumber(job.todayUnits, { maxDigits: 0 })} ${job.unitLabel}, ${formatHours(job.todayHours)} labor hours`
                    : 'Nothing logged today'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stepper({
  label,
  value,
  step,
  min,
  max,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  readonly hint?: string;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next * 100) / 100));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-lg font-medium text-fg-secondary">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={cn(quiet, 'size-20 px-0')}
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          <Minus aria-hidden className="size-8" />
        </button>
        <output
          aria-live="polite"
          aria-label={label}
          className="min-w-24 flex-1 text-center text-5xl font-semibold tabular-nums"
        >
          {formatNumber(value, { maxDigits: 2 })}
        </output>
        <button
          type="button"
          className={cn(quiet, 'size-20 px-0')}
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          <Plus aria-hidden className="size-8" />
        </button>
      </div>
      {hint ? <span className="text-base text-fg-muted">{hint}</span> : null}
    </div>
  );
}

function Entry({
  job,
  shiftHours,
  busy,
  onSave,
  onBack,
}: {
  readonly job: KioskJobDTO;
  readonly shiftHours: number;
  readonly busy: boolean;
  readonly onSave: (input: {
    units: number;
    scrap: number;
    people: number;
    hoursEach: number;
  }) => Promise<string | undefined>;
  readonly onBack: () => void;
}) {
  const [units, setUnits] = useState('');
  const [scrap, setScrap] = useState('');
  const [target, setTarget] = useState<'units' | 'scrap'>('units');
  const [people, setPeople] = useState(job.usualPeople ?? 1);
  const [hoursEach, setHoursEach] = useState(shiftHours);
  const [error, setError] = useState<string | null>(null);
  const unitsNumber = Number(units || 0);
  const scrapNumber = Number(scrap || 0);
  const hours = laborHoursFromCrew(people, hoursEach);
  const pace = useMemo(
    () => (unitsNumber > 0 ? unitsPerHour(unitsNumber, hours) : null),
    [hours, unitsNumber],
  );
  const share = pace === null ? null : productivityBp(pace, job.targetUph);
  const ahead = share !== null && share >= 10000;

  const press = (digit: string) => {
    setError(null);
    const set = target === 'units' ? setUnits : setScrap;
    const current = target === 'units' ? units : scrap;
    if (digit === 'back') set(current.slice(0, -1));
    else if (digit === 'clear') set('');
    else if (current.length < 7) set(current === '0' ? digit : current + digit);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('back');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save() {
    if (unitsNumber === 0 && scrapNumber === 0 && hours === 0)
      return setError('Type the units finished first.');
    const problem = await onSave({ units: unitsNumber, scrap: scrapNumber, people, hoursEach });
    if (problem) setError(problem);
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className={cn(quiet, 'min-h-14 px-5 text-lg')} onClick={onBack}>
          <ArrowLeft aria-hidden className="size-6" /> Jobs
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-fg-secondary tabular-nums">{job.jobNumber}</p>
          <h1 className="truncate text-2xl font-semibold tracking-[-0.01em] sm:text-3xl">{job.jobName}</h1>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section
          aria-label="Units"
          className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-panel p-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              aria-pressed={target === 'units'}
              onClick={() => setTarget('units')}
              className={cn(
                'flex flex-col rounded-2xl border-2 px-4 py-3 text-left transition-colors focus-visible:outline-4 focus-visible:outline-focus',
                target === 'units' ? 'border-primary bg-primary-subtle' : 'border-border-input bg-panel',
              )}
            >
              <span className="text-lg font-medium text-fg-secondary">Good {job.unitLabel}</span>
              <span data-testid="kiosk-units" className="text-5xl font-semibold tabular-nums">
                {units === '' ? '0' : formatNumber(units, { maxDigits: 0 })}
              </span>
            </button>
            <button
              type="button"
              aria-pressed={target === 'scrap'}
              onClick={() => setTarget('scrap')}
              className={cn(
                'flex flex-col rounded-2xl border-2 px-4 py-3 text-left transition-colors focus-visible:outline-4 focus-visible:outline-focus',
                target === 'scrap' ? 'border-primary bg-primary-subtle' : 'border-border-input bg-panel',
              )}
            >
              <span className="text-lg font-medium text-fg-secondary">Scrap</span>
              <span className="text-5xl font-semibold tabular-nums">
                {scrap === '' ? '0' : formatNumber(scrap, { maxDigits: 0 })}
              </span>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button key={digit} type="button" className={padKey} onClick={() => press(digit)}>
                {digit}
              </button>
            ))}
            <button type="button" className={cn(padKey, 'text-xl')} onClick={() => press('clear')}>
              Clear
            </button>
            <button type="button" className={padKey} onClick={() => press('0')}>
              0
            </button>
            <button
              type="button"
              className={padKey}
              aria-label="Delete the last digit"
              onClick={() => press('back')}
            >
              <Delete aria-hidden className="size-8" />
            </button>
          </div>
        </section>
        <section
          aria-label="Crew"
          className="flex flex-col gap-6 rounded-2xl border border-border-subtle bg-panel p-5"
        >
          <Stepper label="People" value={people} step={1} min={0} max={500} onChange={setPeople} />
          <Stepper
            label="Hours each"
            value={hoursEach}
            step={0.5}
            min={0}
            max={24}
            onChange={setHoursEach}
            hint={`${formatNumber(people)} ${people === 1 ? 'person' : 'people'} for ${formatHours(hoursEach, { style: 'unit' })} is ${formatHours(hours, { style: 'unit' }).replace(' hour', ' labor hour')}.`}
          />
          <div
            aria-live="polite"
            data-testid="kiosk-pace"
            className={cn(
              'flex items-center gap-3 rounded-2xl px-4 py-3 text-xl font-medium',
              pace === null
                ? 'bg-muted text-fg-secondary'
                : share === null
                  ? 'bg-muted text-fg'
                  : ahead
                    ? 'bg-success-subtle text-success-text'
                    : 'bg-warning-subtle text-warning-text',
            )}
          >
            {pace === null ? (
              job.targetUph ? (
                `Target pace: ${formatPace(job.targetUph)} for each person each hour`
              ) : (
                'Type the units to see the pace'
              )
            ) : (
              <>
                {share === null ? null : ahead ? (
                  <TrendingUp aria-hidden className="size-7 shrink-0" />
                ) : (
                  <TrendingDown aria-hidden className="size-7 shrink-0" />
                )}
                <span>
                  {formatPace(pace)} for each person each hour
                  {job.targetUph ? `. The target is ${formatPace(job.targetUph)}` : ''}
                </span>
              </>
            )}
          </div>
          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-2xl bg-danger-subtle px-4 py-3 text-lg font-medium text-danger-text"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-6 shrink-0" /> {error}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="kiosk-save"
            className={cn(primary, 'mt-auto min-h-20 text-2xl')}
            disabled={busy}
            onClick={() => void save()}
          >
            <Check aria-hidden className="size-7" /> {busy ? 'Saving' : 'Save'}
          </button>
        </section>
      </div>
    </div>
  );
}

function Done({
  done: saved,
  sent,
  onNext,
  onLock,
}: {
  readonly done: DoneState;
  /** The entry waited on this tablet and has now reached the server. */
  readonly sent: boolean;
  readonly onNext: () => void;
  readonly onLock: () => void;
}) {
  const done = sent ? { ...saved, queued: false } : saved;
  return (
    <div
      data-testid="kiosk-done"
      className="m-auto flex w-full max-w-2xl flex-col items-center gap-6 text-center"
    >
      <span
        aria-hidden
        className={cn(
          'flex size-32 items-center justify-center rounded-full',
          done.queued ? 'bg-warning-subtle text-warning-text' : 'bg-success-subtle text-success-text',
        )}
      >
        {done.queued ? (
          <CloudOff className="size-16" strokeWidth={1.75} />
        ) : (
          <Check className="size-16" strokeWidth={2.25} />
        )}
      </span>
      <h1 className="text-4xl font-semibold tracking-[-0.02em]">
        {done.queued ? 'Saved on this tablet' : done.result?.duplicate ? 'Already saved' : 'Saved'}
      </h1>
      <p className="text-2xl text-fg-secondary">
        {formatNumber(done.units, { maxDigits: 0 })} {done.job.unitLabel} and {formatHours(done.hours)} labor
        hours for {done.job.jobNumber}.
      </p>
      <p className="text-xl text-fg-secondary">
        {done.queued
          ? 'There is no connection right now. It will send when the tablet is online. You can keep logging.'
          : done.result
            ? `Today so far on this job: ${formatNumber(done.result.todayUnits, { maxDigits: 0 })} ${done.job.unitLabel} in ${formatHours(done.result.todayHours)} labor hours${done.result.uph ? `, ${formatPace(done.result.uph)} for each person each hour` : ''}.`
            : sent
              ? 'The tablet is back online and this was sent.'
              : ''}
      </p>
      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <button
          type="button"
          data-testid="kiosk-next"
          className={cn(primary, 'min-h-20 flex-1 text-2xl')}
          onClick={onNext}
          autoFocus
        >
          Next job
        </button>
        <button type="button" className={cn(quiet, 'min-h-20 text-2xl sm:w-48')} onClick={onLock}>
          <Lock aria-hidden className="size-6" /> I am done
        </button>
      </div>
    </div>
  );
}
