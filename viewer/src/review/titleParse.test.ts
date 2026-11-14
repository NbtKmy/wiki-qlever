import { describe, expect, it } from 'vitest'
import { headingFromText, parseTitle, subjectFromFileName } from './titleParse'

const texts = (fileName: string) => parseTitle(fileName).terms.map((t) => t.text)

describe('subjectFromFileName', () => {
  it('strips the ETH prefix, the inventory code and the series name', () => {
    expect(subjectFromFileName('ETH-BIB-Amden-LBS H1-012345.tif')).toBe('Amden')
    expect(subjectFromFileName('File:ETH-BIB-Jungfraujoch,_Mönch,_NW-Flanke-Dia_247-01234.tif')).toBe(
      'Jungfraujoch, Mönch, NW-Flanke',
    )
    expect(subjectFromFileName('ETH-BIB-Stierkampf in Sevilla-Nordafrikaflug 1932-LBS MH02-13-0123.tif')).toBe(
      'Stierkampf in Sevilla',
    )
    expect(subjectFromFileName('ETH-BIB-Schröter, Carl (1855-1939)-Portrait-Portr 12345.tif (IMS).tif')).toBe(
      'Schröter, Carl (1855-1939)',
    )
  })
  it('falls back to cutting a numeric last segment for an unknown ETH inventory code', () => {
    expect(subjectFromFileName('ETH-BIB-Davos-XYZ 00123.tif')).toBe('Davos')
    expect(subjectFromFileName('ETH-BIB-Allalingletscher-Tor-Dia 247-00012.tif')).toBe('Allalingletscher-Tor')
  })
  it('drops the institution and the record number around " - "', () => {
    expect(subjectFromFileName('Zentralbibliothek Zürich - Escherdenkmal - 991028231679705501.jpg')).toBe(
      'Escherdenkmal',
    )
    expect(subjectFromFileName('ETH-Bibliothek Zürich, Bildarchiv - Rapperswil - Hafen.jpg')).toBe('Rapperswil - Hafen')
  })
  it('keeps a plain file name', () => {
    expect(subjectFromFileName('Matterhorn from Zermatt.jpg')).toBe('Matterhorn from Zermatt')
  })
})

describe('headingFromText', () => {
  it('reads "gegen" as the direction the camera looks', () => {
    expect(headingFromText('Zürich, Limmatquai gegen Süd')).toEqual({
      phrase: 'gegen Süd',
      headingDeg: 180,
      reading: 'looking towards',
    })
    expect(headingFromText('Basel, Rhein, gegen NW')?.headingDeg).toBe(315)
  })
  it('turns "seen from" around', () => {
    expect(headingFromText('Säntis von N.')).toEqual({ phrase: 'von N.', headingDeg: 180, reading: 'seen from' })
    expect(headingFromText('Rigi v. N. aus 1900 m')?.headingDeg).toBe(180)
    expect(headingFromText('Bern von Westen')?.headingDeg).toBe(90)
  })
  it('ignores names and compounds that only look like directions', () => {
    expect(headingFromText('Jungfraujoch, Mönch, NW-Flanke')).toBeNull()
    expect(headingFromText('Gerlafingen, von Roll')).toBeNull()
    expect(headingFromText('Flug nach Sevilla')).toBeNull()
    expect(headingFromText('Blick von Sonnenberg')).toBeNull()
  })
})

