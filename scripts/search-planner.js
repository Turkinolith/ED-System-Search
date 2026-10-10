// Turns a plain-English search request ("earth-like worlds within 300 ly",
// "icy rings with tritium") into a search plan without any AI service, and
// reports the words it could not use so the app can say so or hand the
// request to an AI assistant.

// Each rule removes the phrase it matches, so the words left over at the end
// are the ones nothing understood.
const ringRules = [
  [/\b(?:icy|ice)\s+(?:planetary\s+)?rings?\b/g, 'icy', 'icy rings'],
  [/\brocky\s+rings?\b/g, 'rocky', 'rocky rings'],
  [/\bmetal[-\s]?rich\s+rings?\b/g, 'metalRich', 'metal-rich rings'],
  [/\bmetallic\s+rings?\b/g, 'metallic', 'metallic rings'],
];

const world = '(?:\\s+(?:worlds?|planets?|bod(?:y|ies)))?';
const bodyRules = [
  [new RegExp(`\\b(?:earth[-\\s]?like${world}|elws?)\\b`, 'g'), 'earthLike', 'earth-like worlds'],
  [new RegExp('\\b(?:water\\s+worlds?|wws?)\\b', 'g'), 'waterWorld', 'water worlds'],
  [new RegExp('\\bammonia\\s+worlds?\\b', 'g'), 'ammoniaWorld', 'ammonia worlds'],
  [new RegExp('\\b(?:gas\\s+giants?\\s+with\\s+)?water[-\\s]?based\\s+life(?:\\s+gas\\s+giants?)?\\b', 'g'), 'gasWaterLife', 'gas giants with water-based life'],
  [new RegExp('\\b(?:gas\\s+giants?\\s+with\\s+)?ammonia[-\\s]?based\\s+life(?:\\s+gas\\s+giants?)?\\b', 'g'), 'gasAmmoniaLife', 'gas giants with ammonia-based life'],
  [new RegExp('\\bwater\\s+giants?\\b', 'g'), 'waterGiant', 'water giants'],
  [new RegExp(`\\brocky[-\\s]ice${world}\\b`, 'g'), 'rockyIce', 'rocky-ice bodies'],
  [new RegExp('\\bicy\\s+(?:worlds?|planets?|bod(?:y|ies))\\b', 'g'), 'icyBody', 'icy bodies'],
  [new RegExp(`\\b(?:high[-\\s]?metal(?:[-\\s]content)?${world}|hmcs?)\\b`, 'g'), 'highMetal', 'high metal content bodies'],
  [new RegExp('\\bmetal[-\\s]?rich\\s+(?:worlds?|planets?|bod(?:y|ies))\\b', 'g'), 'metalRich', 'metal-rich bodies'],
  [new RegExp(`\\bterraform(?:able|ables|ing\\s+candidates?)${world}\\b`, 'g'), 'terraformable', 'terraformable bodies'],
];

// Ring hotspot and surface signal names as they appear in the galaxy data,
// written without spaces; matching ignores spaces and plurals.
const keywordRules = [
  [/\blow[-\s]?temp(?:erature)?\s+diamonds?\b|\bltds?\b/g, 'lowtemperaturediamond', 'low temperature diamonds'],
  // The galaxy dump names these "Opal"; journals say "Void Opal".
  [/\bvoid\s+opals?\b|\bopals?\b/g, 'opal', 'void opals'],
  ...['tritium', 'painite', 'platinum', 'osmium', 'palladium', 'gold', 'silver', 'bromellite', 'alexandrite',
    'grandidierite', 'monazite', 'musgravite', 'rhodplumsite', 'serendibite', 'benitoite', 'bertrandite',
    'gallite', 'indite', 'coltan', 'uraninite', 'lepidolite', 'samarium']
    .map((name) => [new RegExp(`\\b${name}s?\\b`, 'g'), name, name]),
  [/\bbio(?:logical|logicals)?\b(?:\s+signals?)?/g, 'biological', 'biological signals'],
  [/\bgeo(?:logical|logicals)?\b(?:\s+signals?)?/g, 'geological', 'geological signals'],
];

// Material and signal names an AI plan may use as keywords.
export const knownKeywords = keywordRules.map(([, value]) => value);

// Words that carry no search meaning on their own. Negations ("no", "not",
// "without") are deliberately absent: the planner cannot honour them, so they
// must surface as not understood.
const fillerWords = new Set(`
  a an the any some all and or of to in on at by for from with near nearest nearby closest close around
  find search show list look looking get give me my i want need would like please can you could is are
  there here it its this that those these which where what have has having contain contains containing
  based current target location position system systems star stars planet planets world worlds body bodies
  one ones also too if possible preferably ideally prefer preferred bonus best good
  great top result results more most many few some lots hotspot hotspots hot spot spots signal signals
  mining mine minerals mineral materials material deposit deposits only just then up
`.trim().split(/\s+/));

