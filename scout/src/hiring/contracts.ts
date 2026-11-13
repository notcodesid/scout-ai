import { companyKey } from "../radar/contracts.ts";

export const HIRING_LIMITS = {
  siteResults: 5, careerResults: 6, postResults: 8, excerptCharacters: 600,
  /** Posts are read long enough to reach the "## Engagement" block Exa appends after the comments. */
  postCharacters: 8000, careersCharacters: 6000,
  jobsKept: 25, postsKept: 8, listingsKept: 5, boardsKept: 8, rolesKept: 15,
};

/** A search hit as retrieved. `text` is untrusted evidence, never instructions. */
export type Page = { url: string; title: string; publishedDate: string | null; text: string; links: string[]; author?: string | null };

/** What the radar knows about a company. Everything but the name is optional. */
export type Target = {
  company: string;
  whatItDoes?: string | null;
  city?: string | null;
  website?: string | null;
  founders?: string[] | null;
  sector?: string | null;
};

export type Job = { title: string; location: string | null; url: string; updatedAt: string | null };
export type Board = { provider: "greenhouse" | "lever" | "ashby"; slug: string; total: number; jobs: Job[]; guessed: boolean };
export type BoardProvider = "keka" | "zoho-recruit" | "freshteam" | "darwinbox" | "workable" | "wellfound" | "instahyre" | "cutshort" | "linkedin-jobs" | "naukri" | "yc";
/** A link to the company's page on a job board. `site`: linked from the company's own pages. `search`: a search hit that names the company. */
export type BoardLink = { provider: BoardProvider; url: string; source: "site" | "search" };
export type Post = {
  url: string;
  title: string;
  author: string | null;
  publishedDate: string | null;
  excerpt: string;
  /** The poster's headline or the post's opening says founder / CEO / CTO. A hint, not proof. */
  founderLikely: boolean;
  /** The poster's name matches a founder the radar extracted from the funding news. */
  byFounder: boolean;
  /** Published within the freshness window at the time of the check. */
  fresh: boolean;
  /** The role the post says is open, when it states one. */
  role: string | null;
  /** Hiring is the point of the post (title or opening), not a passing "P.S. we're hiring". */
  primary: boolean;
  /** Counts as printed in the retrieved post text. Null when the text did not carry them. */
  reactions: number | null;
  comments: number | null;
  /** True under 100 reactions, false at 100 or more, null when the count is unknown. */
  under100Likes: boolean | null;
  /** For short or common-word company names: what ties this post to this company. */
  corroboratedBy: string | null;
};
export type Listing = { url: string; title: string };
export type Dropped = { url: string; title: string; reason: string };

export type HiringCheck = {
  key: string;
  company: string;
  website: string | null;
  careersUrl: string | null;
  board: Board | null;
  /** Job boards Indian startups use (Keka, Zoho Recruit, Wellfound, ...): the link only, roles are not read. */
  boards: BoardLink[];
  /** Role titles visible on the company's own careers page (`careersUrl` is the evidence). */
  roles: string[];
  posts: Post[];
  /** Third-party job pages (job sites, aggregators) that name the company. */
  listings: Listing[];
  /** Posts the search returned that were not counted, each with the reason. */
  dropped: Dropped[];
  failures: string[];
  freshDays: number;
  checkedAt: string;
};

const GENERIC = /(?:[\s.]+(?:ai|labs?|technologies|tech|capital|pvt|private|ltd|limited|inc|com))+$/i;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const coreName = (company: string) => company.trim().replace(GENERIC, "").trim() || company.trim();
const coreKey = (company: string) => companyKey(coreName(company)) || companyKey(company);

/** "Karta AI" → /\bkarta\b/i, so "hiring at Karta" still counts as naming the company. */
export function nameRegex(company: string) {
  return new RegExp(`(?<![a-z0-9])${escape(coreName(company)).replace(/\s+/g, "\\s+")}(?![a-z0-9])`, "i");
}

const COMMON_WORDS = new Set(("alpha apex arrow atlas atom aura beacon bloom bolt bridge bright canvas circle clear cloud coral craft crest delta ember "
  + "falcon flare forge fusion galaxy garden globe harbor harbour harvest haven horizon impact jungle karma kernel ladder lantern legend "
  + "matrix meadow mirror mosaic motion native nectar nimbus orbit origin pebble pillar pixel planet pocket prism pulse quest radar ripple "
  + "rocket saffron sample signal silver simple slice smart spark sphere spring square stride summit switch temple thrive ticket vector "
  + "velocity vertex vision voyage wonder zenith").split(" "));