describe('parseTitle', () => {
  it('gives one term for a simple place', () => {
    const parsed = parseTitle('ETH-BIB-Amden-LBS H1-012345.tif')
    expect(parsed.terms).toEqual([{ text: 'Amden', kind: 'place', source: 'file name' }])
    expect(parsed.heading).toBeNull()
  })
  it('keeps every comma part and warns that the first one may be the viewpoint', () => {
    const parsed = parseTitle('ETH-BIB-Jungfraujoch, Mönch, NW-Flanke-Dia 247-01234.tif')
    expect(parsed.terms.map((t) => t.text)).toEqual(['Jungfraujoch', 'Mönch', 'NW-Flanke'])
    expect(parsed.terms[0].caution).toMatch(/wider place or the viewpoint/)
    expect(parsed.terms[1].caution).toBeUndefined()
  })
  it('joins a name that was split at its particle', () => {
    expect(texts('ETH-BIB-Piano, di, Magadino-LBS H1-000001.tif')).toEqual(['Piano di Magadino'])
  })
  it('splits two language variants at "="', () => {
    expect(texts('ETH-BIB-Genf = Genève-LBS H1-000002.tif')).toEqual(['Genf', 'Genève'])
  })
  it('adds the head of a hyphenated compound but keeps a double name whole first', () => {
    expect(texts('ETH-BIB-Allalingletscher-Tor-Dia 247-00012.tif')).toEqual(['Allalingletscher-Tor', 'Allalingletscher'])
    expect(texts('ETH-BIB-Rapperswil-Jona-LBS H1-000003.tif')[0]).toBe('Rapperswil-Jona')
  })
  it('finds the place after "in"', () => {
    expect(texts('ETH-BIB-Stierkampf in Sevilla-Nordafrikaflug 1932-LBS MH02-13-0123.tif')).toEqual([
      'Stierkampf in Sevilla',
      'Stierkampf',
      'Sevilla',
    ])
  })
  it('marks a canton code as a Swiss hint and drops it from the term', () => {
    expect(parseTitle('ETH-BIB-Rheinfelden AG-LBS H1-000004.tif').terms[0]).toMatchObject({
      text: 'Rheinfelden',
      swiss: true,
    })
    expect(parseTitle('ETH-BIB-Koblenz (AG)-LBS H1-000005.tif').terms[0]).toMatchObject({ text: 'Koblenz', swiss: true })
  })
  it('turns "Surname, Forename (years)" into a person with life dates', () => {
    const parsed = parseTitle('ETH-BIB-Schröter, Carl (1855-1939)-Portrait-Portr 12345.tif')
    expect(parsed.terms).toHaveLength(1)
    expect(parsed.terms[0]).toMatchObject({ text: 'Carl Schröter', kind: 'person', born: 1855, died: 1939 })
    expect(parsed.terms[0].caution).toMatch(/Check the image/)
  })
  it('reads a portrait-series name without years as a person', () => {
    expect(parseTitle('ETH-BIB-Stodola, Aurel-Portrait-Portr 00011.tif').terms[0]).toMatchObject({
      text: 'Aurel Stodola',
      kind: 'person',
    })
  })
  it('removes the direction and the altitude from the terms and reports the heading', () => {
    const parsed = parseTitle('ETH-BIB-Säntis v. N. aus 1900 m-Inlandflüge-LBS MH01-001234.tif')
    expect(parsed.terms.map((t) => t.text)).toEqual(['Säntis'])
    expect(parsed.heading).toMatchObject({ headingDeg: 180, reading: 'seen from' })
  })
  it('works on Zentralbibliothek file names', () => {
    expect(texts('Zentralbibliothek Zürich - Escherdenkmal - 991028231679705501.jpg')).toEqual(['Escherdenkmal'])
  })
  it('skips parts that are numbers or too short', () => {
    expect(texts('ETH-BIB-Zürich, 1932, HB-LBS H1-000006.tif')).toEqual(['Zürich'])
  })
})

