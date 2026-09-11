/** Assemble the public homepage, preserved viewers and private workspace. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const web = fileURLToPath(new URL('../', import.meta.url))
const portal = path.resolve(web, '../portal')
const source = path.join(portal, 'public')
const home = path.join(portal, 'home')
const dist = path.join(web, 'dist')
const output = path.resolve(web, '../static-portal')
const manifest = JSON.parse(await fs.readFile(path.join(portal, 'public-snapshot.json'), 'utf8'))

// Do not silently release a missing or altered public page or sample workbook.
for (const asset of manifest.files) {
  const body = await fs.readFile(path.join(source, asset.path))
  if (createHash('sha256').update(body).digest('hex') !== asset.sha256) {
    throw new Error('The preserved public asset has changed: ' + asset.path)
  }
}
await fs.access(path.join(dist, 'index.html'))
for (const filename of ['index.html', 'home.css', 'home.js']) await fs.access(path.join(home, filename))
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
await fs.cp(source, output, { recursive: true })
await fs.cp(dist, path.join(output, 'workspace'), { recursive: true })
// Existing component CSS uses root-relative brand paths. Preserve those URLs
// while the workspace bundle itself is served beneath /workspace/.
await fs.cp(path.join(dist, 'brand'), path.join(output, 'brand'), { recursive: true })
await fs.copyFile(path.join(portal, 'bridge.js'), path.join(output, 'lumnia-workspace-bridge.js'))

const bridge = '<script src="/lumnia-workspace-bridge.js"></script>'
function withBridge(index) {
  if (!/<head(?:\s[^>]*)?>/i.test(index) || !/<\/body>/i.test(index)) throw new Error('Portal pages need a complete head and body.')
  // Run before either page's application scripts to avoid rendering an old
  // landing/sign-in screen while a legacy link is being redirected.
  return index.replace(/(<head(?:\s[^>]*)?>)/i, '$1\n' + bridge)
}
await fs.mkdir(path.join(output, 'legacy'), { recursive: true })
await fs.writeFile(path.join(output, 'legacy/index.html'), withBridge(await fs.readFile(path.join(source, 'index.html'), 'utf8')))
await fs.writeFile(path.join(output, 'index.html'), withBridge(await fs.readFile(path.join(home, 'index.html'), 'utf8')))
for (const filename of ['home.css', 'home.js']) await fs.copyFile(path.join(home, filename), path.join(output, filename))
console.log('Portal assembled: current homepage; preserved shared viewers, signup and sample; analysis at /workspace/#/analysis.')
