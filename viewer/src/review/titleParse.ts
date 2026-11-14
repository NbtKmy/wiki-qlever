// Turns a Commons file name into search terms for Wikidata, plus a viewing-direction hint.
// Everything here is a guess from the file name alone, so each term says where it came from
// and the reviewer decides.

export type TermKind = 'place' | 'person' | 'text'

export type SearchTerm = {
  text: string
  kind: TermKind
  /** Why this term was extracted, shown to the reviewer and kept in the review log. */
  source: string
  /** Shown as a warning next to the term. */
  caution?: string
  born?: number
  died?: number
  /** The file name carried a Swiss canton code, e.g. "Rheinfelden AG". */
  swiss?: boolean
  /** A weak term (a noun after "im" in a description): keep only located items in the preferred country. */
  strict?: boolean
  /** Keep only humans (Q5): the term is a guess at a person's name. */
  humanOnly?: boolean
  /** Keep only items whose label contains the term as whole words ("Fritz Wunderli" is not "Fritz Wunderlich"). */
  wholeWord?: boolean
  /** The file name names a country ("Persien, Isfahan"): search and rank in that country instead. */
  country?: string
}

export type HeadingHint = {
  phrase: string
  /** Direction the camera looks, degrees clockwise from north. Coarse: one of eight directions. */
  headingDeg: number
  reading: 'looking towards' | 'seen from'
}

export type ParsedTitle = { subject: string; terms: SearchTerm[]; heading: HeadingHint | null }

const MAX_TERMS = 6

// Inventory codes that end ETH Library file names: "…-LBS H1-012345", "…-Dia 247-01234",
// "…-Com LC1500-0695-001". Some files have no "ETH-BIB-" prefix and a space before the code.
const INVENTORY = /[-\s](?:LBS|Dia|Portr|Ans|Com|Hs|PI|Fel|Rar|Ms)[ _][A-Z]{0,3}\d[\w.]*(?:-[\w.]+)*$/
// Series names that sit between the title and the inventory code.
const ETH_SERIES = /-(?:Portrait|Inlandflüge|[A-ZÄÖÜ][\wäöü]*flug \d{4})$/
const INSTITUTION = /bibliothek|library|museum|archiv|archive|sammlung|collection/i
const CANTONS =
  'AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH'
const CANTON_SUFFIX = new RegExp(`^(.+?)\\s+\\(?(?:Kt\\.\\s*)?(${CANTONS})\\)?$`)
// "Dolder Waldhaus NW" is a compass direction, not Nidwalden. These three codes count only in brackets.
const COMPASS_CODE = /\s(?:NW|NE|SO)$/
const PARTICLES = new Set(['di', 'de', 'del', 'della', 'du', 'des', 'da', 'la', 'le', 'les', 'am', 'an', 'im', 'ob', 'sur', 'sous'])
const TITLES = /^(?:(?:Prof|Dr|Ing|Dipl|Lic|Pfr)\.?\s+)+/i
const NAME_WORD = "(?:\\p{Lu}[\\p{L}'’-]+|\\p{Lu}\\.|von|van|de|der|du|di|le|la)"
// "Heiner Studer", "Gaudenz von Salis", "H. A. Stadler": two to five name-like words.
const NAME_LIKE = new RegExp(`^\\p{Lu}[\\p{L}'’.-]*(?:\\s${NAME_WORD}){1,4}$`, 'u')
// "Pommerstein bei Mols", "Göldi-Haus am Hirschenplatz", "Schmiedenhaus a. d. Limmat".
const LOCATED = /^(.+?)\s+(?:in|bei|am|an der|a\.\s?d\.|zu|ob|auf dem|auf der)\s+(\p{Lu}[\p{L}'’.-]*(?:\s\p{Lu}[\p{L}'’.-]*)*)$/u
// Commas, and full stops after a whole word ("Luzern. Göldi-Haus"), but not after "S." or "Cod.".
const PART_BREAK = /,|(?<=\p{L}{4})(?<!\bProf)\.\s+(?=[\p{Lu}\d])/u
// Two capitalised words are a person as often as a place; these openers settle it for places.
const PLACE_OPENER = /^(?:St|Sankt|Bad|La|Le|Les|San|Santa|Monte|Mont|Piz|Col|Val|Lac|Lago|Ober|Unter|Alt|Neu)\b/

