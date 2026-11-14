// Hiring leads from X: fresh "we're hiring" posts by founders and teams at Indian startups.
// Tweet and profile text are untrusted data, never instructions.

/** The parts of a twitterapi.io tweet this module reads. */
export type Tweet = {
  id: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  createdAt?: string;
  likeCount?: number;
  viewCount?: number;
  replyCount?: number;
  entities?: { urls?: { expanded_url?: string }[] };
  author?: {
    userName?: string;
    name?: string;
    followers?: number;
    location?: string;
    description?: string;
    isAutomated?: boolean;
    profile_bio?: { description?: string };
  };
};

export type PosterKind = "founder" | "team" | "shared";

export type Lead = {
  id: string;
  url: string;
  postedAt: string;
  hoursOld: number;
  /** founder: the poster's bio says founder/CEO/CTO. team: first-person post. shared: someone passing on another company's opening. */
  poster: PosterKind;
  handle: string;
  name: string;
  bio: string;
  location: string;
  followers: number;
  company: string | null;
  role: string | null;
  likes: number;
  views: number | null;
  /** How the post says to apply. */
  emails: string[];
  dmOpen: boolean;
  links: string[];
  text: string;
  score: number;
};

export const X_LIMITS = { hours: 72, pagesPerQuery: 5, maxLikes: 100 };

const CITIES = "Bangalore OR Bengaluru OR HSR OR Koramangala OR Indiranagar OR Mumbai OR Delhi OR Gurgaon OR Gurugram OR Noida OR Hyderabad OR Pune OR Chennai OR India";
const INDIA_WORDS = `${CITIES} OR LPA OR CTC OR lakh OR "₹" OR INR OR IST`;

/** Search queries, newest first. Kept broad; `classify` does the real filtering. */
export function buildQueries(since: Date) {
  const tail = `-filter:replies -filter:retweets lang:en since:${since.toISOString().slice(0, 10)}`;
  return [
    `("we're hiring" OR "we are hiring" OR "we’re hiring") (${INDIA_WORDS})`,
    `("I'm hiring" OR "I am hiring" OR "I’m hiring" OR "hiring for my" OR "hiring for our") (${INDIA_WORDS})`,
    `hiring (${CITIES}) (startup OR founder OR "early stage" OR "early-stage" OR seed OR "we're building" OR "we are building")`,
    `hiring (${CITIES}) (AI OR SaaS OR fintech OR D2C OR "dev tools" OR agents OR LLM) (engineer OR developer OR designer OR intern OR growth OR "founder's office")`,
    `hiring (interns OR intern OR internship) (${CITIES}) (startup OR founder OR stipend OR "we're building" OR AI)`,
    `("founder's office" OR "founders office" OR "chief of staff" OR "founding engineer" OR "founding designer" OR "founding PM" OR "founding marketer" OR "founding GTM" OR "founding team") (hiring OR "looking for")`,
    `("we're hiring" OR "we are hiring" OR hiring) ("backed by" OR YC OR "Y Combinator" OR "seed round" OR "pre-seed" OR "just raised" OR "we raised")`,
    `(hiring OR "looking for") ("DM me" OR "DMs open" OR "email me" OR "mail me" OR "send your resume" OR "send your CV" OR "apply here") (${INDIA_WORDS})`,
    `("we're hiring" OR "we are hiring" OR hiring) ("AI engineer" OR "full stack" OR "full-stack" OR "backend engineer" OR "frontend engineer" OR SDE OR "ML engineer" OR "product designer") (${INDIA_WORDS})`,
    `(hiring OR "looking to hire") ("my startup" OR "our startup" OR "my team" OR "at my company" OR "for my company")`,
    `("looking for a" OR "looking for an" OR "looking to hire") (engineer OR developer OR designer OR intern OR marketer OR "product manager" OR growth) (${INDIA_WORDS})`,
  ].map((query) => `${query} ${tail}`);
}

