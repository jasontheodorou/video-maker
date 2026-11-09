// Meanings for icon search. Each concept lists the best icons first, plus extra words to search for.
// Written for UK public sector topics. Add to it freely: names that do not exist are ignored
// (scripts/icons-check.ts lists them).

export interface Concept {
  /** Best icons for this meaning, best first. */
  icons: string[];
  /** Other words that mean the same thing, searched at a lower weight. */
  words?: string[];
}

const c = (icons: string, words = ""): Concept => ({ icons: icons.split(/\s+/).filter(Boolean), words: words.split(/\s+/).filter(Boolean) });

const groups: Array<[string, Concept]> = [
  // Money and finance
  ["money cash funds funding finance financial", c("currency-gbp coins money wallet piggy-bank hand-coins bank", "currency coins wallet")],
  ["cost costs price prices fee fees pay payment payments charge charges spend spending", c("currency-gbp credit-card receipt hand-coins money wallet", "currency payment")],
  ["pound pounds sterling gbp", c("currency-gbp coins money")],
  ["save saving savings budget", c("piggy-bank hand-coins coins wallet calculator", "savings")],
  ["tax bill bills invoice", c("receipt invoice currency-gbp calculator file-text", "receipt")],
  ["benefit benefits grant grants allowance support-payment", c("hand-coins coins currency-gbp piggy-bank hand-heart", "coins")],
  ["debt loan", c("hand-coins currency-gbp receipt scales")],
  ["bank banking", c("bank credit-card wallet")],
  // Growth and change
  ["growth grow increase rise rising improve improvement progress up", c("chart-line-up trend-up arrow-circle-up plant chart-bar", "trend chart up")],
  ["decrease decline fall falling reduce reduction down drop", c("trend-down chart-line-down arrow-circle-down arrow-down", "down")],
  ["change changes changing update updated new", c("arrows-clockwise arrows-counter-clockwise sparkle bell megaphone", "arrows")],
  ["data statistics stats figures numbers report reports results chart graph", c("chart-bar chart-pie chart-line-up presentation-chart table", "chart")],
  ["target goal goals aim objective", c("target flag-checkered trophy crosshair")],
  ["success achievement achieve win award", c("trophy medal seal-check check-circle star")],
  ["idea ideas insight innovation innovate", c("lightbulb lightbulb-filament sparkle brain")],
  ["plan planning strategy", c("map-trifold clipboard-text list-checks path signpost")],
  ["step steps process journey stage stages", c("list-numbers path steps flow-arrow signpost")],
  ["choice choose decision decide option options", c("signpost arrows-split list-checks")],
  // Safety and security
  ["security secure protect protection protected safe safety", c("shield-check lock shield lock-key fingerprint", "shield lock")],
  ["privacy private confidential data-protection", c("lock eye-slash shield-check lock-key")],
  ["password login log sign account", c("lock-key key user-circle sign-in")],
  ["identity id verify verification proof", c("identification-card fingerprint seal-check user-check")],
  ["warning warn alert danger risk hazard caution", c("warning warning-circle warning-octagon siren", "warning alert")],
  ["emergency urgent", c("siren warning phone first-aid")],
  ["police crime", c("police-car shield siren detective")],
  ["fire", c("fire fire-extinguisher fire-truck")],
  ["law legal court justice rights", c("scales gavel")],
  ["fraud scam scams", c("warning detective shield-warning lock")],
  // People
  ["team teams staff colleagues people group workforce", c("users-three users user-circle handshake", "users people")],
  ["community communities neighbours neighbourhood residents public", c("users-three house-line handshake chats", "users")],
  ["person individual resident customer user", c("user user-circle person")],
  ["family families household parents", c("users-three house baby", "users")],
  ["child children kids young youth baby babies", c("baby baby-carriage student", "baby")],
  ["older elderly aged pension pensioner retired", c("person-simple-walk hand-heart heart")],
  ["care carer carers caring", c("hand-heart heart first-aid")],
  ["volunteer volunteers volunteering charity", c("hand-heart handshake heart users-three")],
  ["partnership partner partners agreement deal trust together", c("handshake seal-check users")],
  ["equality diversity inclusion inclusive fair fairness", c("users-four scales equals")],
  ["accessibility accessible disability disabled wheelchair", c("wheelchair ear eye hand")],
  ["welcome hello greet", c("hand-waving house-line door-open")],
  ["thanks thank celebrate celebration party", c("hands-clapping confetti cake balloon heart")],
  ["job jobs work employment career careers recruit recruitment hiring vacancy vacancies apprenticeship", c("briefcase identification-badge handshake user-plus", "briefcase")],
  // Health and wellbeing
  ["health healthcare medical medicine doctor gp nurse nhs clinic hospital", c("first-aid stethoscope heartbeat hospital pill first-aid-kit", "medical")],
  ["mental wellbeing wellness mind", c("brain heart smiley hand-heart")],
  ["vaccine vaccination jab virus covid flu", c("syringe virus first-aid")],
  ["food eat eating meal meals hungry", c("fork-knife bowl-food carrot cooking-pot")],
  ["sport exercise fitness active leisure", c("person-simple-run soccer-ball barbell bicycle")],
  ["smoking smoke", c("cigarette cigarette-slash")],
  ["alcohol drink drinking", c("wine beer-bottle")],
  // Home, place and environment
  ["home homes house housing tenant tenants rent landlord", c("house house-line key buildings", "house")],
  ["council government authority civic public-sector", c("bank buildings building-office flag scales")],
  ["building buildings office offices", c("buildings building-office building")],
  ["planning construction build building-work roadworks works", c("crane hammer wrench traffic-cone hard-hat")],
  ["repair repairs fix maintenance", c("wrench hammer toolbox")],
  ["waste rubbish bin bins litter collection collections", c("trash recycle leaf truck", "trash")],
  ["recycle recycling reuse", c("recycle trash leaf arrows-clockwise")],
  ["environment environmental climate green sustainability sustainable nature eco", c("leaf tree plant globe-hemisphere-west recycle", "leaf tree")],
  ["energy power electricity", c("lightning plug battery-charging sun")],
  ["heating heat warm cold winter", c("thermometer fire snowflake house")],
  ["weather", c("cloud-sun sun cloud-rain umbrella thermometer")],
  ["water flood flooding rain", c("drop cloud-rain waves umbrella")],
  ["park parks garden gardens outdoors countryside", c("tree tree-evergreen plant flower")],
  ["animal animals pet pets dog dogs cat cats", c("dog cat paw-print")],
  ["location place address map where area local", c("map-pin map-trifold navigation-arrow compass", "map pin")],
  ["transport travel journey commute", c("bus train car bicycle road-horizon", "bus")],
  ["road roads street streets traffic driving", c("road-horizon traffic-sign car traffic-cone")],
  ["parking car cars vehicle vehicles", c("car van traffic-sign")],
  ["cycling cycle bike bikes", c("bicycle")],
  ["delivery deliver post parcel parcels", c("package truck envelope")],
  ["moving move", c("truck package house")],
  ["shop shops shopping business businesses high-street", c("storefront shopping-bag shopping-cart")],
  // Learning and culture
  ["education school schools learning learn teach teaching training course courses skills", c("graduation-cap book-open student chalkboard-teacher books", "graduation book")],
  ["library libraries book books read reading", c("books book-open book")],
  ["exam exams test qualification certificate", c("exam certificate graduation-cap")],
  ["event events meeting meetings", c("calendar users-three ticket presentation")],
  ["language languages translate translation", c("translate chat-text globe")],
  ["culture arts art museum theatre music", c("palette music-notes mask-happy ticket")],
  // Communication and services
  ["contact call phone telephone ring", c("phone phone-call chat-circle-text envelope", "phone")],
  ["email mail emails", c("envelope envelope-simple at")],
  ["message messages chat talk conversation", c("chat-circle-text chats chat-text")],
  ["help support advice assistance", c("lifebuoy question hand-heart chat-circle-text phone", "help")],
  ["question questions faq ask", c("question chat-circle-dots")],
  ["information info about", c("info question")],
  ["news announcement announce announcing launch publicity", c("megaphone newspaper bell", "megaphone")],
  ["reminder remind remember notification notify", c("bell bell-ringing alarm calendar-check", "bell")],
  ["consultation consult feedback survey opinion opinions views have-your-say", c("chat-circle-dots chats clipboard-text list-checks thumbs-up")],
  ["vote voting election elections democracy", c("check-square users-three megaphone")],
  ["online web website internet digital", c("globe desktop browser link cursor-click", "globe")],
  ["technology computer computers it tech", c("laptop desktop cpu wifi-high")],
  ["mobile phone app apps smartphone", c("device-mobile app-window")],
  ["link url address-web", c("link globe")],
  ["search find look", c("magnifying-glass binoculars")],
  ["settings options preferences", c("gear sliders")],
  ["download", c("download-simple file-arrow-down")],
  ["upload", c("upload-simple file-arrow-up")],
  ["print printing", c("printer")],
  ["video videos film watch", c("video-camera play-circle film-strip")],
  ["photo photos picture pictures image", c("camera image")],
  ["sound audio listen music", c("speaker-high music-notes headphones")],
  ["voice speak speaking microphone", c("microphone chat-text speaker-high")],
  ["quote quotes testimonial said", c("quotes chat-centered-text")],
  // Documents and actions
  ["document documents form forms application apply paperwork letter", c("file-text clipboard-text note-pencil files", "file")],
  ["sign signature contract", c("signature pen file-text")],
  ["check checklist tick done complete completed approved approve", c("check-circle seal-check list-checks check")],
  ["no not stop cancel refuse refused rejected banned", c("x-circle prohibit hand")],
  ["list lists", c("list-bullets list-checks list-numbers")],
  // Time
  ["date dates day calendar schedule deadline deadlines appointment appointments booking book-an-appointment", c("calendar calendar-check calendar-blank clock", "calendar")],
  ["time hour hours minute minutes clock", c("clock timer hourglass", "clock")],
  ["wait waiting delay delays", c("hourglass clock timer")],
  ["quick fast faster speed quickly", c("lightning timer gauge rocket-launch")],
  ["opening open hours", c("door-open clock storefront")],
  // Quality and feeling
  ["quality excellent best rating star", c("star medal seal-check")],
  ["love like care kindness kind", c("heart hand-heart")],
  ["happy happiness smile", c("smiley heart")],
  ["priority important key", c("flag star key")],
];