/** Short names and everyday words turn up in unrelated posts, so they need a second sign. */
export function isAmbiguousName(company: string) {
  const core = coreKey(company);
  return core.length < 6 || COMMON_WORDS.has(core);
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

/** "bucketlistt.com" or "https://x.in/about" → "https://x.in/". Null when it is not a usable public address. */
export function siteOrigin(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? `${url.origin}/` : null;
  } catch {
    return null;
  }
}

const HINT_STOP = new Set(("startup startups company companies platform platforms building builds offering offers including focused service services "
  + "solution solutions india indian based driven enabled powered called combining combines through across global online digital technology "
  + "technologies business businesses customers provides products product verified structured working purpose develop potential leveraging "
  + "targeting seeking previously standard audiences brands mobile people system systems market markets independent operates produces "
  + "intelligence process processes manufacturing english speaking training exposure investors channels websites using identify").split(" "));

/** Words from the radar's description that would be odd to find in an unrelated post. */
export function distinctiveWords(target: Target) {
  const own = companyKey(target.company);
  const words = `${target.whatItDoes ?? ""} ${target.sector ?? ""}`.toLowerCase().match(/[a-z]{6,}/g) ?? [];
  return [...new Set(words.filter((word) => !HINT_STOP.has(word) && !own.includes(word)))];
}

/** City or description words found in `text`. One city hit or two description words tie a page to the company. */
function hintHits(target: Target, text: string) {
  const lower = text.toLowerCase();
  const city = target.city?.trim().toLowerCase();
  if (city && city.length >= 4 && new RegExp(`(?<![a-z])${escape(city)}(?![a-z])`).test(lower)) return `city ${target.city!.trim()}`;
  // A seven-letter stem lets "radiology" meet "radiologists".
  const hits = distinctiveWords(target).filter((word) => new RegExp(`(?<![a-z])${word.slice(0, 7)}`).test(lower));
  return hits.length >= 2 ? `description words ${hits.slice(0, 3).join(", ")}` : null;
}
const hasHints = (target: Target) => !!target.city?.trim() || distinctiveWords(target).length >= 2;

const NOT_A_COMPANY_SITE = /linkedin|crunchbase|tracxn|wikipedia|facebook|instagram|youtube|twitter|glassdoor|indeed|ambitionbox|justdial|zaubacorp|pitchbook|wellfound|ycombinator|github|medium|google|apple|inc42|yourstory|entrackr|businesssite/;
const AFFIXES = /^(?:get|try|use|my|the|go|hq|app|india|in|ai|io|labs?|tech|hello|join|team|with|official|global|group|co|hi|we|meet)$/;

/** "www.spectral-ai.co.in" → stem "spectralai", full "spectralaicoin". */
function hostParts(url: string) {
  const parts = host(url).split(".");
  const suffix = parts.length >= 3 && /^(?:co|com|org|net|ac|gov|edu)$/.test(parts.at(-2)!) && parts.at(-1)!.length === 2 ? 2 : 1;
  const strip = (value: string[]) => value.join("").replace(/[^a-z0-9]/g, "");
  return { stem: strip(parts.slice(0, -suffix)), full: strip(parts) };
}

/**
 * The company's own site among search results, with how sure the match is:
 * 4 the domain is the name, 3 the name plus a usual affix ("getkiln"), 2 the name inside a longer
 * domain, 1 the name's first word in the domain and a page of that site naming the company in full.
 * Below 4 a page of the site must also name the company.
 */
