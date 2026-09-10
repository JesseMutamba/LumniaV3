/** Assemble the existing public portal and the new private analysis workspace. */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const web = fileURLToPath(new URL('../', import.meta.url))
const portal = path.resolve(web, '../portal')
const source = path.join(portal, 'public')
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
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(output, { recursive: true })
await fs.cp(source, output, { recursive: true })
await fs.cp(dist, path.join(output, 'workspace'), { recursive: true })
// Existing component CSS uses root-relative brand paths. Preserve those URLs
// while the workspace bundle itself is served beneath /workspace/.
await fs.cp(path.join(dist, 'brand'), path.join(output, 'brand'), { recursive: true })
await fs.copyFile(path.join(portal, 'bridge.js'), path.join(output, 'lumnia-workspace-bridge.js'))
await fs.copyFile(path.join(portal, 'bridge.css'), path.join(output, 'lumnia-workspace-bridge.css'))

const entry = '<a id="lumnia-workspace-entry" class="lumnia-workspace-entry" href="/workspace/#/analysis"><img src="/brand/lumnia-mark-void.svg" alt="" aria-hidden="true"><span>Analyze your data</span><span aria-hidden="true">↗</span></a>'
let index = await fs.readFile(path.join(output, 'index.html'), 'utf8')
if (!/<\/head>/i.test(index) || !/<\/body>/i.test(index)) throw new Error('The preserved root page needs a complete head and body.')
index = index.replace(/<\/head>/i, '<link rel="stylesheet" href="/lumnia-workspace-bridge.css">\n</head>')
index = index.replace(/<\/body>/i, entry + '\n<script src="/lumnia-workspace-bridge.js"></script>\n</body>')
await fs.writeFile(path.join(output, 'index.html'), index)
console.log('Portal assembled: preserved landing, pilot signup, public sample and source files; analysis at /workspace/#/analysis.')