// File names returned by qlever.dev and the Commons API on 12 November 2026.
describe('real file names', () => {
  const zb = (subject: string) => `Zentralbibliothek Zürich - ${subject} - 991154007339705501.jpg`

  it('reads the Comet Photo series: "Forename Surname, role"', () => {
    const parsed = parseTitle('ETH-BIB-Heiner Studer, Evangelische Volkspartei (EVP)-Com LC1500-0724-002.tif')
    expect(parsed.subject).toBe('Heiner Studer, Evangelische Volkspartei (EVP)')
    expect(parsed.terms.map((t) => [t.text, t.kind])).toEqual([
      ['Heiner Studer', 'text'],
      ['Evangelische Volkspartei', 'place'],
    ])
    expect(parsed.terms[0].caution).toMatch(/If this is a person/)
  })
  it('treats a name after an academic title as a person', () => {
    expect(
      parseTitle(
        'ETH-BIB-Dr. Fritz Mühlemann, Generalsekretär Eidgenössisches Verkehrs- und Energiedepartement-Com LC1500-0720-003.tif',
      ).terms[0],
    ).toMatchObject({ text: 'Fritz Mühlemann', kind: 'person' })
    expect(
      parseTitle('ETH-BIB-Prof. Dr. H. A. Stadler, Naturhistorisches Museum Bern-Com LC1500-0733-002.tif').terms.map(
        (t) => t.text,
      ),
    ).toEqual(['H. A. Stadler', 'Naturhistorisches Museum Bern'])
  })
  it('warns that the city of an ambassador is not what the photo shows', () => {
    const parsed = parseTitle('ETH-BIB-Serge Salvi, Botschafter in Teheran-Com LC1500-0735-001-001.tif')
    expect(parsed.terms.map((t) => t.text)).toEqual(['Serge Salvi', 'Botschafter in Teheran', 'Botschafter', 'Teheran'])
    expect(parsed.terms[3].caution).toMatch(/may not be what the photo shows/)
  })
  it('handles an ETH file without the ETH-BIB- prefix and a .tiff extension', () => {
    expect(subjectFromFileName('1. Zürcher Flippermeisterschaft Com L33-0413-0001-0001.tif')).toBe(
      '1. Zürcher Flippermeisterschaft',
    )
    expect(texts('1. Zürcher Flippermeisterschaft Com L33-0413-0001-0001.tif')).toEqual(['Zürcher Flippermeisterschaft'])
    expect(subjectFromFileName('ETH-BIB-Hanspeter Mattmüller, Regierungsratskandidat-Com LC1500-0695-001.tiff')).toBe(
      'Hanspeter Mattmüller, Regierungsratskandidat',
    )
  })
  it('splits Zentralbibliothek captions at "bei", "am" and "a. d."', () => {
    expect(texts(zb('Pommerstein bei Mols'))).toEqual(['Pommerstein bei Mols', 'Pommerstein', 'Mols'])
    expect(texts(zb('Schmiedenhaus a. d. Limmat'))).toEqual(['Schmiedenhaus a. d. Limmat', 'Schmiedenhaus', 'Limmat'])
    expect(texts(zb('Waschhaus in Lupa'))).toEqual(['Waschhaus in Lupa', 'Waschhaus', 'Lupa'])
  })
  it('splits Zentralbibliothek captions at full stops and keeps abbreviations together', () => {
    expect(texts(zb('Luzern. Göldi-Haus am Hirschenplatz'))).toEqual([
      'Luzern',
      'Göldi-Haus am Hirschenplatz',
      'Göldi-Haus',
      'Hirschenplatz',
    ])
    const stGallen = parseTitle(zb('S. Gallen. Stiftsbibliothek. Psalterium folchardi cod. N° 23. IX Jhdt'))
    expect(stGallen.terms.map((t) => [t.text, t.kind])).toEqual([
      ['St. Gallen', 'place'],
      ['Stiftsbibliothek', 'place'],
    ])
    expect(texts(zb('Bern. Stadtbibliothek. Cod. N° 96. XI Jhdt'))).toEqual(['Bern', 'Stadtbibliothek'])
  })
  it('keeps a caption with an inner " - " and gives no term for a plain description', () => {
    expect(subjectFromFileName(zb('Aus der Elisabethenkirche zu Marburg Lahn - Abrieb einer Bodenplatte'))).toBe(
      'Aus der Elisabethenkirche zu Marburg Lahn - Abrieb einer Bodenplatte',
    )
    expect(texts(zb('Rappenstein'))).toEqual(['Rappenstein'])
  })
  it('tries "Forename Surname" first when the caption is two single words', () => {
    const parsed = parseTitle(zb('Breitinger, Robert'))
    expect(parsed.terms[0].humanOnly).toBe(true)
    expect(parsed.terms.map((t) => [t.text, t.kind])).toEqual([
      ['Robert Breitinger', 'text'],
      // "Bern, Kornhaus" has the same shape and is the Kornhaus in Bern.
      ['Robert Breitinger', 'place'],
      ['Breitinger', 'place'],
      ['Robert', 'place'],
    ])
    expect(parsed.terms[1].humanOnly).toBeUndefined()
    expect(parsed.terms[0].caution).toMatch(/photographer/)
    expect(texts(zb('Circus Herzog, Gebäude'))).toEqual(['Circus Herzog', 'Gebäude'])
  })
  it('reads National Library titles: siglum, shelf mark, photographer and collection go', () => {
    expect(subjectFromFileName('CH-NB - Persien- Alltagsszene - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-04-177.jpg')).toBe(
      'Persien- Alltagsszene',
    )
    expect(subjectFromFileName('CH-NB - Bern, Mittelland, Trachten - Collection Gugelmann - GS-GUGE-LORY-E-13.tif')).toBe(
      'Bern, Mittelland, Trachten',
    )
    expect(subjectFromFileName('CH-NB-Souvenir de Berne-nbdig-18138-page001.tif')).toBe('Souvenir de Berne')
    expect(subjectFromFileName('CH-NB - Collection Gugelmann - GS-GUGE-100-11.tif')).toBe('')
  })
  it('searches in the country the title names, with the topic next to the place', () => {
    const isfahan = parseTitle('CH-NB - Persien, Isfahan- Freitagsmoschee - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-07-001.jpg')
    expect(isfahan.terms.map((t) => [t.text, t.country])).toEqual([
      ['Freitagsmoschee Isfahan', 'Q794'],
      ['Isfahan', 'Q794'],
      ['Persien', undefined],
    ])
    // A topic that only names the kind of picture is not searched.
    expect(texts('CH-NB - Russland, Leningrad (Sankt Petersburg)- Boote - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-03-001.jpg')).toEqual([
      'Leningrad',
      'Sankt Petersburg',
      'Russland',
    ])
    expect(texts('CH-NB - Schweden, Österby- Stahlfabrik Lokalisierung unsicher - Annemarie Schwarzenbach - SLA-Schwarzenbach-A-5-17-221.jpg')[0]).toBe(
      'Stahlfabrik Österby',
    )
    expect(texts('CH-NB - Grafiken Orts- und Landschaftsansichten - GS-GRAF-ANSI-AG-10.tif')).toEqual(['Grafiken Orts- und Landschaftsansichten'])
    expect(texts('CH-NB - Resti, Burgruine - Collection Gugelmann - GS-GUGE-1-2.tif')).toContain('Burgruine Resti')
  })
  it('reads a trailing NW as a direction, not as the canton of Nidwalden', () => {
    expect(parseTitle(zb('Dolder Waldhaus NW')).terms).toEqual([{ text: 'Dolder Waldhaus', kind: 'place', source: 'file name' }])
    expect(parseTitle(zb('Stans (NW)')).terms[0]).toMatchObject({ text: 'Stans', swiss: true })
  })
  it('splits at "a.d." written without a space', () => {
    expect(texts(zb('Papiermühle a.d. Sihl'))).toEqual(['Papiermühle a.d. Sihl', 'Papiermühle', 'Sihl'])
    expect(texts(zb('Turnerdenkmal am Alpenquai'))).toEqual(['Turnerdenkmal am Alpenquai', 'Turnerdenkmal', 'Alpenquai'])
    expect(texts(zb('Kinder bei Zwinglidenkmal'))).toEqual(['Kinder bei Zwinglidenkmal', 'Kinder', 'Zwinglidenkmal'])
  })
  // ETH aerial photographs, live run of 12 November 2026.
  it('searches the mountain of a summit', () => {
    expect(texts('ETH-BIB-Weisshorngipfel v. O. aus 4500 m-Inlandflüge-LBS MH01-001234.tif')).toEqual(['Weisshorngipfel', 'Weisshorn'])
    expect(texts('ETH-BIB-Säntis-Gipfel-LBS H1-000001.tif')).toEqual(['Säntis-Gipfel', 'Säntis'])
  })
  it('takes the subject before "mit"', () => {
    expect(texts(zb('Ortstock mit Tanne im Vordergrund'))).toEqual(['Ortstock mit Tanne im Vordergrund', 'Ortstock'])
    expect(texts(zb('Stadttor mit angrenzenden Gebäuden'))).toEqual(['Stadttor mit angrenzenden Gebäuden', 'Stadttor'])
  })
})
