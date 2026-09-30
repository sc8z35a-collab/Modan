// Lane D: fetch Creative-Commons / public-domain photos for the field guide (図鑑) from Wikimedia Commons.
// Resizes to <= 800px (ImageMagick) -> public/assets/photos/<id>.webp and writes photos.json with the
// attribution (author, license, source URL) that the field guide shows on every card.
// usage: node tools/fetch-photos.mjs [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';

const OUT = 'public/assets/photos';
export const PHOTOS = {
  rainbow: 'File:Rainbow Trout (Oncorhynchus mykiss) Gavins Point.jpg',
  yamame: 'File:Oncorhynchus masou masou-1.jpg',
  iwana: 'File:Salvelinus leucomaenis 01.jpg',
  brown: 'File:Salmo trutta fario.jpg',
  loon: 'File:Gavia immer -Minocqua, Wisconsin, USA -swimming-8.jpg',
  owl: 'File:Ural owl (Strix uralensis) in Kõrvemaa, Estonia (March 2022).jpg',
  woodpecker: 'File:Great spotted woodpecker (Dendrocopos major) male Drenthe.jpg',
  uguisu: 'File:Japanese bush warbler（Horornis diphone）ウグイス.jpg',
  firefly: 'File:Luciola cruciata.jpg',
  spruce: 'File:Picea jezoensis Mt Oakan.jpg',
  pine: 'File:Pinus densiflora on Mount Kengyo.jpg',
  birch: 'File:Betula platyphylla 01.jpg',
  porcini: 'File:AD2009Sep13 Boletus edulis 01.jpg',
  chanterelle: 'File:Cantharellus cibarius 2010 G1.jpg',
  bilberry: 'File:Vaccinium myrtillus - Bilberry 03.jpg',
  fern: 'File:Matteuccia struthiopteris kz06.jpg',
  waterlily: 'File:Nymphaea tetragona (91).jpg',
};
const OK_LICENSE = /^(CC0|Public domain|CC BY(-SA)? [0-9.]+( [a-z]+)?)$/i;
const UA = 'ModanCamp/1.0 (field guide; github.com/sc8z35a-collab/Modan)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const curl = (args) => execFileSync('curl', ['-sSL', '-m', '60', '-A', UA, ...args], { maxBuffer: 64 << 20 });
const strip = (h = '') => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

mkdirSync(OUT, { recursive: true });
const force = process.argv.includes('--force');
const meta = {};
for (const [id, title] of Object.entries(PHOTOS)) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&titles=' + encodeURIComponent(title);
  let info;
  for (let k = 0; k < 4 && !info; k++) {
    try { const d = JSON.parse(curl([api]).toString()); info = Object.values(d.query.pages)[0].imageinfo[0]; }
    catch (e) { console.warn('retry', id, e.message.slice(0, 80)); await sleep(5000 * (k + 1)); }
  }
  if (!info) { console.error('FAILED', id); continue; }
  const m = info.extmetadata;
  const license = strip(m.LicenseShortName?.value);
  if (!OK_LICENSE.test(license)) { console.error('SKIP (license)', id, license); continue; }
  meta[id] = {
    file: `${id}.webp`, title: title.replace(/^File:/, ''),
    author: strip(m.Artist?.value) || 'unknown', license, licenseUrl: m.LicenseUrl?.value || '',
    source: info.descriptionurl,
  };
  const dst = `${OUT}/${id}.webp`;
  if (force || !existsSync(dst)) {
    const tmp = `/tmp/photo-${id}`;
    writeFileSync(tmp, curl([info.thumburl || info.url]));
    execFileSync('convert', [tmp, '-auto-orient', '-resize', '800x800>', '-strip', '-quality', '78', dst]);
    unlinkSync(tmp);
    await sleep(1500);
  }
  console.log('ok', id, license, '—', meta[id].author);
}
writeFileSync(`${OUT}/photos.json`, JSON.stringify(meta, null, 1));
console.log('wrote', Object.keys(meta).length, 'photos');
