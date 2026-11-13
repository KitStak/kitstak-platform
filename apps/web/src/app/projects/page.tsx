import type { Metadata } from 'next';
import Link from 'next/link';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { PageEffects } from '@/components/page-effects';
import { Chapter, TileGrid } from '@/components/product/chapter';
import { Faq } from '@/components/product/cta';
import { ProductHero } from '@/components/product/product-hero';
import { SubNav } from '@/components/product/sub-nav';
import { ProjectViews } from '@/components/projects/project-views';
import {
  AUTOMATION_FEATURES,
  FAQ,
  HERO_FACTS,
  PLANNING_TILES,
  PROJECT_VIEWS,
  SECTIONS,
  STACK_FEATURES,
  TASK_FEATURES,
} from '@/components/projects/projects-content';
import { CrossRecipes, CustomerCard } from '@/components/projects/projects-static-visuals';
import { QuickAdd } from '@/components/projects/quick-add';
import { ROUTES } from '@/components/site-links';
import styles from './projects.module.css';

export const metadata: Metadata = {
  title: 'KitStak Projects (preview) — plans, tasks and timelines on the same stack',
  description:
    'A preview of KitStak Projects, in development: tasks, six project views, cycles, automations, and links to the deals and warehouse records the work is about.',
  alternates: { canonical: '/projects' },
  openGraph: {
    title: 'KitStak Projects (preview)',
    description: 'Plans, tasks and timelines on the same stack. In development.',
    url: 'https://kitstak.com/projects',
    siteName: 'KitStak',
    type: 'website',
  },
};

export default function ProjectsPage() {
  return (
    <>
      <PageEffects />
      <Header />
      <main id="main">
        <ProductHero
          product="KitStak Projects"
          app="projects"
          badge="Preview"
          lines={['Plan it.', 'Run it.', 'Land it.']}
          lead="KitStak Projects is the next app on the stack: tasks, timelines and workload for the work that sits between a deal and a delivery. It is in development, and this page shows what it does so far."
          primary={{ href: ROUTES.projectsAccess, label: 'Ask for early access' }}
          secondary={{ href: ROUTES.products, label: 'See what runs today' }}
          visual={<ProjectViews />}
          facts={HERO_FACTS}
        />
        <SubNav current="projects" sections={SECTIONS} cta={{ href: ROUTES.projectsAccess, label: 'Ask for early access' }} />

        <div className={`container ${styles.notice}`} role="note">
          <strong>In development.</strong> Projects is not available yet, and details may change before release. The{' '}
          <Link href={ROUTES.wms}>WMS</Link> and the <Link href={ROUTES.crm}>CRM</Link> are available now.
        </div>

        <Chapter
          id="tasks"
          index="01"
          label="Tasks"
          title="Written down in one line."
          lead="Capturing a task should take less time than deciding to. Type it the way you would say it and the details sort themselves out."
          features={TASK_FEATURES}
          visual={<QuickAdd />}
        />

        <Chapter
          id="views"
          index="02"
          label="Views"
          title="Six ways to see the same work."
          lead="The planner wants a timeline, the team wants a board, and the manager wants to know who is overloaded. They are all looking at the same tasks, and every view can be saved."
          tone="sunken"
        >
          <TileGrid tiles={PROJECT_VIEWS} />
        </Chapter>

        <Chapter
          id="planning"
          index="03"
          label="Planning"
          title="A plan that survives the week."
          lead="Structure for the work that has a deadline, a queue for the work that just shows up, and a way to tell which is winning."
        >
          <TileGrid tiles={PLANNING_TILES} />
        </Chapter>

        <Chapter
          id="automations"
          index="04"
          label="Automations"
          title="Work that starts itself."
          lead="Rules read like a sentence, and some of them listen to the other apps. A won deal can open the onboarding project. A receiving problem can become a task before anyone writes it down."
          features={AUTOMATION_FEATURES}
          visual={<CrossRecipes />}
          tone="sunken"
          isFlipped
        />

        <Chapter
          id="stack"
          index="05"
          label="On the stack"
          title="The project knows the customer."
          lead="Most project tools sit apart from the systems the work is about. Projects shares one customer list with the CRM and the WMS, so a task can point at the deal or the order it exists for."
          features={STACK_FEATURES}
          visual={<CustomerCard />}
          tone="brand"
        />

        <Faq items={FAQ} title="Before you ask." />
        <ClosingSection
          title="Be first on the third bar."
          startHref={ROUTES.projectsAccess}
          startLabel="Ask for early access"
          note="Projects is in development. The CRM and the WMS are available now."
        />
      </main>
      <Footer />
    </>
  );
}