export function rankWebsite(target: string | Target, results: Page[]): { url: string; score: number } | null {
  const t: Target = typeof target === "string" ? { company: target } : target;
  const key = companyKey(t.company);
  const core = coreKey(t.company);
  const name = nameRegex(t.company);
  const first = t.company.trim().split(/\s+/).length > 1 ? companyKey(t.company.trim().split(/\s+/)[0]!) : "";
  const needsHint = isAmbiguousName(t.company) && hasHints(t);
  let best: { url: string; score: number } | null = null;
  for (const page of results) {
    const { stem, full } = hostParts(page.url);
    if (!stem || NOT_A_COMPANY_SITE.test(full)) continue;
    const sameSite = results.filter((other) => host(other.url) === host(page.url));
    const named = sameSite.some((other) => name.test(other.title) || name.test(other.text.slice(0, 300)));
    const rest = stem.startsWith(core) ? stem.slice(core.length) : stem.endsWith(core) ? stem.slice(0, -core.length) : null;
    const score = [key, core].includes(stem) || [key, core].includes(full) ? 4
      : !named ? 0
      : rest !== null && AFFIXES.test(rest) ? 3
      : core.length >= 4 && stem.includes(core) ? 2
      : first.length >= 5 && !COMMON_WORDS.has(first) && stem.startsWith(first) ? 1
      : 0;
    if (!score) continue;
    // "cent.co" is as exact as "cent.health": a short name's site must also look like the radar's company.
    if (needsHint && !sameSite.some((other) => hintHits(t, `${other.title}\n${other.text}`))) continue;
    if (!best || score > best.score) best = { url: `${new URL(page.url).origin}/`, score };
  }
  return best;
}

/** The company's own site: a top result whose hostname carries the company name. */
export const pickWebsite = (target: string | Target, results: Page[]) => rankWebsite(target, results)?.url ?? null;