/** Two-word phrases (after stop words are removed) that mean something different from their words. */
const phrases: Array<[string, Concept]> = [
  ["council tax", c("receipt house currency-gbp calculator")],
  ["cost living", c("shopping-cart currency-gbp thermometer receipt")],
  ["mental health", c("brain heart hand-heart smiley")],
  ["bin collection", c("trash calendar truck recycle")],
  ["social care", c("hand-heart heart users")],
  ["public health", c("heartbeat first-aid users-three")],
  ["town hall", c("bank buildings")],
  ["high street", c("storefront shopping-bag")],
];

/** Meaning to icons. Keys are single lower-case words or two-word phrases. */
export const CONCEPTS: Record<string, Concept> = {};
for (const [keys, concept] of groups) {
  for (const k of keys.split(/\s+/)) {
    const key = k.replace(/-/g, " ");
    if (!CONCEPTS[key]) CONCEPTS[key] = concept;
  }
}
for (const [phrase, concept] of phrases) CONCEPTS[phrase] = concept;

/** British spellings and everyday words mapped to the words Phosphor's tags use. */
export const WORD_MAP: Record<string, string> = {
  colour: "color",
  colours: "colors",
  centre: "center",
  centres: "centers",
  organisation: "organization",
  organisations: "organizations",
  favourite: "favorite",
  licence: "license",
  programme: "program",
  programmes: "programs",
  catalogue: "catalog",
  neighbour: "neighbours",
  rubbish: "rubbish",
  analyse: "analyze",
  cheque: "check",
  pyjamas: "pajamas",
  aeroplane: "airplane",
  lorry: "truck",
  mobile: "mobile",
  petrol: "gas",
  postcode: "address",
  queue: "line",
  holiday: "vacation",
};

export const STOP_WORDS = new Set(["a", "an", "the", "of", "and", "or", "for", "to", "with", "in", "on", "at", "by", "icon", "icons", "symbol", "our", "your", "my", "is", "are", "be"]);
