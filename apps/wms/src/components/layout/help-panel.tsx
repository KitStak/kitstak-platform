'use client';

/**
 * Help panel (Logiwa "Help Center" parity, plus more): a side drawer with a searchable hero,
 * "For this page" articles picked from the current route, 8 article collections, Release notes,
 * Keyboard shortcuts, Feedback & Updates (stored and sent to admins), a screen recorder that
 * keeps the video on this device, Contact support and the Privacy policy.
 */
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Circle,
  CircleStop,
  Download,
  FileText,
  Keyboard,
  LifeBuoy,
  MessageSquarePlus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Video,
} from 'lucide-react';
import { apiRequest, isApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  feedbackPage,
  feedbackSchema,
  type FeedbackType,
} from '@/lib/grid-defs/admin/account';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Drawer } from '@/components/ui/drawer';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import {
  articlesForPath,
  HELP_CATEGORIES,
  searchHelp,
  WHATS_NEW,
  type HelpArticle,
  type HelpCategory,
} from './help-content';
import { SupportContact } from './support-contact';

export type HelpView =
  | { readonly kind: 'home' }
  | { readonly kind: 'category'; readonly key: string }
  | { readonly kind: 'article'; readonly id: string }
  | { readonly kind: 'whats-new' }
  | { readonly kind: 'feedback' }
  | { readonly kind: 'record' }
  | { readonly kind: 'support' };

const CATEGORY_ICON: Readonly<Record<string, React.ComponentType<{ className?: string }>>> = {
  'process-manuals': BookOpen,
  reports: FileText,
  integrations: Sparkles,
  'workflow-rules': ChevronRight,
  'client-management': LifeBuoy,
  setup: Keyboard,
  'release-notes': Sparkles,
  'account-management': ShieldCheck,
};

function findArticle(id: string): { article: HelpArticle; category: HelpCategory } | null {
  for (const category of HELP_CATEGORIES) {
    const article = category.articles.find((a) => a.id === id);
    if (article) return { article, category };
  }
  return null;
}

const rowClass =
  'flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40';

function ArticleRow({
  article,
  onOpen,
}: {
  readonly article: HelpArticle;
  readonly onOpen: (id: string) => void;
}) {
  return (
    <button type="button" className={rowClass} onClick={() => onOpen(article.id)}>
      <FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{article.title}</span>
        <span className="block truncate text-xs text-secondary">{article.summary}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-faint" aria-hidden />
    </button>
  );
}

function SectionTitle({ children }: { readonly children: React.ReactNode }) {
  return <h3 className="mb-2 text-2xs font-bold text-faint">{children}</h3>;
}

