/* ==========================================================
   TOUCH GRASS — English and Swedish

   Every visible string lives here. The verdict entries are
   functions rather than templates because the sentences change
   shape with the facts, and Swedish word order is not English
   word order with different words in it.

   `d` is a decision from tgDecide(). `f` holds the formatters
   (temperature, wind, sky description) so units stay a separate
   concern from language.
   ========================================================== */

const LANG_DEFAULT = 'en';
const LANGS_AVAILABLE = [
  { code: 'en', label: 'English' },
  { code: 'sv', label: 'Svenska' }
];

// Resolved once. T() is called constantly, and re-deriving the language
// on every call is both wasteful and slightly unstable.
let LANG_CACHE = null;

function getLang() {
  if (LANG_CACHE) return LANG_CACHE;

  try {
    const saved = localStorage.getItem('touchgrass.lang');
    if (saved && TEXT[saved]) return (LANG_CACHE = saved);
  } catch { /* fall through */ }

  // First run: follow the browser, but only into a language we have.
  let picked = LANG_DEFAULT;
  try {
    for (const l of (navigator.languages || [navigator.language || ''])) {
      const code = String(l).slice(0, 2).toLowerCase();
      if (TEXT[code]) { picked = code; break; }
    }
  } catch { /* keep the default */ }

  // Write the guess down, so the notifications and the widget can't end up
  // in a different language from the page.
  try { localStorage.setItem('touchgrass.lang', picked); } catch {}
  return (LANG_CACHE = picked);
}

function saveLang(code) {
  LANG_CACHE = TEXT[code] ? code : LANG_DEFAULT;
  try { localStorage.setItem('touchgrass.lang', LANG_CACHE); } catch {}
  syncToAndroid();
}

const T = () => TEXT[getLang()] || TEXT[LANG_DEFAULT];

/* ---------- how long away, in words ---------- */

const hoursWord = {
  en: (n) => (n === 1 ? 'about an hour away' : `about ${n} hours away`),
  sv: (n) => (n === 1 ? 'om ungefär en timme' : `om ungefär ${n} timmar`)
};

