/** Static pools used to generate realistic, fictional CRM demo data. */

export const DEMO_ORG = { name: 'Northwind Robotics', slug: 'northwind-robotics' } as const;
export const DEMO_EMAIL_DOMAIN = 'northwind-robotics.example';

export interface DemoUser {
  readonly key: 'maya' | 'daniel' | 'sofia' | 'liam' | 'hannah' | 'ethan' | 'aisha' | 'lucas';
  readonly name: string;
  readonly title: string;
  readonly role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
  readonly timezone: string;
}

/** The first user is the demo admin (see README.md for credentials). */
export const DEMO_USERS: readonly DemoUser[] = [
  { key: 'maya', name: 'Maya Chen', title: 'VP of Sales', role: 'owner', timezone: 'America/Los_Angeles' },
  {
    key: 'daniel',
    name: 'Daniel Okafor',
    title: 'Enterprise Account Executive',
    role: 'admin',
    timezone: 'America/New_York',
  },
  {
    key: 'sofia',
    name: 'Sofia Ramirez',
    title: 'Mid-Market Account Executive',
    role: 'member',
    timezone: 'America/Chicago',
  },
  {
    key: 'liam',
    name: 'Liam Patel',
    title: 'Sales Development Rep',
    role: 'member',
    timezone: 'America/Denver',
  },
  {
    key: 'hannah',
    name: 'Hannah Müller',
    title: 'Customer Success Manager',
    role: 'member',
    timezone: 'Europe/Berlin',
  },
  {
    key: 'ethan',
    name: 'Ethan Brooks',
    title: 'Solutions Engineer',
    role: 'member',
    timezone: 'America/Los_Angeles',
  },
  {
    key: 'aisha',
    name: 'Aisha Rahman',
    title: 'Revenue Operations Analyst',
    role: 'viewer',
    timezone: 'Europe/London',
  },
  {
    key: 'lucas',
    name: 'Lucas Silva',
    title: 'Channel Partner (Guest)',
    role: 'guest',
    timezone: 'America/Sao_Paulo',
  },
];

export const DEMO_TEAMS: ReadonlyArray<{
  readonly name: string;
  readonly members: readonly DemoUser['key'][];
}> = [
  { name: 'Enterprise Sales', members: ['maya', 'daniel', 'ethan'] },
  { name: 'Mid-Market Sales', members: ['sofia', 'liam'] },
  { name: 'Customer Success', members: ['hannah'] },
  { name: 'Revenue Operations', members: ['aisha', 'maya'] },
];

export const COMPANY_PREFIXES = [
  'Apex',
  'Bluestone',
  'Cobalt',
  'Driftwood',
  'Evergreen',
  'Fairmont',
  'Granite',
  'Harbor',
  'Ironclad',
  'Juniper',
  'Keystone',
  'Lakeshore',
  'Meridian',
  'Northgate',
  'Oakridge',
  'Pinnacle',
  'Quarry',
  'Redwood',
  'Summit',
  'Tidewater',
  'Union',
  'Vanguard',
  'Westbrook',
  'Yellowtail',
  'Zenith',
  'Atlas',
  'Beacon',
  'Cascade',
  'Delta',
  'Elm Street',
  'Frontier',
  'Golden Gate',
  'Highline',
  'Ironwood',
  'Kestrel',
  'Lumen',
  'Mariner',
  'Nimbus',
  'Orion',
  'Prairie',
];

export const COMPANY_SUFFIXES = [
  'Logistics',
  'Manufacturing',
  'Freight',
  'Health Systems',
  'Motors',
  'Aerospace',
  'Foods',
  'Energy',
  'Pharma',
  'Electronics',
  'Distribution',
  'Retail Group',
  'Industries',
  'Fulfillment',
  'Components',
  'Labs',
];

