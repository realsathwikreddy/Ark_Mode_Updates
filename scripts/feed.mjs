// Builds feed.json: hackathons, AI classes, music, internships and JEE/college news
// for Sathwik. Runs on GitHub every 6 hours. Each source can fail without breaking the rest.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = { 'user-agent': 'Mozilla/5.0 (ArkMode feed bot)', accept: 'application/json, text/xml, */*' };
const FUNDED = /travel (grant|support|stipend|reimburse|assistance|award|cover)|fully[- ]funded|all[- ]expenses?[- ]paid|expenses? (are |will be )?(covered|paid)|flights? (and|&) (stay|accommodation)|(airfare|flights?) (covered|paid|reimbursed)|accommodation (and|&) travel/i;
const HYD = /hyderabad|secunderabad|telangana|gachibowli|hitec ?city|madhapur|t-hub|iiit[- ]?h\b|iith|bits hyderabad/i;
const INDIA = /india|bengaluru|bangalore|chennai|mumbai|delhi|pune|kolkata|noida|gurugram|kerala|iit |nit /i;
const strip = (s = '') => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

function place(text, onlineFlag) {
  if (onlineFlag) return 'online';
  if (HYD.test(text)) return 'hyderabad';
  if (/\bonline\b|virtual|remote/i.test(text)) return 'online';
  if (INDIA.test(text)) return 'india';
  return 'international';
}

async function get(url, as = 'json') {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === 'json' ? r.json() : r.text();
}

async function devpost() {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const j = await get(`https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=${page}`);
    for (const h of j.hackathons || []) {
      const loc = h.displayed_location?.location || '';
      const themes = (h.themes || []).map((t) => t.name).join(', ');
      const prize = strip(h.prize_amount || '');
      const text = `${h.title} ${loc} ${themes}`;
      out.push({
        id: `dp-${h.id}`, cat: 'hackathon',
        title: h.title, url: h.url, source: 'Devpost', org: h.organization_name || '',
        when: h.submission_period_dates || '', place: place(text, /online/i.test(loc)), where: loc,
        detail: [themes, prize && prize !== '$0' ? `Prizes ${prize}` : ''].filter(Boolean).join(' · '),
        funded: FUNDED.test(text),
      });
    }
  }
  return out;
}

async function unstop(kind, cat) {
  const j = await get(`https://unstop.com/api/public/opportunity/search-result?opportunity=${kind}&per_page=40&oppstatus=open`);
  return (j.data?.data || []).map((o) => {
    const city = o.address_with_country_logo?.city || (o.locations || []).map((l) => l.city).join(', ') || '';
    const filters = (o.filters || []).map((f) => f.name).join(', ');
    const text = `${o.title} ${city} ${o.region || ''} ${filters}`;
    const isMusic = /music|singing|band|song|compos|instrument|beatbox|rap\b|dj\b/i.test(`${o.title} ${filters}`);
    return {
      id: `us-${o.id}`, cat: isMusic ? 'music' : cat, title: strip(o.title), url: `https://unstop.com/${o.public_url}`,
      source: 'Unstop', org: o.organisation?.name || '', when: o.end_date ? `Ends ${o.end_date.slice(0, 10)}` : '',
      place: place(text, o.region === 'online'), where: o.region === 'online' ? 'Online' : city,
      detail: filters.split(', ').slice(0, 3).join(', '), funded: FUNDED.test(text),
    };
  });
}

// Google News search as RSS. Good for news and for things the listing sites miss.
async function news(q, cat, limit = 12) {
  const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:14d&hl=en-IN&gl=IN&ceid=IN:en`, 'text');
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit);
  return items.map(([, it]) => {
    const tag = (n) => strip((it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || '');
    const title = tag('title');
    const src = tag('source');
    const link = tag('link');
    const text = `${title} ${tag('description')}`;
    return {
      id: `gn-${Buffer.from(link).toString('base64').slice(-24)}`, cat, title: title.replace(new RegExp(` - ${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''),
      url: link, source: src || 'News', org: '', when: tag('pubDate') ? new Date(tag('pubDate')).toISOString().slice(0, 10) : '',
      place: cat === 'jee' ? 'india' : place(text, false), where: '', detail: '', funded: FUNDED.test(text), news: true,
    };
  });
}

const SOURCES = [
  ['Devpost hackathons', () => devpost()],
  ['Unstop hackathons', () => unstop('hackathons', 'hackathon')],
  ['Unstop internships', () => unstop('internships', 'internship')],
  ['Unstop competitions', () => unstop('competitions', 'other')],
  ['News: JEE', () => news('"JEE Main" OR "JEE Advanced" OR NTA OR JoSAA', 'jee')],
  ['News: colleges', () => news('IIT OR IIIT OR BITS admission 2027 OR counselling', 'jee', 8)],
  ['News: AI classes', () => news('free AI course students OR AI workshop students India OR AI bootcamp free', 'ai')],
  ['News: hackathons Hyderabad', () => news('hackathon Hyderabad', 'hackathon')],
  ['News: funded programs', () => news('"travel grant" OR "fully funded" students hackathon OR summer school OR olympiad', 'hackathon', 10)],
  ['News: music', () => news('music competition students India OR music scholarship India OR youth music festival Hyderabad', 'music')],
  ['News: internships', () => news('internship for school students India OR high school internship India', 'internship', 8)],
];

const prev = existsSync('feed.json') ? JSON.parse(readFileSync('feed.json', 'utf8')) : { items: [] };
const firstSeen = Object.fromEntries((prev.items || []).map((i) => [i.id, i.seen]));
const now = new Date().toISOString();
const items = [];
const status = {};
for (const [name, fn] of SOURCES) {
  try { const got = await fn(); items.push(...got); status[name] = got.length; }
  catch (e) { status[name] = `failed: ${e.message.slice(0, 80)}`; }
}
const seenUrl = new Set();
const keep = [];
for (const i of items) {
  if (!i.url || seenUrl.has(i.url) || i.cat === 'other') continue;
  // international things only count if they pay the trip
  if (i.place === 'international' && !i.funded && !i.news) continue;
  seenUrl.add(i.url);
  keep.push({ ...i, seen: firstSeen[i.id] || now });
}
// carry over recent items a source dropped temporarily
for (const old of prev.items || []) {
  if (!seenUrl.has(old.url) && Date.now() - new Date(old.seen) < 10 * 86400000) { keep.push(old); seenUrl.add(old.url); }
}
keep.sort((a, b) => b.seen.localeCompare(a.seen));
writeFileSync('feed.json', JSON.stringify({ updated: now, status, items: keep.slice(0, 220) }, null, 1));
console.log(status, keep.length);