// National Library ("CH-NB - …") and similar sigla at the start of a file name.
const SIGLUM = /^(?:CH-NB|CH-BAR|CH-SLA)(?:\s*-\s*|-|\s+)/
// "…-nbdig-18138-page001", "…-19304-page060": digitised books and albums.
const BOOK_PAGE = /-(?:nbdig-)?\d{4,}-(?:page)?\d+$/
// A segment that is only a shelf mark: "SLA-Schwarzenbach-A-5-08-146", "GS-GUGE-LORY-E-13", "EAD-WEHR-7008-B".
const SHELF_MARK = /^[A-Z][\w'.]*(?:-[\w'. ]+){2,}$/
// "Persien, Isfahan- Freitagsmoschee": a hyphen right after a word, then a space, separates place and topic.
const TOPIC_BREAK = /(?<=[\p{L})])-\s+(?!und\b|oder\b|bis\b)/u
// Topics that name a kind of picture, not a thing on Wikidata worth searching with the place.
const GENRES = new Set(['menschen', 'landschaft', 'alltagsszene', 'dorf', 'ort', 'bauten', 'boote', 'schulkinder', 'schiff', 'kinder', 'frauen', 'männer', 'strasse', 'strassenszene', 'markt', 'stadt', 'stadtansicht', 'gebäude', 'architektur', 'leute', 'personen', 'portrait', 'porträt', 'tiere', 'vegetation', 'reise', 'reisegruppe', 'auto', 'autos', 'fahrzeug', 'unterwegs', 'gruppe', 'innenansicht', 'ansicht', 'detail', 'szene', 'sonstiges'])
// Country names as German captions write them, with the Wikidata item of today's country.
const COUNTRIES: Record<string, string> = {
  schweiz: 'Q39', persien: 'Q794', iran: 'Q794', afghanistan: 'Q889', türkei: 'Q43', schweden: 'Q34', finnland: 'Q33',
  norwegen: 'Q20', dänemark: 'Q35', estland: 'Q191', lettland: 'Q211', litauen: 'Q37', russland: 'Q159', sowjetunion: 'Q159',
  polen: 'Q36', ostpreussen: 'Q36', deutschland: 'Q183', österreich: 'Q40', italien: 'Q38', frankreich: 'Q142',
  spanien: 'Q29', portugal: 'Q45', belgien: 'Q31', niederlande: 'Q55', holland: 'Q55', england: 'Q145', grossbritannien: 'Q145',
  irland: 'Q27', griechenland: 'Q41', ungarn: 'Q28', tschechoslowakei: 'Q213', rumänien: 'Q218', bulgarien: 'Q219',
  irak: 'Q796', syrien: 'Q858', libanon: 'Q822', palästina: 'Q801', israel: 'Q801', ägypten: 'Q79', marokko: 'Q1028',
  'spanisch-marokko': 'Q1028', tunesien: 'Q948', algerien: 'Q262', 'belgisch-kongo': 'Q974', kongo: 'Q974', angola: 'Q916',
  indien: 'Q668', 'britisch-indien': 'Q668', usa: 'Q30', amerika: 'Q30', kanada: 'Q16', mexiko: 'Q96', japan: 'Q17', china: 'Q148',
}
const UNSURE = /\s*Lokalisierung unsicher\s*/gi