const INDIA = /\b(india|bharat|bangalore|bengaluru|blr|mumbai|bombay|delhi|ncr|gurgaon|gurugram|noida|hyderabad|pune|chennai|kolkata|ahmedabad|jaipur|kochi|indore|chandigarh|hsr|koramangala|indiranagar)\b|🇮🇳/i;
const INDIA_MONEY = /\bLPA\b|₹|\bINR\b|\blakhs?\b|\bCTC\b/i;
const HIRING = /\bhiring\b|\blooking to hire\b|\bjoin (?:our|my) (?:founding |early |core )?team\b|\bwe(?:['’]re| are) looking for\b|\bopen roles?\b/i;
const FIRST_PERSON = /\b(?:we|i)(?:['’]re|['’]m| are| am)\s+(?:also |now |actively |currently |still )?(?:hiring|looking|growing|expanding|building)\b|\bhiring (?:for )?(?:my|our)\b|\b(?:our|my) (?:team|startup|company)\b|\bjoin us\b|\b(?:DM|email|mail|ping|message) me\b|\bwork with (?:me|us)\b/i;
const ROLE_WORD = /\b(engineers?|developers?|devs?|designers?|interns?|marketers?|sales|growth|product|pm|founder['’]?s office|chief of staff|editors?|analysts?|managers?|leads?|head of|ops|operations|writers?|sde|devrel|researchers?|scientists?|architects?|recruiters?|gtm|creators?|associates?|executives?|generalists?|closer)\b/i;
const FOUNDER_BIO = /\b(?:co-?founder|founder|founding|ceo|cto|coo|cpo|building|chief \w+ officer)\b/i;
const STARTUP = /\b(?:startup|founder|founding|co-?founder|building|yc|y combinator|backed by|seed|pre-seed|series [ab]|raised|saas|ai|llm|agents?|fintech|d2c|early[- ]stage|early team|bootstrapped|product)\b/i;
const SEEKER = /\b(?:i am|i'm|i’m) (?:looking for|open to|seeking|available)\b|open to work|looking for (?:a |an |new )?(?:job|role|opportunit|internship|referral|gig)|hire me|#opentowork|looking for [^.\n]{0,60}\broles?\b|looking for the right team|\banyone hiring\b|who(?:['’]s| is) hiring\b/i;
/** The poster's own opening: "we're hiring", "I am hiring", "Hiring: X", "join our team". */
const OWN_OPENING = /\b(?:we|i)(?:['’]re|['’]m| are| am)\s+(?:also |now |actively |currently |still )?(?:hiring|looking (?:for|to hire))\b|\bhiring (?:for )?(?:my|our)\b|(?:^|[\n.!]\s*|[^\p{L}\p{N}\s]\s*)(?:urgent(?:ly)? )?hiring\b|\bjoin (?:our|my) (?:\w+ )?team\b|\bwe(?:['’]re| are) (?:growing|expanding) (?:the|our) team\b/iu;
/** Someone else's opening passed along: "Acme is hiring a ...". */
const OTHERS_OPENING = /(?:^|[\n.!]\s*)@?[A-Z][\w.&-]*(?: [A-Z][\w.&-]*){0,2} is (?:now |also )?hiring\b/;
const JOB_ACCOUNT = /job|career|hiring|recruit|talent|fresher|vacanc|placement|opening|naukri|internship|staffing|\bhr\b|headhunt|opportunit|walk-?in|consultan|\bagency\b|news|alert|updates|off-?campus|referral/i;
const AGGREGATOR = /apply on (?:workday|lever|greenhouse|the company website)|job id|#jobalert|#jobsearch|#jobopening|walk-?in|batch[: ]\s*20\d\d|off[- ]campus|freshers? (?:can|eligible)|is now hiring for a remote/i;
const NOT_STARTUP = /\b(?:hospitals?|clinic|school|college|university|real estate|realty|villas?|pharma|franchise|exhibition|physio\w*|pediatric\w*|doctors?|nurses?|teachers?|faculty|bpo|call cent(?:er|re)|tele-?callers?|sarkari|govt|government|salon|astrolog\w*|loan|forex|casino|betting|ngo|csr|non-profit|nonprofit|makhana|traders?|cleaning products|foreman|field sales|sales field|oracle cloud|investors|strategic partners|business leaders)\b/i;
const BIG_COMPANY = /\b(?:amazon|google|microsoft|meta|apple|barclays|deloitte|kpmg|pwc|accenture|tcs|infosys|wipro|cognizant|capgemini|ibm|oracle|jpmorgan|goldman|gates foundation|sandvik|kimberly-clark|ey|hcl|tech mahindra|walmart|flipkart|reliance|tata|adobe|salesforce|sap|cisco|intel|nvidia|uber|paytm|okta|bmw|siemens|bosch|samsung|deutsche|hsbc|citi|morgan stanley|mckinsey|bcg)\b/i;
/** Musing about hiring, or asking a bot, is not an opening. */
const NOT_AN_OPENING = /@grok\b|can['’]t decide|should i hire|thinking (?:of|about) hiring|tips (?:for|on) hiring|how to hire|why (?:we|i) (?:stopped|don['’]t)/i;
const EMAIL = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const ROLE_PATTERNS = [
  /\bhiring\s*[:|-]\s*([^\n.!|]{3,70})/i,
  /\b(?:hiring|hire|looking for|looking to hire)\s+(?:an?\s+|for\s+(?:an?\s+)?|our\s+(?:first\s+)?|my\s+(?:first\s+)?|\d+\s+|two\s+|three\s+|multiple\s+)?([^\n.!,:;(|]{3,70}?)(?=\s+(?:at|in|for|to|who|with|on|based|from|and we)\b|[\n.!,:;(|]|$)/i,
  /\b(?:role|position)\s*[:-]\s*([^\n.!|]{3,70})/i,
];

const squash = (value: string) => value.replace(/\s+/g, " ").trim();

function readRole(text: string) {
  for (const pattern of ROLE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      const role = squash(match[1] ?? "")
        .replace(/^.*\bis (?:now |also )?hiring\s+(?:an?\s+)?/i, "")
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})+#]+$/gu, "")
        .replace(/^(?:an?|the|our|my)\s+/i, "");
      if (role.length < 3 || role.length > 60 || role.split(" ").length > 6) continue;
      if (!ROLE_WORD.test(role) || /[#@]|https?:/.test(role)) continue;
      // A clause, not a title: "you were running ops", "manager before their inbox gets flooded".
      if (/\b(?:you|someone|people|folks|us|them|talent|were|was|is|are|before|their|gets?|who|that|careers?)\b/i.test(role)) continue;
      return role;
    }
  }
  return null;
}

/** The company, when the bio or the post names it: "Founder @acme", "hiring at Acme", "Acme is hiring". */
function readCompany(bio: string, text: string, poster: PosterKind, author: { userName: string; name: string }) {
  const fromBio = /(?:founder|ceo|cto|coo|building|founding \w+|head of \w+|engineer|working|\bat)\s*(?:of|at|@)?\s*@([A-Za-z0-9_]{2,20})/i.exec(bio)?.[1];
  const fromText =
    /\b(?:[Hh]iring|[Ii]nterns?|[Ee]ngineers?|[Dd]esigners?|[Dd]evelopers?|[Tt]eam|[Rr]oles?|[Ss]ales|[Cc]ontent|[Ll]ead|[Mm]anager|[Oo]ps) (?:at|@)\s+@?([A-Z][\w&-]*(?:\.(?:ai|io|com|in|co|app|dev|money))?(?: [A-Z][\w&-]*){0,2})/.exec(text)?.[1] ??
    /(?:^|[\n.!|]\s*)@?([A-Z][\w&-]*(?:\.(?:ai|io|com|in|co|app|dev|money))?(?: [A-Z][\w&-]*){0,2}) is (?:now |also )?hiring\b/.exec(text)?.[1] ??
    /\bjoin (?:us at|the team at)\s+@?([A-Z][\w&-]*(?:\.(?:ai|io|com|in|co|app|dev|money))?(?: [A-Z][\w&-]*){0,2})/.exec(text)?.[1];
  if (poster === "shared") return fromText ?? null;
  // A company's own account, judged by its display name or a bio written as "we".
  const ownAccount = /\b(?:inc|technologies|labs|pvt|ltd|llp|studio|solutions|hq|ai)\b\.?$|india$/i.test(author.name.trim()) || /^we\b/i.test(bio);
  return fromText ?? (fromBio ? `@${fromBio}` : null) ?? (ownAccount ? author.name.trim() || null : null);
}

export type Verdict = { lead: Lead } | { dropped: string };

/** Decides whether one tweet is a usable lead, and why not when it is not. */
export function classify(tweet: Tweet, now: Date, limits = X_LIMITS): Verdict {
  const author = tweet.author ?? {};
  const handle = author.userName ?? "";
  const name = author.name ?? "";
  const bio = squash(author.profile_bio?.description ?? author.description ?? "");
  const text = tweet.text ?? "";
  const location = author.location ?? "";
  const posted = Date.parse(tweet.createdAt ?? "");
  const url = tweet.url ?? tweet.twitterUrl ?? "";
  if (!tweet.id || !handle || !url.startsWith("https://") || !Number.isFinite(posted)) return { dropped: "incomplete tweet" };
  const hoursOld = (now.getTime() - posted) / 3_600_000;
  if (hoursOld > limits.hours) return { dropped: "too old" };
  if (author.isAutomated || JOB_ACCOUNT.test(`${handle} ${name}`) || JOB_ACCOUNT.test(bio.slice(0, 160))) return { dropped: "job board or recruiter account" };
  if (AGGREGATOR.test(text)) return { dropped: "aggregator format" };
  if ((author.followers ?? 0) < 10 && !bio) return { dropped: "empty new account" };
  if (SEEKER.test(text)) return { dropped: "job seeker" };
  if (!HIRING.test(text) || NOT_AN_OPENING.test(text)) return { dropped: "no hiring intent" };
  if (!ROLE_WORD.test(text)) return { dropped: "no role named" };
  if (NOT_STARTUP.test(`${bio} ${text}`)) return { dropped: "not a startup role" };
  if (!(INDIA.test(location) || INDIA.test(bio) || INDIA.test(text) || INDIA_MONEY.test(text))) return { dropped: "no India signal" };
  if (!STARTUP.test(`${bio} ${text}`)) return { dropped: "no startup signal" };
  const likes = tweet.likeCount ?? 0;
  if (likes >= limits.maxLikes) return { dropped: `${limits.maxLikes}+ likes` };

  const own = OWN_OPENING.test(text) && FIRST_PERSON.test(text);
  if (!own && !OTHERS_OPENING.test(text)) return { dropped: "no hiring intent" };
  const poster: PosterKind = own ? (FOUNDER_BIO.test(bio) ? "founder" : "team") : "shared";
  const role = readRole(text);
  // A passed-along opening is only useful when it says what the role is.
  if (poster === "shared" && !role) return { dropped: "no role named" };
  // A big employer's opening is not what this is for, whoever posts it.
  if (BIG_COMPANY.test(text)) return { dropped: "large company" };
  const emails = [...new Set((text.match(EMAIL) ?? []).map((email) => email.toLowerCase().replace(/\.+$/, "")))];
  const links = [...new Set((tweet.entities?.urls ?? []).map((u) => u.expanded_url ?? "").filter((u) => u.startsWith("https://")))].slice(0, 3);
  const dmOpen = /\bDMs?\b/.test(text);
  const score =
    (poster === "founder" ? 6 : poster === "team" ? 3 : 1) +
    (hoursOld <= 24 ? 3 : hoursOld <= 48 ? 1 : 0) +
    (emails.length || dmOpen ? 1 : 0) +
    (/\b(?:founding|seed|pre-seed|raised|yc|backed by|early team)\b/i.test(text) ? 2 : 0) +
    (/\b(?:engineer|developer|sde|designer|product)\b/i.test(text) ? 1 : 0);
  return {
    lead: {
      id: tweet.id, url, postedAt: new Date(posted).toISOString(), hoursOld: Math.round(hoursOld * 10) / 10, poster, handle, name, bio, location,
      followers: author.followers ?? 0, company: readCompany(bio, text, poster, { userName: handle, name }), role,
      likes, views: tweet.viewCount ?? null, emails, dmOpen, links, text: squash(text), score,
    },
  };
}