/** Account industry dropdown label by company suffix. */
export const SUFFIX_INDUSTRY: Readonly<Record<string, string>> = {
  Logistics: 'logistics',
  Manufacturing: 'manufacturing',
  Freight: 'logistics',
  'Health Systems': 'healthcare',
  Motors: 'automotive',
  Aerospace: 'aerospace',
  Foods: 'food',
  Energy: 'energy',
  Pharma: 'pharma',
  Electronics: 'electronics',
  Distribution: 'logistics',
  'Retail Group': 'retail',
  Industries: 'manufacturing',
  Fulfillment: 'retail',
  Components: 'electronics',
  Labs: 'pharma',
};

export const FIRST_NAMES = [
  'Olivia',
  'Noah',
  'Emma',
  'James',
  'Ava',
  'William',
  'Isabella',
  'Benjamin',
  'Mia',
  'Lucas',
  'Charlotte',
  'Henry',
  'Amelia',
  'Alexander',
  'Harper',
  'Michael',
  'Evelyn',
  'Daniel',
  'Abigail',
  'Matthew',
  'Emily',
  'Samuel',
  'Elena',
  'David',
  'Priya',
  'Arjun',
  'Mei',
  'Kenji',
  'Fatima',
  'Omar',
  'Zara',
  'Mateo',
  'Lucia',
  'Diego',
  'Ingrid',
  'Lars',
  'Chloe',
  'Ryan',
  'Grace',
  'Nathan',
  'Sara',
  'Tomás',
  'Aaliyah',
  'Jamal',
  'Nora',
  'Felix',
  'Hana',
  'Yusuf',
];

export const LAST_NAMES = [
  'Anderson',
  'Bennett',
  'Carter',
  'Diaz',
  'Edwards',
  'Fischer',
  'Garcia',
  'Hughes',
  'Ito',
  'Johnson',
  'Kim',
  'Lopez',
  'Martin',
  'Nguyen',
  'Olsen',
  'Park',
  'Quinn',
  'Rossi',
  'Schmidt',
  'Tanaka',
  'Usman',
  'Vasquez',
  'Walker',
  'Xu',
  'Young',
  'Zhang',
  'Brennan',
  'Costa',
  'Dubois',
  'Eriksen',
  'Ferreira',
  'Gupta',
  'Haddad',
  'Ivanova',
  'Jensen',
  'Kowalski',
  'Lindqvist',
  'Moreau',
  'Novak',
  'Okonkwo',
  'Petrov',
  'Reyes',
  'Sato',
  'Thompson',
  'Varga',
  'Weber',
];

export const JOB_TITLES = {
  decision: [
    'VP of Operations',
    'COO',
    'Director of Supply Chain',
    'Head of Automation',
    'Plant Manager',
    'CFO',
  ],
  champion: ['Operations Manager', 'Automation Engineer', 'Warehouse Manager', 'Continuous Improvement Lead'],
  other: ['Procurement Specialist', 'IT Manager', 'Facilities Coordinator', 'Safety Officer', 'Controller'],
};

export const LEAD_TITLES = [
  'Operations Manager',
  'Director of Logistics',
  'VP of Manufacturing',
  'Warehouse Supervisor',
  'Head of Robotics',
  'Supply Chain Analyst',
  'Plant Engineer',
  'Procurement Lead',
  'CTO',
  'Fulfillment Manager',
];

export const COUNTRIES_BY_REGION: Readonly<Record<'na' | 'emea' | 'apac' | 'latam', readonly string[]>> = {
  na: ['US', 'US', 'US', 'CA'],
  emea: ['DE', 'GB', 'FR', 'NL', 'SE'],
  apac: ['JP', 'SG', 'AU', 'KR'],
  latam: ['BR', 'MX', 'CL'],
};

export const CITIES_BY_COUNTRY: Readonly<Record<string, readonly string[]>> = {
  US: [
    'Chicago, IL',
    'Austin, TX',
    'Seattle, WA',
    'Atlanta, GA',
    'Columbus, OH',
    'Reno, NV',
    'Charlotte, NC',
  ],
  CA: ['Toronto, ON', 'Vancouver, BC'],
  DE: ['Munich', 'Hamburg', 'Stuttgart'],
  GB: ['Manchester', 'Birmingham'],
  FR: ['Lyon', 'Toulouse'],
  NL: ['Rotterdam', 'Eindhoven'],
  SE: ['Gothenburg'],
  JP: ['Nagoya', 'Osaka'],
  SG: ['Singapore'],
  AU: ['Melbourne', 'Brisbane'],
  KR: ['Incheon'],
  BR: ['São Paulo', 'Curitiba'],
  MX: ['Monterrey', 'Querétaro'],
  CL: ['Santiago'],
};