const COMPASS: Record<string, number> = {
  n: 0, nord: 0, norden: 0,
  no: 45, ne: 45, nordost: 45, nordosten: 45,
  o: 90, e: 90, ost: 90, osten: 90,
  so: 135, se: 135, südost: 135, südosten: 135,
  s: 180, süd: 180, süden: 180,
  sw: 225, südwest: 225, südwesten: 225,
  w: 270, west: 270, westen: 270,
  nw: 315, nordwest: 315, nordwesten: 315,
}
const DIRECTION = Object.keys(COMPASS)
  .sort((a, b) => b.length - a.length)
  .join('|')
// "gegen Süd" names where the camera looks; "von N." / "v. N." names where it stands.
const HEADING = new RegExp(
  `(?:^|[\\s,(])((gegen|nach|richtung|von|v\\.|aus)\\s+(${DIRECTION})\\.?)(?=$|[\\s,)])`,
  'i',
)
const ALTITUDE = /,?\s*aus\s+\d[\d']*\s*m\b\.?/i

const stripExtension = (name: string) => name.replace(/\.(?:tiff?|jpe?g|png|gif|webp|svg|pdf|djvu)$/i, '')
const tidy = (text: string) => text.replace(/\s+/g, ' ').replace(/^[\s,;-]+|[\s,;-]+$/g, '')

/** The descriptive part of a file name, without institution prefix, inventory number and extension. */
export function subjectFromFileName(fileName: string): string {
  let name = fileName.replace(/^File:/i, '').replace(/_/g, ' ')
  name = stripExtension(stripExtension(name).replace(/\s*\(IMS\)$/i, ''))

  const eth = /^ETH-BIB-/.test(name)
  let rest = name.replace(/^ETH-BIB-/, '')
  const withoutInventory = rest.replace(INVENTORY, '')
  const hadInventory = withoutInventory !== rest
  // Unknown inventory code on an ETH file: fall back to cutting a last segment that is mostly a number.
  rest = hadInventory || !eth ? withoutInventory : rest.replace(/-[^-]*\d{3,}[^-]*$/, '')
  if (eth || hadInventory) return tidy(rest.replace(ETH_SERIES, ''))

  const sigla = SIGLUM.test(name)
  name = name.replace(SIGLUM, '').replace(BOOK_PAGE, '')
  const segments = name.split(/\s+[-–]\s+/)
  if (segments.length > 1) {
    if (INSTITUTION.test(segments[0])) segments.shift()
    const last = segments[segments.length - 1]
    if (segments.length > 1 && /^[\w.]*\d{4,}[\w.]*$/.test(last)) segments.pop()
    if (sigla) {
      // "Persien- Alltagsszene - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-04-177": drop the shelf
      // mark, the collection and the photographer just before the shelf mark.
      const kept: string[] = []
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]
        if (SHELF_MARK.test(segment) && /\d/.test(segment)) {
          if (kept.length > 1 && NAME_LIKE.test(kept[kept.length - 1]) && !/,/.test(kept[kept.length - 1])) kept.pop()
          continue
        }
        if (INSTITUTION.test(segment)) continue
        kept.push(segment)
      }
      return tidy(kept.join(' - '))
    }
    return tidy(segments.join(' - '))
  }
  return tidy(name)
}

export function headingFromText(text: string): HeadingHint | null {
  const match = text.match(HEADING)
  if (!match) return null
  const towards = COMPASS[match[3].toLowerCase()]
  const from = /^(?:von|v\.|aus)$/i.test(match[2])
  return {
    phrase: match[1],
    // "seen from the north" means the camera looks south.
    headingDeg: from ? (towards + 180) % 360 : towards,
    reading: from ? 'seen from' : 'looking towards',
  }
}

const PERSON_CAUTION =
  'A name in the file name can be the photographer or the owner, not the person shown. Check the image.'

function personTerm(subject: string, portrait: boolean): SearchTerm | null {
  const dated = subject.match(/^([^,()]+),\s*([^,()]+?)\s*\((\d{4})\s*[-–]\s*(\d{4})?\)/)
  if (dated) {
    return {
      text: `${dated[2].trim()} ${dated[1].trim()}`,
      kind: 'person',
      source: 'file name: "Surname, Forename (years)"',
      born: Number(dated[3]),
      ...(dated[4] ? { died: Number(dated[4]) } : {}),
    }
  }
  const plain = portrait ? subject.match(/^([^,()]+),\s*([^,()]+)$/) : null
  if (plain) {
    return { text: `${plain[2].trim()} ${plain[1].trim()}`, kind: 'person', source: 'file name of a portrait series' }
  }
  return null
}

