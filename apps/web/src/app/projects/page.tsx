import type { Metadata } from 'next';
import { ClosingSection } from '@/components/closing/closing-section';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { PageEffects } from '@/components/page-effects';
import { Chapter, TileGrid } from '@/components/product/chapter';
import { Faq } from '@/components/product/cta';
import { PriceBand } from '@/components/product/price-band';
import { ProductHero } from '@/components/product/product-hero';
import { SubNav } from '@/components/product/sub-nav';
import { ProjectViews } from '@/components/projects/project-views';
import {
  AUTOMATION_FEATURES,
  FAQ,
  HERO_FACTS,
  LINK_DETAILS,
  PLANNING_TILES,
  PRICE_INCLUDED,
  PROJECT_VIEWS,
  SECTIONS,
  STACK_FEATURES,
  TASK_FEATURES,
} from '@/components/projects/projects-content';
import { CrossRecipes, CustomerCard, TemplateGrid } from '@/components/projects/projects-static-visuals';
import { QuickAdd } from '@/components/projects/quick-add';
import { RecipeBrowser } from '@/components/projects/recipe-browser';
import { LINKS, getStartedHref } from '@/components/site-links';
import { PROJECTS_CATALOG } from '@/generated/projects/catalog';

const START = getStartedHref('projects');

export const metadata: Metadata = {
  title: 'KitStak Projects — plans, tasks and timelines on the same stack',
  description: `Tasks, ${PROJECTS_CATALOG.views.length} project views, cycles, ${PROJECTS_CATALOG.automation.recipes.length} automation recipes, and links to the CRM deals and WMS orders the work is about.`,
  alternates: { canonical: '/projects' },
  openGraph: {
    title: 'KitStak Projects',
    description: 'Plans, tasks and timelines tied to the deals and orders they are for.',
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
          lines={['Plan it.', 'Run it.', 'Land it.']}
          lead="Tasks, timelines and workload for the work that sits between a deal and a delivery, on the same stack as your CRM and your warehouse."
          primary={{ href: START, label: 'Start with Projects' }}
          secondary={{ href: LINKS.projects, label: 'Sign in' }}
          visual={<ProjectViews />}
          facts={HERO_FACTS}
        />
        <SubNav current="projects" sections={SECTIONS} cta={{ href: START, label: 'Start with Projects' }} />

        <Chapter
          id="tasks"
          index="01"
          label="Tasks"
          title="Written down in one line."
          lead="Capturing a task should take less time than deciding to. Type it the way you would say it. The quick add box on this page runs the same parser the app does."
          features={TASK_FEATURES}
          visual={<QuickAdd />}
        />

        <Chapter
          id="views"
          index="02"
          label="Views"
          title={`${PROJECT_VIEWS.length} ways to see the same work.`}
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
          id="templates"
          index="04"
          label="Templates"
          title="Start from a plan that already works."
          lead="Each template arrives with its statuses, sections, dated tasks and rules, scheduled from the day you start. Save any project as a template of your own."
          tone="sunken"
        >
          <TemplateGrid />
        </Chapter>

        <Chapter
          id="automations"
          index="05"
          label="Automations"
          title="Work that starts itself."
          lead="Rules read like a sentence, and some of them listen to the other apps. Browse the recipes the app ships with."
          features={AUTOMATION_FEATURES}
          visual={<RecipeBrowser />}
          isFlipped
        />

        <Chapter
          id="stack"
          index="06"
          label="On the stack"
          title="The project knows the customer."
          lead="Most project tools sit apart from the systems the work is about. Projects shares one customer list with the CRM and the WMS, so a task can point at the deal or the order it exists for."
          features={STACK_FEATURES}
          visual={<CustomerCard />}
          tone="brand"
        />

        <Chapter
          id="cross-app"
          index="07"
          label="Cross-app rules"
          title="Something happens in another app. Work appears here."
          lead="Workspace rules watch the CRM and the WMS and open the project or the task before anyone writes it down."
          visual={<CrossRecipes />}
          tone="sunken"
          isFlipped
        >
          <TileGrid tiles={LINK_DETAILS} columns={4} />
        </Chapter>

        <PriceBand product="projects" included={PRICE_INCLUDED} />

        <Faq items={FAQ} title="Before you ask." />
        <ClosingSection
          title="Put the third bar on your stack."
          startHref={START}
          startLabel="Start with Projects"
          note="Runs on its own, or alongside the CRM and the WMS with one sign-in."
        />
      </main>
      <Footer />
    </>
  );
}