export const PHONE_PREFIX: Readonly<Record<string, string>> = {
  US: '+1',
  CA: '+1',
  DE: '+49',
  GB: '+44',
  FR: '+33',
  NL: '+31',
  SE: '+46',
  JP: '+81',
  SG: '+65',
  AU: '+61',
  KR: '+82',
  BR: '+55',
  MX: '+52',
  CL: '+56',
};

export const PRODUCTS = [
  'AMR fleet',
  'Palletizing cells',
  'Pick-assist robots',
  'Autonomous forklifts',
  'Fleet orchestration software',
  'Cobot welding line',
  'Inspection drones',
  'Sortation robots',
  'Robot-as-a-Service plan',
  'Predictive maintenance add-on',
];

export const DEAL_PATTERNS = [
  '{company} — {product}',
  '{company} {product} expansion',
  '{company}: {product} pilot',
  '{company} DC{n} automation',
  '{company} — {product} renewal',
];

export const NEXT_STEPS = [
  'Send revised pricing',
  'Schedule site survey',
  'Security review with IT',
  'Exec sponsor alignment call',
  'Share ROI model',
  'Legal redlines on MSA',
  'Demo for night-shift supervisors',
  'Confirm budget for FY27',
  'Pilot success criteria sign-off',
  'Procurement onboarding',
];

export const ACTIVITY_SUBJECTS: Readonly<Record<string, readonly string[]>> = {
  call: ['Discovery call', 'Pricing follow-up call', 'Check-in call', 'Champion prep call', 'Reference call'],
  meeting: ['On-site walkthrough', 'Executive briefing', 'Quarterly business review', 'Procurement meeting'],
  email: [
    'Sent proposal',
    'Shared case study',
    'Follow-up on security questionnaire',
    'Intro to solutions engineer',
  ],
  demo: ['Fleet orchestration demo', 'Live AMR demo', 'Integration deep dive', 'Safety features demo'],
  task: ['Prepare ROI model', 'Update mutual action plan', 'Draft SOW', 'Collect site measurements'],
};

export const ONBOARDING_TASKS = [
  'Kickoff call',
  'Site survey & mapping',
  'Fleet configuration',
  'WMS integration',
  'Operator training',
  'Safety certification',
  'Go-live review',
];

export const UPDATE_TEXTS = [
  'Had a great call with their ops team today. They want to see throughput numbers from a similar site before moving forward.',
  'Procurement asked for a 3-year pricing option. Drafting it now — will share by Friday.',
  'Security questionnaire is done and sent back. Waiting on their IT review.',
  'Champion confirmed budget is approved for Q1. Next step is legal review of the MSA.',
  'Site survey scheduled for next Tuesday. Ethan will join to scope the WMS integration.',
  'They are comparing us with two other vendors. Our differentiation: fleet orchestration + uptime SLA.',
  'Pilot results look strong: 31% fewer touches per order on the night shift.',
  'Exec sponsor is changing roles next month — we need to multi-thread this account.',
  'Sent over the ROI model. Payback period comes out at 14 months with current volumes.',
  'Contract redlines received. Mostly liability caps; looping in legal.',
  'Customer asked about adding two more DCs to the rollout. Big expansion potential here.',
  'Training for operators is booked for both shifts. Hannah owns the follow-up survey.',
];

export const REPLY_TEXTS = [
  'Nice work — let me know if you need help with the exec alignment.',
  'Agreed. I can join the call on Thursday.',
  'I added the case study from the Rotterdam deployment to the shared folder.',
  'Let us make sure the mutual action plan reflects the new timeline.',
  'Great progress! Keep me posted.',
  'I talked to their CFO last year — happy to make an intro.',
];

export const REACTIONS = ['👍', '🎉', '🔥', '👀', '🙌', '✅'];