// "Piano, di, Magadino" is one name written with commas.
function joinParticles(parts: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    if (PARTICLES.has(parts[i].toLowerCase()) && out.length > 0 && i + 1 < parts.length) {
      out[out.length - 1] = `${out[out.length - 1]} ${parts[i]} ${parts[i + 1]}`
      i++
    } else {
      out.push(parts[i])
    }
  }
  return out
}

const usable = (text: string) => text.length >= 3 && /\p{L}{3}/u.test(text) && !/[\d°]/.test(text)

export function parseTitle(fileName: string): ParsedTitle {
  const raw = stripExtension(fileName.replace(/^File:/i, '').replace(/_/g, ' '))
  const portrait = /-Portrait-|-Portr[ _]/.test(raw)
  const subject = subjectFromFileName(fileName)
  const heading = headingFromText(subject)
  const terms: SearchTerm[] = []
  const add = (term: SearchTerm) => {
    const text = tidy(term.text).replace(/\.$/, '')
    if (!usable(text)) return
    if (terms.some((t) => t.text.toLowerCase() === text.toLowerCase() && !!t.humanOnly === !!term.humanOnly)) return
    terms.push({ ...term, text })
  }

  const person = personTerm(subject, portrait)
  if (person) {
    add({ ...person, caution: PERSON_CAUTION })
    return { subject, terms, heading }
  }

  let cleaned = subject.replace(ALTITUDE, '').replace(UNSURE, ' ')
  if (heading) cleaned = cleaned.replace(heading.phrase, '')
  // "Persien, Isfahan- Freitagsmoschee": the place, then what the photo shows there.
  const [placeText, ...topicParts] = cleaned.split(TOPIC_BREAK)
  const topic = tidy(topicParts.join(' ')).replace(/\s*\([^)]*\)/g, '')
  cleaned = placeText
  let country: string | undefined
  let countryName: string | undefined
  // "Genf = Genève" gives the same place in two languages.
  for (const variant of cleaned.split(/\s+=\s+/)) {
    let parts = joinParticles(variant.split(PART_BREAK).map(tidy).filter(Boolean))
    // "Persien, Isfahan": the country is context for the other parts, not the subject.
    if (parts.length > 1 && COUNTRIES[parts[0].toLowerCase()]) {
      countryName = parts[0]
      country = COUNTRIES[parts[0].toLowerCase()]
      parts = parts.slice(1)
    }
    const inCountry = country ? { country } : {}
    const lastPlace = parts.length > 0 ? parts[parts.length - 1].replace(/\s*\([^)]*\)/g, '') : ''
    if (topic && lastPlace && !GENRES.has(topic.split(/[\s,]+/)[0].toLowerCase())) {
      add({ text: `${topic.split(',')[0]} ${lastPlace}`, kind: 'place', source: 'file name: topic and place together', ...inCountry })
    }
    // "Breitinger, Robert": two single words can be "Surname, Forename", and "Bern, Kornhaus" is the
    // Kornhaus in Bern. Search both parts together twice: once for people only, once for anything.
    if (parts.length === 2 && parts.every((p) => /^\p{Lu}\p{L}+$/u.test(p))) {
      add({
        text: `${parts[1]} ${parts[0]}`,
        kind: 'text',
        source: 'file name read as "Surname, Forename"',
        caution: `If this is a person: ${PERSON_CAUTION}`,
        // "Steckborn, Untersee" reads the same way; only people are kept for this guess.
        humanOnly: true,
        ...inCountry,
      })
      add({ text: `${parts[1]} ${parts[0]}`, kind: 'place', source: 'file name: both parts together', ...inCountry })
    }
    const before = terms.length
    parts.forEach((rawPart, index) => {
      const canton = COMPASS_CODE.test(rawPart) ? null : rawPart.match(CANTON_SUFFIX)
      const untitled = (canton ? canton[1] : rawPart).replace(TITLES, '')
      const titled = untitled !== (canton ? canton[1] : rawPart)
      // "S. Gallen" is how older captions write "St. Gallen"; "(EVP)" and "(DDR)" are not part of a label.
      const text = untitled
        .replace(/^\d+\.\s+/, '')
        .replace(COMPASS_CODE, '')
        .replace(/^S\. /, 'St. ')
        // "Die Festung St. Luzisteig": a German article is not part of a Wikidata label.
        .replace(/^(?:Die|Der|Das)\s+(?=\p{Lu})/u, '')
        .replace(/\s*\([^)]*\)$/, '')
      const where = parts.length > 1 ? `file name, part ${index + 1} of ${parts.length}` : 'file name'

      if (index === 0 && titled) {
        // "Dr. Fritz Mühlemann, Generalsekretär …"
        add({ text, kind: 'person', source: `${where}, after a title`, caution: PERSON_CAUTION })
        return
      }
      if (index === 0 && parts.length > 1 && NAME_LIKE.test(text) && !PLACE_OPENER.test(text)) {
        // "Heiner Studer, Evangelische Volkspartei": probably a person, but "Zürich Hauptbahnhof" looks the same.
        add({ text, kind: 'text', source: `${where}: may be a person's name`, caution: `If this is a person: ${PERSON_CAUTION}` })
        return
      }
      add({
        text,
        kind: 'place',
        source: where,
        ...(canton ? { swiss: true } : {}),
        ...(parts.length > 1 && index === 0
          ? { caution: 'The first part is often the wider place or the viewpoint, not the subject itself.' }
          : {}),
      })
      // "Pommerstein bei Mols": the thing before the preposition and the place after it.
      const located = text.match(LOCATED)
      if (located) {
        add({ text: located[1], kind: 'place', source: 'file name: before "in", "bei", "am" …' })
        add({
          text: located[2],
          kind: 'place',
          source: 'file name: place after "in", "bei", "am" …',
          caution: 'This says where the subject is. The place itself may not be what the photo shows.',
        })
      }
      // "Ortstock mit Tanne im Vordergrund": the subject comes before "mit".
      const withExtra = text.match(/^(.+?)\s+mit\s+\S/)
      if (withExtra) add({ text: withExtra[1], kind: 'place', source: 'file name: before "mit"' })
      // "Weisshorngipfel": the summit is the mountain.
      const summit = text.match(/^(\p{Lu}\p{L}{3,}?)-?[Gg]ipfel$/u)
      if (summit) add({ text: summit[1], kind: 'place', source: 'file name: the mountain of a summit' })
      // "Allalingletscher-Tor": the head of a hyphenated compound.
      const compound = text.match(/^(\p{L}{4,})-\p{L}+$/u)
      if (compound) {
        add({
          text: compound[1],
          kind: 'place',
          source: 'file name: first half of a hyphenated name',
          caution: 'Only part of the name matched.',
        })
      }
      // "Leningrad (Sankt Petersburg)", "Täbris (Täbriz)": the other name in brackets.
      const other = untitled.match(/\(([^)]+)\)$/)
      if (other && !/^\d/.test(other[1]) && !/^[A-ZÄÖÜ]{2,6}$/.test(other[1])) {
        add({ text: other[1].split(',')[0], kind: 'place', source: 'file name: other name in brackets' })
      }
    })
    if (country) for (let i = before; i < terms.length; i++) terms[i] = { ...terms[i], country }
  }
  if (countryName) add({ text: countryName, kind: 'place', source: 'file name: country', caution: 'The country rarely is what the photo shows.' })
  return { subject, terms: terms.slice(0, MAX_TERMS), heading }
}
