import { describe, expect, it } from 'vitest'
import { buildFileInfoUrl, commonsImageUrl, commonsPageUrl, parseFileInfo } from './commons'

describe('commons', () => {
  it('builds a pageids query', () => {
    const u = new URL(buildFileInfoUrl([1, 2], 120))
    expect(u.searchParams.get('pageids')).toBe('1|2')
    expect(u.searchParams.get('origin')).toBe('*')
    expect(u.searchParams.get('iiurlwidth')).toBe('120')
  })
  it('parses titles and thumbnails, tolerating missing pages', () => {
    const json = {
      query: {
        pages: {
          '1': { pageid: 1, title: 'File:A & B.jpg', imageinfo: [{ thumburl: 'https://t/1.jpg' }] },
          '2': { pageid: 2, title: 'File:C.jpg', imageinfo: [{}] },
          '3': { pageid: 3, title: 'File:D.jpg' },
          '-1': { missing: '' },
        },
      },
    }
    const m = parseFileInfo(json)
    expect(m.get(1)).toEqual({ title: 'A & B.jpg', thumbUrl: 'https://t/1.jpg' })
    expect(m.get(2)).toEqual({ title: 'C.jpg', thumbUrl: null })
    expect(m.get(3)).toEqual({ title: 'D.jpg', thumbUrl: null })
    expect(m.size).toBe(3)
  })
  it('builds Commons URLs with underscores and encoding', () => {
    expect(commonsPageUrl('A & B.jpg')).toBe('https://commons.wikimedia.org/wiki/File:A_%26_B.jpg')
    expect(commonsImageUrl('A & B.jpg', 400)).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/A_%26_B.jpg?width=400',
    )
  })
})
