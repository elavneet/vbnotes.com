import type { IconName } from '@/components/IconButton';

/** Guessed from a word in the tag's own name: `#company` gets a briefcase, `#finance/tax` a wallet. */
const BY_WORD: [RegExp, IconName][] = [
  [/^(work|jobs?|office|company|business|career|clients?|corp)$/, 'briefcase'],
  [/^(meetings?|calendar|events?|schedule|plans?|daily|weekly)$/, 'calendar'],
  [/^(finance|money|budget|bank|tax(es)?|expenses?|invest(ing)?|stocks?|crypto)$/, 'wallet'],
  [/^(dev|code|coding|programming|tech|software|engineering|api|bugs?)$/, 'code-slash'],
  [/^(cli|shell|ops|devops|servers?|infra)$/, 'terminal'],
  [/^(ai|ml|llm|gpt|claude|prompts?)$/, 'sparkles'],
  [/^(ideas?|brainstorm|thoughts?|inspiration)$/, 'bulb'],
  [/^(books?|reading|read|library|literature)$/, 'book'],
  [/^(school|study|learn(ing)?|courses?|class(es)?|university|college)$/, 'school'],
  [/^(journal|diary|logs?)$/, 'journal'],
  [/^(todos?|tasks?|checklists?)$/, 'checkbox'],
  [/^(health|wellness|love)$/, 'heart'],
  [/^(gym|fitness|workouts?|exercise|run(ning)?|sports?)$/, 'barbell'],
  [/^(medical|doctor|meds|medicine)$/, 'medkit'],
  [/^(food|recipes?|cooking|cook|meals?)$/, 'restaurant'],
  [/^(coffee|cafe)$/, 'cafe'],
  [/^(travel|trips?|flights?|vacation)$/, 'airplane'],
  [/^(home|house|household)$/, 'home'],
  [/^(family|friends|people|team)$/, 'people'],
  [/^(personal|me|self)$/, 'person'],
  [/^(music|songs?|playlists?)$/, 'musical-notes'],
  [/^(movies?|films?|tv|shows?)$/, 'film'],
  [/^(games?|gaming)$/, 'game-controller'],
  [/^(photos?|photography)$/, 'camera'],
  [/^(design|art|ui|ux|drawing)$/, 'color-palette'],
  [/^(shop(ping)?|buy|groceries|grocery)$/, 'cart'],
  [/^(gifts?|wishlist)$/, 'gift'],
  [/^(projects?|launch|startup|side)$/, 'rocket'],
  [/^(goals?|okrs?)$/, 'flag'],
  [/^(quotes?)$/, 'chatbubble-ellipses'],
  [/^(osho|zen|meditation|spiritual|mind(fulness)?|nature|garden)$/, 'leaf'],
  [/^(pets?|dogs?|cats?)$/, 'paw'],
  [/^(cars?)$/, 'car'],
  [/^(news|articles?|blog)$/, 'newspaper'],
  [/^(writing|write|drafts?)$/, 'create'],
  [/^(e?mail|inbox)$/, 'mail'],
  [/^(links?|bookmarks?)$/, 'link'],
  [/^(web|websites?|world)$/, 'globe'],
  [/^(favou?rites?|important|starred)$/, 'star'],
  [/^(research|science|experiments?|lab)$/, 'flask'],
  [/^(data|analytics|metrics|stats|reports?|scorecards?)$/, 'stats-chart'],
  [/^(docs?|documentation|specs?)$/, 'document-text'],
];

/** For names nothing matches: a stable pick, so each tag keeps its look. */
const PLAIN: IconName[] = ['pricetag', 'bookmark', 'folder', 'layers', 'cube', 'planet', 'flash', 'diamond', 'prism', 'flame', 'water', 'flower', 'shapes', 'compass', 'moon', 'sunny', 'cloud', 'infinite'];

/** Everything the picker offers. */
export const TAG_ICONS: IconName[] = [...new Set<IconName>([...BY_WORD.map(([, icon]) => icon), ...PLAIN, 'heart-circle', 'happy', 'moon', 'sunny', 'cloud', 'umbrella', 'bicycle', 'map', 'trophy', 'key', 'construct', 'hammer', 'bug', 'server', 'cloud-upload', 'phone-portrait', 'laptop', 'headset', 'mic', 'videocam', 'image', 'images', 'pizza', 'wine', 'beer', 'basket', 'storefront', 'business', 'receipt', 'card', 'cash', 'pie-chart', 'trending-up', 'megaphone', 'notifications', 'time', 'hourglass', 'compass', 'earth', 'boat', 'train', 'bus', 'fish', 'nutrition', 'bed', 'body', 'accessibility', 'chatbubbles', 'help-circle', 'alert-circle', 'shield-checkmark', 'lock-closed', 'eye', 'infinite', 'musical-note', 'brush', 'pencil', 'attach', 'archive'])];

const OFFERED = new Set<string>(TAG_ICONS);

/** The icon a tag gets until someone picks one. */
export function defaultTagIcon(path: string): IconName {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const words = name.split(/[\s_-]+/);
  for (const [re, icon] of BY_WORD) if (words.some((w) => re.test(w))) return icon;
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return PLAIN[Math.abs(h) % PLAIN.length];
}

/** A tag's picked icon, or its default. Unknown names (a hand-edited meta file) fall back too. */
export function tagIconOf(picked: Record<string, string>, path: string): IconName {
  const p = picked[path];
  return p && OFFERED.has(p) ? (p as IconName) : defaultTagIcon(path);
}