const ATS: { provider: Board["provider"]; pattern: RegExp }[] = [
  { provider: "greenhouse", pattern: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i },
  { provider: "lever", pattern: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { provider: "ashby", pattern: /jobs\.ashbyhq\.com\/([a-z0-9_.%-]+)/i },
];

/** A job board the company itself links to, found in page URLs or outgoing links. */
export function findBoardLink(urls: string[]) {
  for (const url of urls) {
    for (const { provider, pattern } of ATS) {
      const slug = pattern.exec(url)?.[1];
      if (slug && !["embed", "api"].includes(slug)) return { provider, slug };
    }
  }
  return null;
}

// `own`: the address itself belongs to one employer (acme.keka.com). Otherwise it is a marketplace page.
const BOARD_SITES: { provider: BoardProvider; own: boolean; pattern: RegExp }[] = [
  { provider: "keka", own: true, pattern: /^https?:\/\/(?!(?:www|app|help|developers|apidocs)\.)[a-z0-9-]+\.keka\.com\//i },
  { provider: "zoho-recruit", own: true, pattern: /^https?:\/\/(?!(?:www|help)\.)[a-z0-9-]+\.zohorecruit\.(?:com|in|eu)\//i },
  { provider: "freshteam", own: true, pattern: /^https?:\/\/(?!(?:www|support)\.)[a-z0-9-]+\.freshteam\.com\//i },
  { provider: "darwinbox", own: true, pattern: /^https?:\/\/(?!(?:www|blog)\.)[a-z0-9-]+\.darwinbox\.(?:in|com)\//i },
  { provider: "workable", own: true, pattern: /^https?:\/\/(?:apply\.workable\.com\/(?!api\/)[a-z0-9-]+|(?!(?:www|help|resources|apply)\.)[a-z0-9-]+\.workable\.com\/)/i },
  { provider: "wellfound", own: false, pattern: /^https?:\/\/(?:www\.)?(?:wellfound\.com|angel\.co)\/(?:company\/[a-z0-9-]+|jobs\/\d)/i },
  { provider: "instahyre", own: false, pattern: /^https?:\/\/(?:www\.)?instahyre\.com\/(?:jobs-at-|job-)[a-z0-9-]+/i },
  { provider: "cutshort", own: false, pattern: /^https?:\/\/(?:www\.)?cutshort\.io\/(?:company|job)\/[a-z0-9-]+/i },
  { provider: "linkedin-jobs", own: false, pattern: /^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:jobs\/(?:view\/|[a-z0-9-]+-jobs)|company\/[^/?#]+\/jobs)/i },
  { provider: "naukri", own: false, pattern: /^https?:\/\/(?:www\.)?naukri\.com\/(?:[a-z0-9-]+-jobs-careers-\d+|[a-z0-9-]+-overview-\d+|job-listings-[a-z0-9-]+)/i },
  { provider: "yc", own: false, pattern: /^https?:\/\/(?:www\.)?(?:ycombinator\.com|workatastartup\.com)\/companies\/[a-z0-9-]+/i },
];

/**
 * Job-board links for this company. Links on the company's own pages are trusted as they are.
 * A search hit counts only when its address or its title names the company.
 */
export function findBoardLinks(company: string, pages: Page[], ownHost: string | null): BoardLink[] {
  const core = coreKey(company);
  const name = nameRegex(company);
  const found = new Map<string, BoardLink>();
  const add = (url: string, source: BoardLink["source"], title: string) => {
    const site = BOARD_SITES.find((s) => s.pattern.test(url));
    if (!site) return;
    let clean: URL;
    try {
      clean = new URL(url);
    } catch {
      return;
    }
    const address = `${clean.origin}${clean.pathname}`.replace(/\/$/, "");
    const slug = (site.own ? `${clean.hostname}${clean.pathname}` : clean.pathname).toLowerCase().replace(/[^a-z0-9]/g, "");
    // On the company's own pages a marketplace link may still be a generic footer link, so its path is checked too.
    const mine = slug.includes(core) || (source === "search" && name.test(title));
    if (!(source === "site" && site.own) && !mine) return;
    const id = `${site.provider} ${address.toLowerCase()}`;
    const known = found.get(id);
    if (!known || (known.source === "search" && source === "site")) found.set(id, { provider: site.provider, url: address, source });
  };
  for (const page of pages) {
    const pageHost = host(page.url);
    const own = !!ownHost && (pageHost === ownHost || pageHost.endsWith(`.${ownHost}`));
    add(page.url, "search", page.title);
    if (own) for (const link of page.links) add(link, "site", "");
  }
  return [...found.values()].sort((a, b) => a.source.localeCompare(b.source)).slice(0, HIRING_LIMITS.boardsKept);
}

export const boardURL = (provider: Board["provider"], slug: string) =>
  provider === "greenhouse" ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
    : provider === "lever" ? `https://api.lever.co/v0/postings/${slug}?mode=json`
    : `https://api.ashbyhq.com/posting-api/job-board/${slug}`;

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null);
const date = (value: unknown) => {
  const time = typeof value === "number" ? value : Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** Normalizes the three public job-board responses. Returns null when the payload is not a board. */
export function parseBoard(provider: Board["provider"], payload: unknown): Job[] | null {
  const rows = provider === "lever" ? payload : (payload as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row: any): Job[] => {
    const job: Job = provider === "greenhouse"
      ? { title: text(row?.title) ?? "", location: text(row?.location?.name), url: text(row?.absolute_url) ?? "", updatedAt: date(row?.updated_at) }
      : provider === "lever"
        ? { title: text(row?.text) ?? "", location: text(row?.categories?.location), url: text(row?.hostedUrl) ?? "", updatedAt: date(row?.createdAt) }
        : { title: text(row?.title) ?? "", location: text(row?.location), url: text(row?.jobUrl) ?? "", updatedAt: date(row?.publishedAt) };
    return job.title && job.url.startsWith("https://") ? [job] : [];
  });
}

const ROLE_WORD = /(?<![a-z])(?:engineers?|developers?|programmers?|architects?|designers?|managers?|leads?|heads?|directors?|vp|officers?|executives?|associates?|analysts?|scientists?|researchers?|interns?|trainees?|specialists?|strategists?|consultants?|coordinators?|administrators?|accountants?|controllers?|recruiters?|writers?|copywriters?|editors?|producers?|marketers?|representatives?|advisors?|radiologists?|doctors?|physicians?|nurses?|technicians?|supervisors?|assistants?|founder(?:'|’)?s\s+office|chief\s+of\s+staff|sde|sdr|bdr|bde|bdm|devops|cfo|cto|coo|cmo|generalists?|merchandisers?|animators?|videographers?|photographers?|counsell?ors?|therapists?|psychologists?|pharmacists?|teachers?|tutors?|trainers?|lawyers?|auditors?|underwriters?|apprentices?)(?![a-z])/i;
const ROLE_CHUNK = "([^\\n.,!?|:;()•*#]{3,90})";
const ROLE_PATTERNS = [
  new RegExp(`(?:hiring|looking\\s+for|looking\\s+to\\s+hire|seeking|searching\\s+for)\\s+(?:for\\s+)?(?:an?|our\\s+(?:first|next))\\s+${ROLE_CHUNK}`, "i"),
  new RegExp(`we(?:'|’)?(?:re|\\s+are)\\s+a\\s+new\\s+${ROLE_CHUNK}`, "i"),
  new RegExp(`hiring\\s*[!:|–—-]+\\s*${ROLE_CHUNK}`, "i"),
  new RegExp(`(?<![a-z])(?:role|position|opening)\\s*[:–—-]\\s*${ROLE_CHUNK}`, "i"),
  new RegExp(`hiring\\s+(?:for\\s+)?${ROLE_CHUNK}`, "i"),
];
const ROLE_FILLER = /^(?:(?:new|rockstar|talented|passionate|experienced|skilled|dynamic|motivated|stellar|seasoned|brilliant|kickass|great|strong|driven|sharp|smart|full-?time|part-?time|dedicated|proactive|hands-on)\s+)+/i;

/** The role a hiring post names ("We're hiring a Banking Lead at X" → "Banking Lead"), or null. */
export function extractRole(company: string, title: string, body = "") {
  const name = nameRegex(company);
  for (const source of [title, body]) {
    for (const pattern of ROLE_PATTERNS) {
      const chunk = pattern.exec(source)?.[1];
      if (!chunk) continue;
      const role = chunk
        .split(/\s+(?:at|to|who|in|for|with|based|from|on|as|that|and\s+we|@)\s+|\s+[–—-]\s+|\s+@/i)[0]!
        .replace(/[^\p{L}\p{N}&/+.' -]/gu, " ").replace(/\s+/g, " ").trim()
        .replace(ROLE_FILLER, "");
      const bare = pattern === ROLE_PATTERNS.at(-1);
      if (role.length < 3 || role.length > 60 || role.split(" ").length > (bare ? 4 : 6) || name.test(role)) continue;
      // After a bare "hiring", only a phrase that ends in a job word is a role ("hiring Backend Engineers").
      if (bare ? new RegExp(`${ROLE_WORD.source}$`, "i").test(role) : ROLE_WORD.test(role)) return role;
    }
  }
  return null;
}

const ROLE_LINE_NOISE = /(?<![a-z])(?:we|our|you|your|us|is|are|why|how|meet|about|life|blog|contact|login|careers?|jobs?|privacy|terms|become|team|teams|program|programme|partners?|testimonials?|stories|story|message|copyright|rights|apply|view|read|learn|click|from|says?|said|by|hiring|hire|hires)(?![a-z])/i;

/** Role titles on a careers page: short heading-like lines that read as a job title. Better empty than wrong. */
export function extractRoles(pageText: string) {
  const roles = new Map<string, string>();
  for (const row of pageText.split("\n")) {
    // In a table of openings the title is the first cell.
    const raw = row.trim().startsWith("|") ? row.split("|").find((cell) => cell.trim()) ?? "" : row;
    const line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s*\([^)]*\)/g, "")
      .replace(/^[\s>#*\-•·|\d.)]+/, "").replace(/[*_`|]+/g, " ").replace(/\s+/g, " ").trim();
    const words = line.split(" ");
    if (line.length < 5 || line.length > 70 || words.length < 2 || words.length > 7) continue;
    if (!/^\p{Lu}/u.test(line) || /[.?!]$/.test(line) || /[@₹$%=<>{}"“”:;,[\]]|https?:|head\s+office/i.test(line)) continue;
    if (!ROLE_WORD.test(line) || ROLE_LINE_NOISE.test(line)) continue;
    // A title is written in title case; a sentence that happens to contain "manager" is not.
    if (words.filter((word) => /^[a-z]/.test(word) && !/^(?:of|and|to|for|in|the|a|an|at|with|or)$/.test(word)).length) continue;
    if (!roles.has(line.toLowerCase())) roles.set(line.toLowerCase(), line);
  }
  return [...roles.values()].slice(0, HIRING_LIMITS.rolesKept);
}

const phrases = (list: string[]) => new RegExp(list.map((item) => `(?<![a-z])(?:${item})(?![a-z])`).join("|"), "i");
/** Unmistakable hiring intent: counts anywhere in the post. "Join our journey" and "internship" alone no longer count. */
export const HIRING_PHRASE = phrases([
  "(?:we|we(?:'|’)?re|we\\s+are|they(?:'|’)?re|they\\s+are|i(?:'|’)?m|i\\s+am|are|is|still|now|also|actively|currently)\\s+(?:#\\s?)?hiring",
  "hiring\\s+(?:across|multiple)",
  "looking\\s+to\\s+hire",
  "(?:open|new)\\s+(?:roles?|positions?)",
  "(?:job\\s+)?openings?\\s+(?:for|across)",
  "apply\\s+(?:now|here|today)",
  "(?:send|share|drop|email|mail)\\s+(?:us\\s+|me\\s+)?(?:your|ur)\\s+(?:cv|resume|résumé|portfolio|profile)",
  "join\\s+(?:our|the)\\s+(?:[a-z-]+\\s+){0,2}team",
  "join\\s+us\\s+(?:as|in)\\s+an?",
  "expanding\\s+(?:our|the)\\s+team",
  "#\\s?(?:hiring|wearehiring|hiringnow|hiringalert|nowhiring|jobopening|jobalert)",
]);
/** Wording that means hiring only when it opens the post: deep in a long text "looking for a" or "apply at" is usually about something else. */
export const HIRING_OPENING = new RegExp(`${phrases([
  "hiring\\s+(?:for|an?|our|interns?|freshers?|alert|at|\\d+)",
  "looking\\s+for\\s+(?:an?|people|someone|folks|talented|passionate|experienced|candidates|interns?|freshers?)",
  "vacanc(?:y|ies)",
  "apply\\s+(?:at|via|through|by|on)",
  "(?:job\\s+)?openings?\\s+(?:in|at)",
]).source}|(?<![a-z])hiring\\s*[:!|]`, "i");
/** Hiring intent in a post: a strong phrase anywhere, or a softer one in the title or opening lines. */
export const showsHiring = (heading: string, body: string) =>
  HIRING_PHRASE.test(`${heading}\n${body}`) || HIRING_OPENING.test(`${heading}\n${body.slice(0, 400)}`);
/** Someone looking for work, or announcing their own move: not an employer hiring. */
const NOT_AN_EMPLOYER = new RegExp([
  "(?<![a-z])i(?:(?:'|’)ve|\\s+have)?\\s+(?:just\\s+|recently\\s+)?(?:been\\s+promoted|joined|accepted|started|completed|got\\s+hired|been\\s+hired)(?![a-z])",
  "(?<![a-z])(?:thrilled|excited|happy|delighted|pleased|glad|proud)\\s+to\\s+(?:announce|share)\\s+(?:that\\s+)?i(?![a-z])",
  "(?<![a-z])(?:starting|started)\\s+a\\s+new\\s+(?:position|role|job)(?![a-z])",
  "(?<![a-z])open\\s+to\\s+work(?![a-z])|#\\s?opentowork",
  "(?<![a-z])(?:i(?:'|’)?m|i\\s+am|actively|currently)\\s+(?:actively\\s+|currently\\s+)?(?:looking|seeking|searching)\\s+for\\s+(?:an?\\s+|my\\s+)?(?:new\\s+|next\\s+)?(?:job|role|opportunit|position|internship|opening)",
  "^\\W*(?:congratulations|congrats|welcome\\s+aboard)(?![a-z])",
].join("|"), "i");
const FOUNDER = /(?<![a-z])(?:co-?founder|founder|ceo|cto)(?![a-z])/i;
const POST_URL = /linkedin\.com\/(?:posts\/|feed\/update\/)|(?:x|twitter)\.com\/[^/]+\/status\//i;
const JOB_SITE = /glassdoor|wellfound|instahyre|cutshort|naukri|indeed|foundit|keka\.com|zohorecruit|freshteam|darwinbox|workable|linkedin\.com\/jobs|fitboard|alion\.io|ycombinator\.com\/companies/i;

const count = (value: string | undefined) => {
  const number = Number(value?.replace(/,/g, ""));
  return value && Number.isInteger(number) && number >= 0 ? number : null;
};

/**
 * Splits a retrieved LinkedIn post into its parts. Exa returns
 * `# title`, `**Author**: headline`, `---`, the post, then `## Comments (n shown of m reported)` and
 * `## Engagement` with `- Reactions: n` / `- Comments: n`. Text without that shape is all body.
 */
export function readPost(page: Page) {
  const full = page.text.replace(/\r/g, "");
  const rule = /\n-{3,}\n/.exec(full);
  const head = rule ? full.slice(0, rule.index) : "";
  const afterRule = rule ? full.slice(rule.index + rule[0].length) : full;
  const end = afterRule.search(/(?:^|\n)## (?:Comments|Engagement)(?![a-z])/);
  const body = (end >= 0 ? afterRule.slice(0, end) : afterRule).replace(/^# [^\n]*·[^\n]*\n/, "").trim();
  const tail = end >= 0 ? afterRule.slice(end) : "";
  const byline = /\*\*([^*\n]{2,80})\*\*(?::[ \t]*([^\n]*))?/.exec(head || full.slice(0, 400));
  // Only an Engagement block that closes the text counts: the post or a comment may contain the same words.
  const engagement = /## Engagement\s*\n(?:- [A-Za-z]+: [\d,]+[ \t]*(?:\n|$))+\s*$/.exec(tail)?.[0] ?? "";
  const inEngagement = engagement !== "";
  return {
    body,
    author: byline?.[1]?.trim() ?? null,
    headline: byline?.[2]?.trim() ?? "",
    reactions: inEngagement ? count(/^- Reactions:\s*([\d,]+)\s*$/m.exec(engagement)?.[1]) : null,
    comments: (inEngagement ? count(/^- Comments:\s*([\d,]+)\s*$/m.exec(engagement)?.[1]) : null)
      ?? count(/## Comments \(\d+ shown of ([\d,]+) reported\)/.exec(tail)?.[1]),
  };
}

const personTokens = (name: string) =>
  name.toLowerCase().replace(/\(.*?\)/g, " ").split(/[^\p{L}]+/u).filter((token) => token.length > 1 && !/^(?:ca|dr|mr|mrs|ms|er|prof|cfa|mba|phd)$/.test(token));

/** "CA Nitant Desai" is the founder "Nitant Desai". A lone first name never matches. */
export function isFounder(author: string | null, founders: string[] | null | undefined) {
  const a = personTokens(author ?? "");
  if (a.length < 2) return false;
  return (founders ?? []).some((founder) => {
    const f = personTokens(founder);
    if (f.length < 2) return false;
    const [small, large] = f.length <= a.length ? [f, a] : [a, f];
    return small.every((token) => large.includes(token));
  });
}

export type PostOptions = { now?: Date; freshDays?: number };
export const isFresh = (publishedDate: string | null, now: Date, freshDays: number) =>
  Date.parse(publishedDate ?? "") >= now.getTime() - freshDays * 86_400_000;

/**
 * A social post counts only if it names the company, shows real hiring intent by an employer,
 * and is inside the window. A short or common-word name also needs something tying the post to this company.
 */
export function toPost(target: string | Target, page: Page, since: Date, options: PostOptions = {}): Post | null {
  const judged = judgePost(target, page, since, options);
  return typeof judged === "string" ? null : judged;
}

/** The post, or the reason it does not count. */
export function judgePost(target: string | Target, page: Page, since: Date, options: PostOptions = {}): Post | string {
  const t: Target = typeof target === "string" ? { company: target } : target;
  if (!POST_URL.test(page.url)) return "not a social post";
  const published = Date.parse(page.publishedDate ?? "");
  if (!Number.isFinite(published) || published < since.getTime()) return "outside the date window";

  const parts = readPost(page);
  const titled = page.title.includes(" | ");
  const titleAuthor = titled ? page.title.split(" | ").at(-1)!.trim() : "";
  const author = [parts.author, page.author?.trim(), titleAuthor].find((value) => value && value.length <= 60 && !/linkedin/i.test(value)) ?? null;
  const headingText = (titled ? page.title.split(" | ").slice(0, -1).join(" | ") : page.title).trim();
  // Comments and the engagement block are other people's words: only the post itself is read.
  const said = `${headingText}\n${parts.body}`;
  const ambiguous = isAmbiguousName(t.company);
  if (!namesCompany(t.company, `${said}\n${parts.headline}\n${author ?? ""}`, ambiguous)) return "the post itself does not name the company";
  if (!showsHiring(headingText, parts.body)) return "no hiring phrase in the post";
  if (NOT_AN_EMPLOYER.test(`${headingText}\n${parts.body.slice(0, 300)}`)) return "a job seeker or personal announcement";

  const byFounder = isFounder(author, t.founders);
  let corroboratedBy: string | null = null;
  if (ambiguous) {
    corroboratedBy = corroborate(t, page, author, byFounder, `${said}\n${parts.headline}`, parts.headline);
    if (!corroboratedBy) return "short or common name with nothing else tying the post to this company";
  }
  const now = options.now ?? new Date();
  return {
    url: page.url,
    title: page.title.replace(/\s+/g, " ").slice(0, 160),
    author: author && author.length <= 40 ? author : null,
    publishedDate: new Date(published).toISOString(),
    excerpt: (parts.body || page.text).replace(/\s+/g, " ").slice(0, 280),
    founderLikely: FOUNDER.test(`${parts.headline}\n${said}`.slice(0, 500)),
    byFounder,
    fresh: isFresh(new Date(published).toISOString(), now, options.freshDays ?? 2),
    role: extractRole(t.company, headingText, parts.body),
    primary: showsHiring(headingText, parts.body.slice(0, 120)),
    reactions: parts.reactions,
    comments: parts.comments,
    under100Likes: parts.reactions === null ? null : parts.reactions < 100,
    corroboratedBy,
  };
}

/** For an ambiguous name the mention must be written as a name: "Cent", never "per cent". */
function namesCompany(company: string, value: string, strict: boolean) {
  const name = nameRegex(company);
  if (!strict) return name.test(value);
  const capital = /^\p{Lu}/u.test(coreName(company));
  for (const match of value.matchAll(new RegExp(name.source, "gi"))) {
    const before = value.slice(Math.max(0, match.index - 5), match.index).toLowerCase();
    if (/per\s+$/.test(before)) continue;
    if (!capital || /^\p{Lu}/u.test(match[0])) return true;
  }
  return false;
}

/** What ties a post to this company beyond its (short) name. Null when nothing does. */
function corroborate(t: Target, page: Page, author: string | null, byFounder: boolean, said: string, headline: string): string | null {
  const core = coreKey(t.company);
  const authorKey = companyKey((author ?? "").replace(/\(.*?\)/g, ""));
  const site = siteOrigin(t.website);
  const siteHost = site ? host(site) : "";
  const { stem, full } = site ? hostParts(site) : { stem: "", full: "" };
  const slug = (/linkedin\.com\/posts\/([^_/]+)_/i.exec(page.url)?.[1] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const everything = `${said}\n${page.links.join("\n")}`.toLowerCase();
  // The company's own domain in the post, or the post coming from a page named after that domain ("centhealth").
  if (siteHost && (everything.includes(siteHost) || (full.length >= 6 && slug === full) || (stem.length >= 6 && stem !== core && everything.includes(stem)))) return `website ${siteHost}`;
  if (byFounder) return "founder";
  // A poster whose own name extends the company's ("Cent Bank Home Finance" for "Cent") is a namesake.
  if (authorKey && authorKey !== core && authorKey !== companyKey(t.company) && authorKey.includes(core)) return null;
  if (authorKey && (authorKey === core || authorKey === companyKey(t.company))) return "company page";
  // "Co-Founder @ Cent" in the poster's headline, but not "HR @ Cent Bank": the name must end there.
  const employer = new RegExp(`(?:@|(?<![a-z])at)\\s*${nameRegex(t.company).source}(?:\\.[a-z]{2,6}|\\s+(?:AI|Labs?|Technologies|Tech)(?![a-z]))?`, "i").exec(headline);
  if (employer && !/^\s+\p{Lu}/u.test(headline.slice(employer.index + employer[0].length))) return "poster's headline";
  return hintHits(t, said);
}

/** The same LinkedIn post can appear under two URL shapes; its activity id identifies it. */
export const postId = (url: string) => /activity[-:](\d{10,})/.exec(url)?.[1] ?? url;

const CAREERS_PATH = /career|jobs?(?![a-z])|join-?us|hiring|work-?with-?us|openings/i;

export function classifyCareerResults(company: string, website: string | null, pages: Page[]) {
  const site = website ? host(website) : "";
  const name = nameRegex(company);
  let careersUrl: string | null = null;
  const listings: Listing[] = [];
  for (const page of pages) {
    const pageHost = host(page.url);
    if (site && (pageHost === site || pageHost.endsWith(`.${site}`))) {
      if (!careersUrl && CAREERS_PATH.test(page.url)) careersUrl = page.url;
    } else if (JOB_SITE.test(page.url) && name.test(page.title) && listings.length < HIRING_LIMITS.listingsKept) {
      listings.push({ url: page.url, title: page.title.replace(/\s+/g, " ").slice(0, 160) });
    }
  }
  return { careersUrl, listings };
}

/** A careers link on the company's own site, from the links of a page of that site. */
export function careersLink(website: string, links: string[]) {
  const site = host(website);
  for (const link of links) {
    const linkHost = host(link);
    if (!site || !(linkHost === site || linkHost.endsWith(`.${site}`))) continue;
    try {
      const url = new URL(link);
      if (CAREERS_PATH.test(url.pathname) || /^(?:careers?|jobs)\./.test(linkHost)) return `${url.origin}${url.pathname}`;
    } catch {
      // not a link
    }
  }
  return null;
}

export const siteHost = (website: string | null) => (website ? host(website) || null : null);