const TEXT = {

/* ==========================================================
   ENGLISH
   ========================================================== */
en: {
  code: 'en',
  dir: 'ltr',

  sky: {
    0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Grey lid',
    45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Showers', 81: 'Showers', 82: 'Violent showers',
    85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunder + hail', 99: 'Thunder + hail',
    fallback: 'Weather'
  },

  hourLabel: (hr) => (hr === 0 ? 'midnight' : hr < 12 ? `${hr}am`
                    : hr === 12 ? 'noon' : `${hr - 12}pm`),

  ui: {
    title: 'Touch Grass',
    tagline: 'SHOULD YOU GO OUTSIDE? — A DECISION MACHINE',
    navToday: 'TODAY',
    navSettings: 'SETTINGS',
    thinking: 'THINKING',
    checking: 'CHECKING THE SKY…',
    checkingSub: 'Hang on, asking the atmosphere a question.',
    outsideAbility: 'OUTSIDE-ABILITY',
    barIs: 'BAR IS',

    today: 'Today',
    notYet: 'Not yet',
    onceSoFar: 'Once so far',
    timesToday: (n) => `${n} times`,
    iWentOut: '+ I WENT OUT',
    undoTitle: 'Undo one trip',
    streakRunning: (n) => `${n} days running. Don't be the one who breaks it.`,
    noStreak: 'No streak going. Today is a fine day to start one.',
    logged: (n) => `Logged. ${n} day${n === 1 ? '' : 's'} running.`,

    rightNow: 'Right now',
    locating: 'Locating…',
    somewhere: 'Somewhere',
    lastChecked: (t) => `last checked ${t}`,
    statSky: 'Sky', statTemp: 'Temp', statFeels: 'Feels',
    statWind: 'Wind', statRain: 'Rain',
    chanceOf: (n) => `${n}% chance`,

    next12: 'The next 12 hours',
    next12Hint: 'Taller bar = better grass-touching weather.',

    theYear: 'The year',
    calHint: 'Tap any day to correct it.',
    viewMonth: 'MONTH', viewYear: 'YEAR',
    dayStreak: 'DAY STREAK', daysOut: 'DAYS OUT',
    trips: 'TRIPS', bestRun: 'BEST RUN',
    none: 'none', lots: 'lots',
    months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    monthsLong: ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'],
    weekdays: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    weekdaysShort: ['M','T','W','T','F','S','S'],
    tripsOn: (n) => (n === 0 ? 'stayed in' : n === 1 ? '1 trip' : `${n} trips`),

    elsewhere: 'Somewhere else?',
    elsewhereHint: 'Blocked location, or just curious about elsewhere.',
    typeATown: 'Type a town…',
    findIt: 'FIND IT',
    useMyLocation: '◎ use my actual location',
    looking: 'Looking…',
    nothingByThatName: 'Nothing by that name. Spelling?',
    searchDown: 'Search is not answering. Try again in a moment.',
    noIdea: 'NO IDEA, SORRY',
    noIdeaSub: 'Try searching for a town below — that always works.',
    noGeo: 'This browser has no location built in.',
    geoDenied: "Couldn't get your location — it may be blocked, or you're opening this straight off disk.",
    geoNoFix: "Couldn't get a fix on where you are. Indoors, or the signal is thin.",

    // What each penalty in an hour's breakdown is called.
    tapAnHour: 'Tap an hour to see why.',
    startedAt: 'Started at',
    aboveBar: (bar) => `Clears your bar of ${bar}.`,
    belowBar: (bar) => `Short of your bar of ${bar}.`,
    notTunable: 'Safety — no dial softens this one.',
    flooredAt: 'It stops at 0; the weather had more to take.',
    factors: {
      rain: 'Rain',
      cold: 'Cold',
      heat: 'Heat',
      wind: 'Wind',
      dark: 'Dark',
      night: 'The small hours',
      dusk: 'Dusk',
      dawn: 'Dawn',
      sky: 'Sky',
      code: 'The weather itself'
    },
    footer: 'go outside',

    // trends
    restOfToday: 'rest of today',
    nextFewHours: 'next few hours',
    gettingBetter: 'getting better',
    goingDownhill: 'going downhill',
    stayingSame: 'staying much the same',
    outlookBetter: (n) => ` — best hour still to come scores ${n}.`,
    outlookWorse: ' — right now is about as good as it gets.',
    warmer: 'warmer', colder: 'colder', steady: 'steady',
    wetter: 'wetter', drying: 'drying',
    windier: 'windier', calmer: 'calmer',

    // settings
    settings: 'Settings',
    settingsTagline: 'WHAT COUNTS AS GOOD WEATHER, TO YOU',
    preview: 'PREVIEW',
    noWeatherYet: 'NO WEATHER YET',
    noWeatherSub: 'Open the Today page once so it knows where you are, then come back — the dials will preview against your actual sky.',
    noWeatherReach: "Couldn't reach the weather service, so there's nothing to preview against. The dials still save fine.",

    language: 'Language',
    languageHint: 'Everything on both pages, including the verdicts.',
    units: 'Units',
    unitsHint: 'Display only — the score is always worked out the same way.',
    temperature: 'Temperature',
    windSpeed: 'Wind speed',

    whatPutsYouOff: 'What puts you off',
    dialsHint: "Slide left if it doesn't bother you, right if it really does. Everything updates live above.",
    dialRain: 'Rain', dialCold: 'Cold', dialHeat: 'Heat',
    dialWind: 'Wind', dialDark: 'Darkness',
    dialRainLow: 'I like the rain', dialRainHigh: 'I melt',
    dialColdLow: 'I run warm', dialColdHigh: 'I feel the cold',
    dialHeatLow: 'I love the heat', dialHeatHigh: 'I wilt',
    dialWindLow: "Doesn't bother me", dialWindHigh: 'Hate the wind',
    dialDarkLow: 'Happy in the dark', dialDarkHigh: 'Daylight only',
    dialTwilight: 'Dusk & dawn',
    dialTwilightLow: 'Just more dark', dialTwilightHigh: 'The best light',
    dialRainBlurb: 'How much wet weather counts against an hour.',
    dialColdBlurb: 'How hard hours below comfortable are marked down.',
    dialHeatBlurb: 'How hard hours above comfortable are marked down.',
    dialWindBlurb: 'How much a stiff breeze puts you off.',
    dialDarkBlurb: 'How much darkness — and 3am especially — counts against.',
    dialTwilightBlurb: 'The half-light hour after sunset and before sunrise. This one runs the other way: slide right if you love it.',
    skiesTitle: 'Kinds of weather',
    skiesBlurb: "How much you like each kind of sky, on top of getting wet — the rain dial still handles that. Thunder isn't here: it always counts, for safety.",
    skyKinds: {
      clear: 'Clear sky', mostlyClear: 'Mostly clear', partly: 'Partly cloudy',
      overcast: 'Overcast', fog: 'Fog', drizzle: 'Drizzle',
      rain: 'Rain & showers', snow: 'Snow', freezing: 'Freezing rain & sleet'
    },
    skyRatings: ['Love it', 'Like it', 'Fine', 'Not keen', 'Hate it'],
    dialTwilightWords: ['just more dark', 'mostly dark', 'a bit dark', 'fine light', 'nice light', 'lovely', 'the best light'],
    dialWords: ["don't care", 'barely', 'a bit', 'normal', 'quite a lot', 'a lot', 'deal-breaker'],

    nudges: 'Nudges',
    nudgesBrowser: 'Reminders only work in the Android app — in a browser this section does nothing.',
    nudgesAndroid: 'These run in the background. Battery use is tiny — one weather check an hour, only inside the hours you set.',
    remindMe: "Remind me if I haven't been out",
    atASetTime: 'AT A SET TIME', beforeSunset: 'BEFORE SUNSET',
    nudgeMeAt: 'Nudge me at',
    hoursBeforeSunset: 'Hours before sunset',
    atSunset: 'at sunset',
    hBefore: (n) => `${n}h before`,
    asTheSunSets: 'As the sun sets', sixHoursBefore: 'Six hours before',
    sunsetWhy: 'A fixed time is wrong half the year — 5pm is mid-afternoon in June and long dark in December. This follows the daylight.',
    sunsetToday: (s, n) => `Sunset today is ${s}, so today's nudge would land at ${n}.`,
    sunsetRef: (s) => `For reference, sunset today is ${s}.`,
    sunsetPending: 'Sunset time will show once the weather has loaded.',
    oneNudgeADay: 'One nudge a day, and only if the day is still empty.',
    tellMeGood: "Tell me when it's genuinely good out",
    watchBlurb: "Checks the sky through the day and speaks up when a window opens that beats your normal bar — so a rare good afternoon in November doesn't pass you by.",
    worthInterrupting: 'Worth interrupting me at',
    anyDecentHour: 'Any decent hour', onlyGlorious: 'Only glorious ones',
    onlyBetween: 'Only between', and: 'and',
    nothingAt3am: 'Nothing will wake you at 3am.',
    makeItAnAlarm: 'Make it an alarm, not a whisper',
    alarmBlurb: 'Rings and shows full screen instead of sitting quietly in the shade. Still never outside the hours above.',
    sendTestNudge: 'SEND A TEST NUDGE',
    testSent: 'Sent. It should appear in a moment.',
    testFailed: "Couldn't send a test just now.",
    testBrowser: 'Only the Android app can send notifications.',

    howFussy: 'How fussy are you?',
    theBarHint: 'An hour has to beat this score before it counts as "good". Lower it and you’ll be sent out in more weather.',
    theBar: 'The bar',
    goOutInAnything: 'Go out in anything', onlyPerfectDays: 'Only perfect days',

    cantTurnOff: "What you can't turn off",
    safetyBlurb: 'Dangerous heat (feels like 38°C or more), dangerous cold (−15°C or less) and lightning always override the dials. In those conditions the app points you at the safest hour instead of the nearest one — no slider will talk it into sending you out into a thunderstorm.',
    houseRuleBlurb: 'Otherwise: if you haven’t been out yet today, it will never tell you to stay in. The worst it will say is "not yet, go at four".',

    yourData: 'Your data',
    dataBlurb: "Everything lives in this browser's local storage — nothing is sent anywhere, and there's no account. Clearing site data wipes your year, so if a long streak starts to mean something, keep a copy of this text.",
    copy: 'COPY', restore: 'RESTORE FROM TEXT',
    copied: 'Copied. Paste it somewhere safe.',
    pressCtrlC: 'Press Ctrl+C to copy the selected text.',
    notValid: "That isn't valid data — nothing was changed.",
    restored: 'Restored.',
    startOver: 'Start over',
    startOverHint: 'Puts every dial back where it started. Leaves your year alone.',
    resetDials: 'RESET THE DIALS',

    // since you were last out
    neverOut: 'No trips logged yet.',
    agoMinutes: (n) => (n < 2 ? 'Last out just now' : `Last out ${n} minutes ago`),
    agoHours: (n) => (n === 1 ? 'Last out an hour ago' : `Last out ${n} hours ago`),
    agoDays: (n) => (n === 1 ? 'Last out yesterday' : `Last out ${n} days ago`),
    agoToday: 'Last out earlier today',
    agoYesterday: 'Last out yesterday',

    // the record, now its own page
    navRecord: 'THE YEAR',
    recordTagline: 'EVERY DAY YOU GOT OUT',
    backToToday: '\u2039 TODAY',

    // sources
    sources: 'Where this comes from',
    sourceWeather: 'Weather and forecast',
    sourceSun: 'Sunrise and sunset',
    sourcePlace: 'Town search',
    openMeteo: 'Open-Meteo',
    sourcesBlurb: 'Free, open weather data. No API key, no account, and your coordinates are sent to nobody else.',
    sourceLicence: 'MET Norway: NLOD / CC BY 4.0. SMHI: CC BY 4.0. Open-Meteo: CC BY 4.0.',
    updated: (t) => `Fetched ${t}.`,
    blendedFrom: 'Blended from',
    sourceWeight: (name, pct) => `${name} ${pct}%`,

    // data
    dataSummary: (days, trips) => `${days} days logged, ${trips} trips in all.`,
    dataSummaryEmpty: 'Nothing logged yet.',
    share: 'SHARE / EMAIL IT',
    showTheData: 'Show the raw text',
    hideTheData: 'Hide the raw text',
    shared: 'Opening the share sheet\u2026',
    shareFailed: "Couldn't open the share sheet. Copy the text instead.",
    downloaded: 'Saved as a file.',
    dataAdvice: 'Send it to yourself, or save it to Drive or Files. Any copy will restore.'
  },

  verdict: {
    go: (d, f) => ({
      tag: 'VERDICT', line: 'GO OUTSIDE',
      sub: `${f.sky(d.nowCode)}, feels like ${f.tempNum(d.nowFeels)}°. This is the good stuff and it is happening without you. Shoes. Door. Now.`
    }),
    goAgain: (d, f) => ({
      tag: 'GO AGAIN', line: 'GO OUT AGAIN',
      sub: `You've been out ${d.visits === 1 ? 'once' : d.visits + ' times'} today already. But it's ${f.sky(d.nowCode).toLowerCase()} and ${f.tempNum(d.nowFeels)}° — this is seconds territory.`
    }),
    wait: (d, f) => ({
      tag: 'HOLD ON', line: 'WAIT, THEN GO',
      sub: `Right now it's ${f.sky(d.nowCode).toLowerCase()} and not worth it. But ${f.cap(d.target.label)} looks properly good — ${f.soon(d.target.hoursFromNow)}. That's your one for today.`
    }),
    waitAgain: (d, f) => ({
      tag: 'IF YOU LIKE', line: 'YOU COULD GO AGAIN',
      sub: `Today's already in the bag — ${d.visits === 1 ? 'one trip' : d.visits + ' trips'}. It's not much out there now, but ${f.cap(d.target.label)} looks good if you fancy another.`
    }),
    waitDark: (d, f) => ({
      tag: 'IT IS DARK', line: 'GO WHEN IT IS LIGHT',
      sub: `It's dark and ${f.tempNum(d.nowFeels)}° out. Light comes back around ${d.target.label} — go then, even briefly. Grass is easier to touch when you can see it.`
    }),
    waitNight: (d, f) => ({
      tag: 'NOT AT 3AM', line: 'GO LATER TODAY',
      sub: d.target
        ? `It's the middle of the night. ${f.cap(d.target.label)} is the best this day has to offer — go then, even for ten minutes.`
        : `It's the middle of the night. Get some sleep, then go out at the first reasonable hour — that's all today asks.`
    }),
    waitRisky: (d, f) => ({
      tag: 'NOT YET', line: 'WAIT — GO LATER',
      sub: `${f.why(d.risk, d.nowFeels)} Don't force this one. ${f.cap(d.target.label)} is the safest bet — ${f.soon(d.target.hoursFromNow)}. Even ten minutes then still counts.`
    }),
    waitRiskyNoGap: (d, f) => ({
      tag: 'CAREFUL', line: 'WAIT FOR A GAP',
      sub: `${f.why(d.risk, d.nowFeels)} Keep an eye out and step out for a few minutes the moment it eases — that's all today needs to be.`
    }),
    anywaysBest: (d, f) => ({
      tag: 'NO EXCUSES', line: 'GO OUT ANYWAYS',
      sub: `It's ${f.sky(d.nowCode).toLowerCase()} and today never really gets good. ${f.cap(d.target.label)} is the least-bad hour going — take it, twenty minutes, coat on. No negotiating.`
    }),
    anyways: (d, f) => ({
      tag: 'NO EXCUSES', line: 'GO OUT ANYWAYS',
      sub: `It's ${f.sky(d.nowCode).toLowerCase()} and it is not getting better today. This is as good as it gets, so this is the one you take. Coat, twenty minutes, no negotiating.`
    }),
    stayin: (d, f) => ({
      tag: 'OFF THE HOOK', line: 'STAY IN. YOU EARNED IT.',
      sub: `${f.sky(d.nowCode)} now, and nothing better is coming. You already went out today, so the day is discharged. Stay warm.`
    })
  },

  why: {
    hot: (t) => `It feels like ${t}° out there — that's not a walk, that's a medical event.`,
    cold: (t) => `It feels like ${t}°, which is the kind of cold that bites.`,
    storm: () => 'There is lightning going on out there.'
  },

  soon: (n) => {
    if (n <= 4) return `${hoursWord.en(n)}, so put the kettle on`;
    if (n <= 7) return `${n} hours off — that's a later-today plan`;
    return `${n} hours off, so set something to remind you`;
  },

  // Short forms, for the home-screen widget.
  widget: {
    go: 'Go outside',
    goAgain: 'Go out again',
    wait: (l) => `Wait — go at ${l}`,
    waitAgain: (l) => `Optional — ${l} looks good`,
    waitDark: (l) => `Go when it's light, ${l}`,
    waitNight: (l) => (l ? `Go later — ${l}` : 'Go later today'),
    waitRisky: (l) => `Not yet — try ${l}`,
    waitRiskyNoGap: 'Wait for a gap',
    anywaysBest: (l) => `Go anyway — ${l} is least bad`,
    anyways: 'Go out anyways',
    stayin: "Stay in. You've earned it.",
    tapToLog: 'Tap to log a trip',
    beenOut: (n) => (n === 1 ? 'Out once today' : `Out ${n} times today`),
    notOut: 'Not out yet today'
  }
},

/* ==========================================================
   SVENSKA
   ========================================================== */
sv: {
  code: 'sv',
  dir: 'ltr',

  sky: {
    0: 'Klart', 1: 'Mest klart', 2: 'Halvklart', 3: 'Grått lock',
    45: 'Dimma', 48: 'Underkyld dimma',
    51: 'Lätt duggregn', 53: 'Duggregn', 55: 'Tätt duggregn',
    56: 'Underkylt duggregn', 57: 'Underkylt duggregn',
    61: 'Lätt regn', 63: 'Regn', 65: 'Kraftigt regn',
    66: 'Underkylt regn', 67: 'Underkylt regn',
    71: 'Lätt snöfall', 73: 'Snö', 75: 'Kraftigt snöfall', 77: 'Kornsnö',
    80: 'Skurar', 81: 'Skurar', 82: 'Kraftiga skurar',
    85: 'Snöbyar', 86: 'Snöbyar',
    95: 'Åska', 96: 'Åska och hagel', 99: 'Åska och hagel',
    fallback: 'Väder'
  },

  hourLabel: (hr) => (hr === 0 ? 'midnatt' : `kl ${hr}`),

  ui: {
    title: 'Touch Grass',
    tagline: 'SKA DU GÅ UT? — EN BESLUTSMASKIN',
    navToday: 'IDAG',
    navSettings: 'INSTÄLLNINGAR',
    thinking: 'TÄNKER',
    checking: 'KIKAR PÅ HIMLEN…',
    checkingSub: 'Ett ögonblick, jag frågar atmosfären.',
    outsideAbility: 'UTOMHUSVÄRDE',
    barIs: 'GRÄNSEN ÄR',

    today: 'Idag',
    notYet: 'Inte än',
    onceSoFar: 'En gång hittills',
    timesToday: (n) => `${n} gånger`,
    iWentOut: '+ JAG VAR UTE',
    undoTitle: 'Ångra en tur',
    streakRunning: (n) => `${n} dagar i rad. Var inte den som bryter det.`,
    noStreak: 'Ingen svit igång. Idag är en utmärkt dag att börja en.',
    logged: (n) => `Noterat. ${n} ${n === 1 ? 'dag' : 'dagar'} i rad.`,

    rightNow: 'Just nu',
    locating: 'Letar upp dig…',
    somewhere: 'Någonstans',
    lastChecked: (t) => `senast kollat ${t}`,
    statSky: 'Himmel', statTemp: 'Temp', statFeels: 'Känns som',
    statWind: 'Vind', statRain: 'Regn',
    chanceOf: (n) => `${n}% risk`,

    next12: 'De närmaste 12 timmarna',
    next12Hint: 'Högre stapel = bättre väder för att röra gräs.',

    theYear: 'Året',
    calHint: 'Tryck på en dag för att rätta den.',
    viewMonth: 'MÅNAD', viewYear: 'ÅR',
    dayStreak: 'DAGAR I RAD', daysOut: 'DAGAR UTE',
    trips: 'TURER', bestRun: 'BÄSTA SVIT',
    none: 'inga', lots: 'många',
    months: ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'],
    monthsLong: ['Januari','Februari','Mars','April','Maj','Juni',
                 'Juli','Augusti','September','Oktober','November','December'],
    weekdays: ['Mån','Tis','Ons','Tor','Fre','Lör','Sön'],
    weekdaysShort: ['M','T','O','T','F','L','S'],
    tripsOn: (n) => (n === 0 ? 'stannade inne' : n === 1 ? '1 tur' : `${n} turer`),

    elsewhere: 'Någon annanstans?',
    elsewhereHint: 'Blockerad plats, eller bara nyfiken på annat håll.',
    typeATown: 'Skriv en ort…',
    findIt: 'HITTA',
    useMyLocation: '◎ använd min riktiga plats',
    looking: 'Letar…',
    nothingByThatName: 'Hittar inget med det namnet. Stavning?',
    searchDown: 'Sökningen svarar inte. Försök igen om en stund.',
    noIdea: 'INGEN ANING, TYVÄRR',
    noIdeaSub: 'Prova att söka efter en ort nedan — det funkar alltid.',
    noGeo: 'Den här webbläsaren har ingen platstjänst.',
    geoDenied: 'Kunde inte hämta din plats — den kan vara blockerad, eller så öppnade du filen direkt från disk.',
    geoNoFix: 'Fick ingen fix på var du är. Inomhus, eller så är signalen tunn.',

    tapAnHour: 'Tryck på en timme för att se varför.',
    startedAt: 'Började på',
    aboveBar: (bar) => `Klarar din gräns på ${bar}.`,
    belowBar: (bar) => `Under din gräns på ${bar}.`,
    notTunable: 'Säkerhet — ingen ratt mjukar upp den här.',
    flooredAt: 'Det stannar på 0; vädret hade mer att ta.',
    factors: {
      rain: 'Regn',
      cold: 'Kyla',
      heat: 'Värme',
      wind: 'Vind',
      dark: 'Mörker',
      night: 'Småtimmarna',
      dusk: 'Skymning',
      dawn: 'Gryning',
      sky: 'Himlen',
      code: 'Själva vädret'
    },
    footer: 'gå ut',

    restOfToday: 'resten av dagen',
    nextFewHours: 'de närmaste timmarna',
    gettingBetter: 'blir bättre',
    goingDownhill: 'blir sämre',
    stayingSame: 'ligger ungefär still',
    outlookBetter: (n) => ` — bästa timmen som återstår ger ${n}.`,
    outlookWorse: ' — just nu är ungefär så bra som det blir.',
    warmer: 'varmare', colder: 'kallare', steady: 'oförändrat',
    wetter: 'blötare', drying: 'torkar upp',
    windier: 'blåsigare', calmer: 'lugnare',

    settings: 'Inställningar',
    settingsTagline: 'VAD SOM RÄKNAS SOM BRA VÄDER, FÖR DIG',
    preview: 'FÖRHANDSVISNING',
    noWeatherYet: 'INGET VÄDER ÄN',
    noWeatherSub: 'Öppna Idag-sidan en gång så att appen vet var du är, och kom sedan tillbaka — då förhandsvisas rattarna mot din verkliga himmel.',
    noWeatherReach: 'Kunde inte nå vädertjänsten, så det finns inget att förhandsvisa mot. Rattarna sparas ändå.',

    language: 'Språk',
    languageHint: 'Allt på båda sidorna, inklusive utlåtandena.',
    units: 'Enheter',
    unitsHint: 'Bara visning — poängen räknas alltid ut på samma sätt.',
    temperature: 'Temperatur',
    windSpeed: 'Vindhastighet',

    whatPutsYouOff: 'Vad avskräcker dig',
    dialsHint: 'Dra åt vänster om det inte stör dig, åt höger om det verkligen gör det. Allt uppdateras direkt ovanför.',
    dialRain: 'Regn', dialCold: 'Kyla', dialHeat: 'Värme',
    dialWind: 'Vind', dialDark: 'Mörker',
    dialRainLow: 'Jag gillar regn', dialRainHigh: 'Jag smälter',
    dialColdLow: 'Jag är varm av mig', dialColdHigh: 'Jag fryser lätt',
    dialHeatLow: 'Jag älskar värme', dialHeatHigh: 'Jag vissnar',
    dialWindLow: 'Stör mig inte', dialWindHigh: 'Avskyr blåst',
    dialDarkLow: 'Trivs i mörkret', dialDarkHigh: 'Bara i dagsljus',
    dialTwilight: 'Skymning & gryning',
    dialTwilightLow: 'Bara mer mörker', dialTwilightHigh: 'Dagens bästa ljus',
    dialRainBlurb: 'Hur mycket väta drar ner en timme.',
    dialColdBlurb: 'Hur hårt timmar under behagligt straffas.',
    dialHeatBlurb: 'Hur hårt timmar över behagligt straffas.',
    dialWindBlurb: 'Hur mycket en frisk vind avskräcker dig.',
    dialDarkBlurb: 'Hur mycket mörker — och särskilt kl 3 — drar ner.',
    dialTwilightBlurb: 'Halvljustimmen efter solnedgången och före soluppgången. Den här går åt andra hållet: dra åt höger om du älskar den.',
    skiesTitle: 'Olika sorters väder',
    skiesBlurb: 'Hur mycket du gillar varje sorts himmel, utöver att bli blöt — det sköter regnratten fortfarande. Åska finns inte här: den räknas alltid, för säkerhetens skull.',
    skyKinds: {
      clear: 'Klart', mostlyClear: 'Mest klart', partly: 'Halvklart',
      overcast: 'Mulet', fog: 'Dimma', drizzle: 'Duggregn',
      rain: 'Regn & skurar', snow: 'Snö', freezing: 'Underkylt regn & snöblandat'
    },
    skyRatings: ['Älskar', 'Gillar', 'Okej', 'Inte så förtjust', 'Hatar'],
    dialTwilightWords: ['bara mörker', 'mest mörkt', 'lite mörkt', 'fint ljus', 'vackert ljus', 'underbart', 'dagens bästa ljus'],
    dialWords: ['struntar i', 'knappt', 'lite', 'normalt', 'ganska mycket', 'mycket', 'helt avgörande'],

    nudges: 'Påminnelser',
    nudgesBrowser: 'Påminnelser fungerar bara i Android-appen — i en webbläsare gör det här avsnittet ingenting.',
    nudgesAndroid: 'De här körs i bakgrunden. Batteriåtgången är minimal — en väderkoll i timmen, bara under de timmar du valt.',
    remindMe: 'Påminn mig om jag inte varit ute',
    atASetTime: 'VID EN BESTÄMD TID', beforeSunset: 'FÖRE SOLNEDGÅNG',
    nudgeMeAt: 'Påminn mig kl',
    hoursBeforeSunset: 'Timmar före solnedgång',
    atSunset: 'vid solnedgång',
    hBefore: (n) => `${n} h före`,
    asTheSunSets: 'När solen går ner', sixHoursBefore: 'Sex timmar före',
    sunsetWhy: 'En fast tid blir fel halva året — kl 17 är eftermiddag i juni och kolmörkt i december. Det här följer dagsljuset.',
    sunsetToday: (s, n) => `Solen går ner ${s} idag, så påminnelsen skulle komma ${n}.`,
    sunsetRef: (s) => `Som referens: solen går ner ${s} idag.`,
    sunsetPending: 'Solnedgången visas när vädret har laddats.',
    oneNudgeADay: 'En påminnelse om dagen, och bara om dagen fortfarande är tom.',
    tellMeGood: 'Säg till när det är riktigt fint ute',
    watchBlurb: 'Håller koll på himlen under dagen och säger till när ett fönster öppnar sig som slår din vanliga gräns — så att en ovanligt fin novembereftermiddag inte passerar obemärkt.',
    worthInterrupting: 'Värt att störa mig vid',
    anyDecentHour: 'Vilken hygglig timme som helst', onlyGlorious: 'Bara de lysande',
    onlyBetween: 'Bara mellan', and: 'och',
    nothingAt3am: 'Ingenting väcker dig kl 3.',
    makeItAnAlarm: 'Gör det till ett larm, inte en viskning',
    alarmBlurb: 'Ringer och visas i helskärm i stället för att ligga tyst i skuggan. Fortfarande aldrig utanför tiderna ovan.',
    sendTestNudge: 'SKICKA EN TESTPÅMINNELSE',
    testSent: 'Skickad. Den bör dyka upp strax.',
    testFailed: 'Kunde inte skicka ett test just nu.',
    testBrowser: 'Bara Android-appen kan skicka notiser.',

    howFussy: 'Hur kräsen är du?',
    theBarHint: 'En timme måste slå den här poängen för att räknas som "bra". Sänk den så skickas du ut i mer väder.',
    theBar: 'Gränsen',
    goOutInAnything: 'Gå ut i vad som helst', onlyPerfectDays: 'Bara perfekta dagar',

    cantTurnOff: 'Vad du inte kan stänga av',
    safetyBlurb: 'Farlig värme (känns som 38 °C eller mer), farlig kyla (−15 °C eller mindre) och åska går alltid före rattarna. Under sådana förhållanden pekar appen på den säkraste timmen i stället för den närmaste — ingen reglage övertalar den att skicka ut dig i ett åskväder.',
    houseRuleBlurb: 'I övrigt: har du inte varit ute idag säger den aldrig åt dig att stanna inne. Det värsta den säger är "inte än, gå kl fyra".',

    yourData: 'Dina data',
    dataBlurb: 'Allt ligger i den här webbläsarens lokala lagring — ingenting skickas någonstans och det finns inget konto. Rensar du webbplatsdata försvinner ditt år, så om en lång svit börjar betyda något: spara en kopia av den här texten.',
    copy: 'KOPIERA', restore: 'ÅTERSTÄLL FRÅN TEXT',
    copied: 'Kopierat. Klistra in det någonstans säkert.',
    pressCtrlC: 'Tryck Ctrl+C för att kopiera den markerade texten.',
    notValid: 'Det där är inte giltiga data — ingenting ändrades.',
    restored: 'Återställt.',
    startOver: 'Börja om',
    startOverHint: 'Ställer tillbaka varje ratt. Lämnar ditt år orört.',
    resetDials: 'ÅTERSTÄLL RATTARNA',

    // sedan du var ute sist
    neverOut: 'Inga turer noterade än.',
    agoMinutes: (n) => (n < 2 ? 'Ute senast alldeles nyss' : `Ute senast för ${n} minuter sedan`),
    agoHours: (n) => (n === 1 ? 'Ute senast för en timme sedan' : `Ute senast för ${n} timmar sedan`),
    agoDays: (n) => (n === 1 ? 'Ute senast igår' : `Ute senast för ${n} dagar sedan`),
    agoToday: 'Ute senast tidigare idag',
    agoYesterday: 'Ute senast igår',

    navRecord: '\u00c5RET',
    recordTagline: 'VARJE DAG DU TOG DIG UT',
    backToToday: '\u2039 IDAG',

    sources: 'Varifrån det kommer',
    sourceWeather: 'Väder och prognos',
    sourceSun: 'Soluppgång och solnedgång',
    sourcePlace: 'Ortsökning',
    openMeteo: 'Open-Meteo',
    sourcesBlurb: 'Fria, öppna väderdata. Ingen API-nyckel, inget konto, och dina koordinater skickas inte till någon annan.',
    sourceLicence: 'MET Norway: NLOD / CC BY 4.0. SMHI: CC BY 4.0. Open-Meteo: CC BY 4.0.',
    updated: (t) => `Hämtat ${t}.`,
    blendedFrom: 'Sammanvägt från',
    sourceWeight: (name, pct) => `${name} ${pct} %`,

    dataSummary: (days, trips) => `${days} dagar noterade, ${trips} turer totalt.`,
    dataSummaryEmpty: 'Inget noterat än.',
    share: 'DELA / MEJLA',
    showTheData: 'Visa råtexten',
    hideTheData: 'Dölj råtexten',
    shared: 'Öppnar delningsrutan\u2026',
    shareFailed: 'Kunde inte öppna delningsrutan. Kopiera texten i stället.',
    downloaded: 'Sparad som fil.',
    dataAdvice: 'Skicka den till dig själv, eller spara den i Drive eller Filer. Vilken kopia som helst går att återställa.'
  },

  verdict: {
    go: (d, f) => ({
      tag: 'UTLÅTANDE', line: 'GÅ UT',
      sub: `${f.sky(d.nowCode)}, känns som ${f.tempNum(d.nowFeels)}°. Det här är det fina, och det pågår utan dig. Skor. Dörr. Nu.`
    }),
    goAgain: (d, f) => ({
      tag: 'GÅ IGEN', line: 'GÅ UT IGEN',
      sub: `Du har redan varit ute ${d.visits === 1 ? 'en gång' : d.visits + ' gånger'} idag. Men det är ${f.sky(d.nowCode).toLowerCase()} och ${f.tempNum(d.nowFeels)}° — det här är påfyllnadsväder.`
    }),
    wait: (d, f) => ({
      tag: 'VÄNTA LITE', line: 'VÄNTA, GÅ SEN',
      sub: `Just nu är det ${f.sky(d.nowCode).toLowerCase()} och inte värt det. Men ${d.target.label} ser riktigt bra ut — ${f.soon(d.target.hoursFromNow)}. Det är din tur för idag.`
    }),
    waitAgain: (d, f) => ({
      tag: 'OM DU VILL', line: 'DU SKULLE KUNNA GÅ IGEN',
      sub: `Dagen är redan avklarad — ${d.visits === 1 ? 'en tur' : d.visits + ' turer'}. Det är inte mycket där ute nu, men ${d.target.label} ser fint ut om du är sugen på en till.`
    }),
    waitDark: (d, f) => ({
      tag: 'DET ÄR MÖRKT', line: 'GÅ NÄR DET ÄR LJUST',
      sub: `Det är mörkt och ${f.tempNum(d.nowFeels)}° ute. Ljuset kommer tillbaka runt ${d.target.label} — gå då, om än kort. Gräs är lättare att röra när man ser det.`
    }),
    waitNight: (d, f) => ({
      tag: 'INTE KL 3', line: 'GÅ SENARE IDAG',
      sub: d.target
        ? `Det är mitt i natten. ${f.cap(d.target.label)} är det bästa dagen har att erbjuda — gå då, om så bara i tio minuter.`
        : 'Det är mitt i natten. Sov lite, och gå ut vid första rimliga timme — mer begär inte dagen.'
    }),
    waitRisky: (d, f) => ({
      tag: 'INTE ÄN', line: 'VÄNTA — GÅ SENARE',
      sub: `${f.why(d.risk, d.nowFeels)} Tvinga inte fram den här. ${f.cap(d.target.label)} är säkrast — ${f.soon(d.target.hoursFromNow)}. Även tio minuter då räknas.`
    }),
    waitRiskyNoGap: (d, f) => ({
      tag: 'FÖRSIKTIGT', line: 'VÄNTA PÅ EN LUCKA',
      sub: `${f.why(d.risk, d.nowFeels)} Håll utkik och kliv ut några minuter så fort det lättar — mer behöver dagen inte bli.`
    }),
    anywaysBest: (d, f) => ({
      tag: 'INGA URSÄKTER', line: 'GÅ UT ÄNDÅ',
      sub: `Det är ${f.sky(d.nowCode).toLowerCase()} och dagen blir aldrig riktigt bra. ${f.cap(d.target.label)} är den minst dåliga timmen — ta den, tjugo minuter, jacka på. Inget tjafs.`
    }),
    anyways: (d, f) => ({
      tag: 'INGA URSÄKTER', line: 'GÅ UT ÄNDÅ',
      sub: `Det är ${f.sky(d.nowCode).toLowerCase()} och det blir inte bättre idag. Så bra blir det, alltså är det den här du tar. Jacka, tjugo minuter, inget tjafs.`
    }),
    stayin: (d, f) => ({
      tag: 'FRIAD', line: 'STANNA INNE. DU FÖRTJÄNAR DET.',
      sub: `${f.sky(d.nowCode)} nu, och inget bättre är på väg. Du har redan varit ute idag, så dagen är avklarad. Håll dig varm.`
    })
  },

  why: {
    hot: (t) => `Det känns som ${t}° där ute — det är ingen promenad, det är en medicinsk händelse.`,
    cold: (t) => `Det känns som ${t}°, den sortens kyla som biter.`,
    storm: () => 'Det åskar där ute.'
  },

  soon: (n) => {
    if (n <= 4) return `${hoursWord.sv(n)}, så sätt på tevatten`;
    if (n <= 7) return `om ${n} timmar — det blir en senare-idag-plan`;
    return `om ${n} timmar, så ställ något som påminner dig`;
  },

  widget: {
    go: 'Gå ut',
    goAgain: 'Gå ut igen',
    wait: (l) => `Vänta — gå ${l}`,
    waitAgain: (l) => `Frivilligt — ${l} ser fint ut`,
    waitDark: (l) => `Gå när det är ljust, ${l}`,
    waitNight: (l) => (l ? `Gå senare — ${l}` : 'Gå senare idag'),
    waitRisky: (l) => `Inte än — prova ${l}`,
    waitRiskyNoGap: 'Vänta på en lucka',
    anywaysBest: (l) => `Gå ändå — ${l} är minst dålig`,
    anyways: 'Gå ut ändå',
    stayin: 'Stanna inne. Du förtjänar det.',
    tapToLog: 'Tryck för att notera en tur',
    beenOut: (n) => (n === 1 ? 'Ute en gång idag' : `Ute ${n} gånger idag`),
    notOut: 'Inte ute än idag'
  }
}

};
