// One place for farm-wide details. Change these and the whole site updates.
export const site = {
  name: "Thistledown Farm", 
	tagline: "Welcome to Thistledown Farm",
  description:
    "Farming on the edge of nature. A patch of rugged hillside in the Catskills mountains. We believe that the best food is A small, diversified family farm in Bloomville, NY. We raise animals on pasture and cook them into good food — and we're opening the farm up for workshops, gatherings and farm stays.",
  location: "Delaware County, NY",
	address: "624 Brownell Road, Bloomville, NY 13739",
  email: "hello@thistledownfarm.org", 
  instagram: "https://instagram.com/thistledownfarm_ny", // e.g. "https://instagram.com/yourfarm"
  certifications: [],
};

// The three parts of the business. Used for the home page cards and the Farm / Gather / Stay pages.
// status: "now" for things running today, "soon" for things we're still planning.
export const pillars = [
  {
    key: "food",
    label: "Our Food",
    href: "/food",
    status: "now",
    kicker: "Eat what you raise",
    summary:
      "Pasture-raised lamb, pork, chicken, duck and eggs, plus pot pies, broth and quiche from our farm kitchen. Find us at markets in Queens and Brooklyn, or pick up at the farm.",
    cta: "Real food raised ruggedly",
  },
  {
    key: "events",
    label: "Events",
    href: "/events",
    status: "soon",
    kicker: "Learn & celebrate",
    summary:
      "Workshops, farm dinners and hands-on days that bring people onto the land to see how food is raised, cooked and shared.",
    cta: "What we're planning",
  },
  {
    key: "stay",
    label: "Stay",
    href: "/stay",
    status: "soon",
    kicker: "Farm stays",
    summary:
      "A place to slow down on a working farm in the western Catskills — open hillsides, the rhythm of the animals, and food from the farm.",
    cta: "About the stays",
  },
] as const;

// Header navigation. Add a Markdown file in src/content/pages/ and list it here.
// `match` marks the item as current on related pages too.
export const nav: { label: string; href: string; match?: string[] }[] = [
  { label: "Food", href: "/food", match: ["/products", "/markets"] },
  { label: "Events", href: "/gather" },
  { label: "Farm Stays", href: "/stay" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];