function Home({ go, onShortcuts }: { readonly go: (v: HelpView) => void; readonly onShortcuts: () => void }) {
  const pathname = usePathname() ?? '/';
  const [query, setQuery] = React.useState('');
  const results = searchHelp(query);
  const forPage = articlesForPath(pathname);
  const openArticle = (id: string) => go({ kind: 'article', id });
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-border-subtle bg-sunken px-4 py-5 text-fg">
        <p className="text-lg font-semibold">Help Center</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          Guides, release notes and support for every KitStak screen.
        </p>
        <label className="relative mt-3 flex items-center">
          <span className="sr-only">Search help articles</span>
          <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help, e.g. receive, wave, label"
            data-autofocus
            className="h-9 w-full rounded-md border border-border-input bg-surface pl-8 pr-2 text-sm text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </label>
      </section>
      {query.trim() ? (
        <section aria-live="polite">
          <SectionTitle>
            {results.length} {results.length === 1 ? 'article' : 'articles'} for &ldquo;{query.trim()}&rdquo;
          </SectionTitle>
          {results.length ? (
            <div className="flex flex-col gap-2">
              {results.map((a) => (
                <ArticleRow key={a.id} article={a} onOpen={openArticle} />
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-secondary">
              No article matches. Try another word, or{' '}
              <button
                type="button"
                className="font-semibold text-primary hover:underline"
                onClick={() => go({ kind: 'support' })}
              >
                contact support
              </button>
              .
            </p>
          )}
        </section>
      ) : (
        <>
          {forPage.length ? (
            <section>
              <SectionTitle>For this page</SectionTitle>
              <div className="flex flex-col gap-2">
                {forPage.map((a) => (
                  <ArticleRow key={a.id} article={a} onOpen={openArticle} />
                ))}
              </div>
            </section>
          ) : null}
          <section>
            <SectionTitle>Collections</SectionTitle>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {HELP_CATEGORIES.map((c) => {
                const Icon = CATEGORY_ICON[c.key] ?? BookOpen;
                const count = c.key === 'release-notes' ? WHATS_NEW.length : c.articles.length;
                return (
                  <button
                    key={c.key}
                    type="button"
                    className={cn(rowClass, 'items-start')}
                    onClick={() =>
                      go(c.key === 'release-notes' ? { kind: 'whats-new' } : { kind: 'category', key: c.key })
                    }
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        {c.title}
                        <span className="text-2xs font-normal text-faint">{count}</span>
                      </span>
                      <span className="mt-0.5 block text-2xs leading-4 text-secondary">{c.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}
      <section>
        <SectionTitle>Quick actions</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" className="justify-start" onClick={() => go({ kind: 'feedback' })}>
            <MessageSquarePlus className="h-4 w-4" aria-hidden />
            Feedback &amp; updates
          </Button>
          <Button variant="secondary" className="justify-start" onClick={() => go({ kind: 'record' })}>
            <Video className="h-4 w-4" aria-hidden />
            Record screen
          </Button>
          <Button variant="secondary" className="justify-start" onClick={onShortcuts}>
            <Keyboard className="h-4 w-4" aria-hidden />
            Keyboard shortcuts
          </Button>
          <Button variant="secondary" className="justify-start" onClick={() => go({ kind: 'support' })}>
            <LifeBuoy className="h-4 w-4" aria-hidden />
            Contact support
          </Button>
        </div>
      </section>
      <footer className="flex items-center gap-3 border-t border-border pt-3 text-xs text-faint">
        <button
          type="button"
          className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
          onClick={() => go({ kind: 'article', id: 'privacy' })}
        >
          Privacy Policy
        </button>
        <span aria-hidden>·</span>
        <span>{WHATS_NEW[0] ? `KitStak ${WHATS_NEW[0].version}` : 'KitStak'}</span>
      </footer>
    </div>
  );
}

function CategoryView({
  categoryKey,
  go,
}: {
  readonly categoryKey: string;
  readonly go: (v: HelpView) => void;
}) {
  const category = HELP_CATEGORIES.find((c) => c.key === categoryKey);
  if (!category) return <p className="text-sm text-secondary">This collection no longer exists.</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-secondary">{category.description}</p>
      {category.articles.map((a) => (
        <ArticleRow key={a.id} article={a} onOpen={(id) => go({ kind: 'article', id })} />
      ))}
    </div>
  );
}

function ArticleView({ id, onNavigate }: { readonly id: string; readonly onNavigate: () => void }) {
  const found = findArticle(id);
  if (!found) return <p className="text-sm text-secondary">This article no longer exists.</p>;
  const { article, category } = found;
  return (
    <article className="flex flex-col gap-3">
      <Badge tone="neutral" size="sm" className="self-start">
        {category.title}
      </Badge>
      <p className="text-sm text-secondary">{article.summary}</p>
      <ol className="flex flex-col gap-2">
        {article.steps.map((step, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-5 text-body">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-soft text-2xs font-semibold text-primary">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {article.links?.length ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {article.links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onNavigate}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border-strong/70 bg-surface px-2.5 text-xs font-medium text-primary hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
            >
              {l.label}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function WhatsNewList({ limit }: { readonly limit?: number }) {
  return (
    <ol className="space-y-3">
      {WHATS_NEW.slice(0, limit).map((entry) => (
        <li key={entry.title} className="border-l-2 border-primary pl-3">
          <p className="flex items-center gap-1.5 text-2xs text-faint">
            <time>{entry.date}</time>
            <span aria-hidden>·</span>
            <span>{entry.version}</span>
            <span className="rounded bg-primary-soft px-1.5 py-px font-semibold text-primary">
              {entry.tag}
            </span>
          </p>
          <p className="text-sm font-semibold text-foreground">{entry.title}</p>
          <p className="text-xs text-secondary">{entry.body}</p>
        </li>
      ))}
    </ol>
  );
}

function FeedbackView({ onDone }: { readonly onDone: () => void }) {
  const pathname = usePathname() ?? '/';
  const [type, setType] = React.useState<FeedbackType>('idea');
  const [message, setMessage] = React.useState('');
  const [rating, setRating] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const page = feedbackPage(pathname);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = feedbackSchema.safeParse({ type, message, page, rating });
    if (!parsed.success) {
      setError(
        parsed.error.issues.find((i) => i.path[0] === 'message')?.message ??
          parsed.error.issues[0]?.message ??
          'Check the form',
      );
      return;
    }
    setError(null);
    setSending(true);
    try {
      await apiRequest('/api/account/feedback', { method: 'POST', body: parsed.data });
      toast.success('Thanks for the feedback', 'Your administrators and the KitStak team can see it now.');
      setMessage('');
      setRating(null);
      onDone();
    } catch (err) {
      toast.error(
        "Couldn't send feedback",
        isApiError(err) && err.code === 'RATE_LIMITED'
          ? "You've sent a lot of feedback this hour. Try again later."
          : 'Check your connection and try again.',
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-body" id="fb-type">
            What is it about?
          </span>
          <SegmentedControl
            ariaLabel="Feedback type"
            value={type}
            onChange={setType}
            options={FEEDBACK_TYPES.map((t) => ({ value: t, label: FEEDBACK_TYPE_LABELS[t] }))}
            size="sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fb-message" className="text-xs font-medium text-body">
            Your feedback{' '}
            <span className="text-danger" aria-hidden>
              *
            </span>
          </label>
          <Textarea
            id="fb-message"
            rows={5}
            maxLength={2000}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              if (error) setError(null);
            }}
            invalid={Boolean(error)}
            aria-describedby={error ? 'fb-error' : undefined}
            placeholder={
              type === 'problem'
                ? 'What did you do, what happened and what did you expect?'
                : 'Tell us what would make KitStak better for you.'
            }
          />
          {error ? (
            <p id="fb-error" role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-body">
            How is KitStak working for you? <span className="font-normal text-faint">(optional)</span>
          </span>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} of 5`}
                onClick={() => setRating(rating === n ? null : n)}
                className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
              >
                <Star
                  className={cn(
                    'h-5 w-5',
                    rating !== null && n <= rating ? 'fill-warning text-warning' : 'text-faint',
                  )}
                  aria-hidden
                />
              </button>
            ))}
          </div>
        </div>
        <p className="text-2xs text-faint">
          Sent with the page you are on ({page}), your name and the time. No record data is attached.
        </p>
        <Button type="submit" variant="primary" className="self-start" disabled={sending} aria-busy={sending}>
          {sending ? 'Sending…' : 'Send feedback'}
        </Button>
      </form>
      <section>
        <SectionTitle>Latest updates</SectionTitle>
        <WhatsNewList limit={4} />
      </section>
    </div>
  );
}

/** Formats a recording length as m:ss. PURE. */
export function recordingClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const MAX_RECORDING_SECONDS = 300;

function RecorderView({ onSupport }: { readonly onSupport: () => void }) {
  const [state, setState] = React.useState<'idle' | 'recording' | 'done'>('idle');
  const [seconds, setSeconds] = React.useState(0);
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const recorder = React.useRef<MediaRecorder | null>(null);
  const stream = React.useRef<MediaStream | null>(null);
  const chunks = React.useRef<Blob[]>([]);
  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getDisplayMedia) &&
    typeof MediaRecorder !== 'undefined';

  const stopTracks = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  React.useEffect(
    () => () => {
      stopTracks();
    },
    [],
  );
  React.useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  React.useEffect(() => {
    if (state !== 'recording') return undefined;
    const timer = window.setInterval(
      () =>
        setSeconds((s) => {
          if (s + 1 >= MAX_RECORDING_SECONDS) recorder.current?.stop();
          return s + 1;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [state]);

  const start = async () => {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      stream.current = media;
      chunks.current = [];
      const type =
        ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
          MediaRecorder.isTypeSupported(t),
        ) ?? '';
      const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stopTracks();
        const blob = new Blob(chunks.current, { type: 'video/webm' });
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setState('done');
      };
      // The browser's own "Stop sharing" button ends the recording too.
      media.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (rec.state !== 'inactive') rec.stop();
      });
      recorder.current = rec;
      rec.start(1000);
      setSeconds(0);
      setState('recording');
    } catch (err) {
      stopTracks();
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Screen sharing was cancelled or blocked. Choose a tab, window or screen to record.'
          : "This browser couldn't start a screen recording.",
      );
    }
  };
  const stop = () => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  };
  const fileName = `kitstak-recording-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.webm`;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-secondary">
        Record what you see to show support exactly what happened. The video stays on this device; nothing is
        uploaded. Recordings stop after {MAX_RECORDING_SECONDS / 60} minutes.
      </p>
      {!supported ? (
        <Callout variant="info" title="Screen recording isn't available">
          Use a current version of Chrome, Edge or Firefox on a computer to record your screen.
        </Callout>
      ) : null}
      {error ? (
        <Callout variant="attention" title="Recording didn't start">
          {error}
        </Callout>
      ) : null}
      {state === 'recording' ? (
        <div
          className="flex items-center gap-3 rounded-lg border border-danger/40 bg-danger-soft/40 px-3 py-2.5"
          role="status"
          aria-live="polite"
        >
          <Circle className="h-3 w-3 animate-pulse fill-danger text-danger" aria-hidden />
          <span className="text-sm font-semibold text-foreground">Recording</span>
          <span className="tabular-nums text-sm text-secondary">{recordingClock(seconds)}</span>
          <Button size="sm" variant="primary" className="ml-auto" onClick={stop}>
            <CircleStop className="h-3.5 w-3.5" aria-hidden />
            Stop
          </Button>
        </div>
      ) : (
        <Button variant="primary" className="self-start" disabled={!supported} onClick={() => void start()}>
          <Video className="h-4 w-4" aria-hidden />
          {state === 'done' ? 'Record again' : 'Start recording'}
        </Button>
      )}
      {state === 'done' && url ? (
        <div className="flex flex-col gap-2">
          <video
            src={url}
            controls
            className="w-full rounded-lg border border-border bg-black"
            aria-label="Recording preview"
          />
          <div className="flex flex-wrap gap-2">
            <a
              href={url}
              download={fileName}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
            >
              <Download className="h-4 w-4" aria-hidden />
              Download video
            </a>
            <Button variant="secondary" onClick={onSupport}>
              <LifeBuoy className="h-4 w-4" aria-hidden />
              Send to support
            </Button>
          </div>
          <p className="text-2xs text-faint">
            {recordingClock(seconds)} recorded. Attach the downloaded file to your email to support.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const TITLES: Readonly<Record<HelpView['kind'], string>> = {
  home: 'Help Center',
  category: 'Help Center',
  article: 'Help Center',
  'whats-new': 'Release Notes',
  feedback: 'Feedback & Updates',
  record: 'Record screen',
  support: 'Contact support',
};

export function viewTitle(view: HelpView): string {
  if (view.kind === 'category')
    return HELP_CATEGORIES.find((c) => c.key === view.key)?.title ?? TITLES.category;
  if (view.kind === 'article') return findArticle(view.id)?.article.title ?? TITLES.article;
  return TITLES[view.kind];
}

export function HelpPanel({
  view,
  onViewChange,
  onClose,
  onShortcuts,
}: {
  readonly view: HelpView | null;
  readonly onViewChange: (v: HelpView) => void;
  readonly onClose: () => void;
  readonly onShortcuts: () => void;
}) {
  const [history, setHistory] = React.useState<readonly HelpView[]>([]);
  React.useEffect(() => {
    if (view === null) setHistory([]);
  }, [view]);
  const go = (next: HelpView) => {
    if (view) setHistory((h) => [...h, view]);
    onViewChange(next);
  };
  const back = () => {
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    onViewChange(prev ?? { kind: 'home' });
  };
  const current = view ?? { kind: 'home' as const };
  return (
    <Drawer
      open={view !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      width={35}
      title={viewTitle(current)}
      headerExtra={
        current.kind !== 'home' ? (
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back
          </button>
        ) : undefined
      }
    >
      {current.kind === 'home' ? <Home go={go} onShortcuts={onShortcuts} /> : null}
      {current.kind === 'category' ? <CategoryView categoryKey={current.key} go={go} /> : null}
      {current.kind === 'article' ? <ArticleView id={current.id} onNavigate={onClose} /> : null}
      {current.kind === 'whats-new' ? <WhatsNewList /> : null}
      {current.kind === 'feedback' ? <FeedbackView onDone={() => onViewChange({ kind: 'home' })} /> : null}
      {current.kind === 'record' ? <RecorderView onSupport={() => go({ kind: 'support' })} /> : null}
      {current.kind === 'support' ? <SupportContact /> : null}
    </Drawer>
  );
}