const preferenceWords = /\b(?:prefer|preferably|preferred|ideally|bonus|if possible|nice to have)\b/;

function takeMatches(state, rules, onMatch) {
  for (const [pattern, value, label] of rules) {
    pattern.lastIndex = 0;
    if (!pattern.test(state.text)) continue;
    state.text = state.text.replace(pattern, ' ');
    onMatch(value, label);
  }
}

export function planSearchLocally(query) {
  const original = String(query ?? '').toLowerCase().replace(/[’']/g, '');
  const state = { text: ` ${original} ` };
  const understood = [];
  const ringTypes = [];
  const bodyTypes = [];
  const keywords = [];

  // Distance first, so its digits and units are not left over as unknown.
  let radiusLy = 1000;
  const radiusPattern = /\b(?:within|inside|under|less\s+than|up\s+to|no\s+more\s+than)?\s*(\d[\d,]*(?:\.\d+)?)\s*(?:ly|lys|light[-\s]?years?)\b(?:\s+(?:away|of\s+(?:me|here|the\s+target)))?/;
  const radiusMatch = state.text.match(radiusPattern);
  if (radiusMatch) {
    radiusLy = Math.max(25, Math.min(5000, Number(radiusMatch[1].replace(/,/g, ''))));
    state.text = state.text.replace(radiusPattern, ' ');
  }
  let limit = 10;
  const limitPattern = /\b(\d{1,2})\s+(?:results|systems|matches)\b/;
  const limitMatch = state.text.match(limitPattern);
  if (limitMatch) {
    limit = Math.max(3, Math.min(20, Number(limitMatch[1])));
    state.text = state.text.replace(limitPattern, ' ');
  }

  takeMatches(state, ringRules, (value, label) => {
    ringTypes.push(value);
    understood.push(label);
  });
  takeMatches(state, bodyRules, (value, label) => {
    bodyTypes.push(value);
    understood.push(label);
  });
  takeMatches(state, keywordRules, (value, label) => {
    keywords.push(value);
    understood.push(label);
  });

  const mentionsSignals = /\b(?:hot\s*spots?|signals?)\b/.test(original);
  const soft = preferenceWords.test(original);
  const requireKeywords = keywords.length > 0 && !soft;
  const requireSignals = (mentionsSignals || keywords.length > 0) && !soft;
  if (mentionsSignals && !keywords.length) understood.push(soft ? 'signals preferred' : 'has signals');
  if (soft && keywords.length) understood.push('materials preferred, not required');
  understood.push(`within ${radiusLy.toLocaleString('en-US')} ly`);

  const unknown = [...new Set(state.text.split(/[^a-z0-9-]+/)
    .map((word) => word.replace(/^-+|-+$/g, ''))
    .filter((word) => word && !fillerWords.has(word) && !/^\d+$/.test(word)))];

  return {
    plan: {
      intent: 'Find nearby systems matching the request.',
      radiusLy,
      limit,
      // Required materials are rare, so look further before giving up.
      scanLimit: requireKeywords ? 400 : 160,
      // "painite or LTDs" accepts either material; otherwise all are needed.
      filters: { ringTypes, bodyTypes, requireSignals, requireKeywords, keywordMatch: /\bor\b/.test(original) ? 'any' : 'all' },
      preferences: [],
      keywords,
    },
    understood,
    unknown,
  };
}

// Whether a body from the galaxy data is of the given planner body type.
export function bodyMatchesType(body, type) {
  const subType = String(body?.subType ?? body?.type ?? '').toLowerCase();
  switch (type) {
    case 'earthLike': return subType.includes('earth-like') || subType.includes('earth like');
    case 'waterWorld': return subType.startsWith('water world');
    case 'ammoniaWorld': return subType.startsWith('ammonia world');
    case 'waterGiant': return subType.startsWith('water giant');
    case 'gasWaterLife': return subType.includes('water based life') || subType.includes('water-based life');
    case 'gasAmmoniaLife': return subType.includes('ammonia based life') || subType.includes('ammonia-based life');
    case 'rockyIce': return subType.includes('rocky ice');
    case 'icyBody': return subType.startsWith('icy body');
    case 'highMetal': return subType.includes('high metal content');
    case 'metalRich': return subType.startsWith('metal rich') || subType.startsWith('metal-rich');
    case 'terraformable': {
      const state = String(body?.terraformingState ?? '').toLowerCase();
      return Boolean(state) && !state.startsWith('not');
    }
    default: return false;
  }
}

// Compares ignoring case, spaces, dashes, and a trailing plural "s", so
// "void opals" finds the "Void Opal" signal.
export function compactText(value) {
  return String(value ?? '').toLowerCase().replace(/[\s_-]+/g, '');
}
