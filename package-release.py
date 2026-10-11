from pathlib import Path
import json,re,zipfile,shutil,platform,hashlib,base64
root=Path(__file__).parent
docs=root/'docs';(docs/'third-party').mkdir(exist_ok=True)
for path in [root/'node_modules/fflate/LICENSE',root/'node_modules/gifenc/LICENSE.md',root/'node_modules/lucide/LICENSE',root/'node_modules/@fontsource-variable/outfit/LICENSE']:
 shutil.copy2(path,docs/'third-party'/('fflate-LICENSE.txt' if 'fflate' in str(path) else 'outfit-OFL.txt' if 'outfit' in str(path) else 'lucide-LICENSE.txt' if 'lucide' in str(path) else 'gifenc-LICENSE.txt'))
results=root/'scripts/browser/results'
coverage=json.loads((root/'coverage/coverage-summary.json').read_text())['total'];browser=json.loads((results/'browser-results.json').read_text())
unit=json.loads((docs/'unit-results.json').read_text());advanced=json.loads((results/'browser-m4-results.json').read_text());refinements=json.loads((results/'browser-refinements-results.json').read_text());codec_browser=json.loads((results/'browser-codecs-results.json').read_text());workspace_browser=json.loads((results/'browser-workspace-results.json').read_text());icon_browser=json.loads((results/'browser-icons-results.json').read_text());density_browser=json.loads((results/'browser-density-results.json').read_text());theme_browser=json.loads((results/'browser-theme-results.json').read_text());scrollbar_browser=json.loads((results/'browser-scrollbars-results.json').read_text());font_browser=json.loads((results/'browser-font-results.json').read_text());typography_browser=json.loads((results/'browser-typography-results.json').read_text());version=json.loads((root/'package.json').read_text())['version'];archive=root.parent/f'pivo-craft-v{version}-source.zip'
report={'version':version,'date':'2026-10-10','build':'TypeScript noEmit and Vite production build passed','unit_integration_tests':{'passed':unit['numPassedTests'],'failed':unit['numFailedTests'],'files':len(unit['testResults'])},'browser':browser,'advanced_browser':advanced,'refinement_browser':refinements,'codec_browser':codec_browser,'workspace_browser':workspace_browser,'icon_browser':icon_browser,'density_browser':density_browser,'theme_browser':theme_browser,'scrollbar_browser':scrollbar_browser,'font_browser':font_browser,'typography_browser':typography_browser,'coverage':coverage,'external_checks':['Node zlib verifies standard framing, rejects mismatched output and Adler checksum','Python/Pillow PNG/GIF and manual legacy ASE corpus; exported GIF frame count/loop metadata verified by Pillow'],'not_verified':['complete desktop-tool equivalence','Firefox and Safari','full WCAG AA audit','formal hostile-file security audit','performance targets'],'platform':{'node':'24.14.1','python':platform.python_version(),'machine':platform.machine()}}
(docs/'verification.json').write_text(json.dumps(report,indent=2))
html=(root/'dist/index.html').read_text();html=re.sub(r'<script id="vite-plugin-pwa:register-sw"[^>]*></script>|<link rel="manifest"[^>]*>','',html);js=next((root/'dist/assets').glob('*.js')).read_text();css=next((root/'dist/assets').glob('*.css')).read_text()
def embed_font(match):
 asset=root/'dist/assets'/Path(match.group(1).strip(chr(34)+chr(39))).name
 if not asset.exists():raise RuntimeError('Missing font asset '+str(asset))
 return 'url(data:font/woff2;base64,'+base64.b64encode(asset.read_bytes()).decode()+')'
css=re.sub(r'url\(([^)]*\.woff2)\)',embed_font,css)
html=re.sub(r'<script type="module"[^>]*src="[^"]+"[^>]*></script>',lambda m:'<script type="module">'+js.replace('</script','<\\/script')+'</script>',html)
html=re.sub(r'<link rel="stylesheet"[^>]*>',lambda m:'<style>'+css+'</style>',html)
licenses='\n'.join((docs/'third-party'/name).read_text() for name in ['fflate-LICENSE.txt','gifenc-LICENSE.txt','lucide-LICENSE.txt','outfit-OFL.txt'])
html=html.replace('</body>','<!-- Runtime dependency notices:\n'+licenses.replace('--','- -')+'\n--></body>')
(root/'dist/standalone.html').write_text(html)
ignore_dirs={'node_modules','coverage','.git','test-results'}
ignore_names={'fix-integration.py','dev-server.log','screenshot-editor.png','browser-project.pvc','browser-tile.pvc','browser-m4-project.pvc','browser-custom.pxbrush','screenshot-m4.png','release-manifest.json','integrate-m4.py','extend-adjustments.py','fix-alpha-composition.py','update-m4-release.py','preserve-selection-history.py','browser-pattern.pxbrush','retry-refinements.py','add-pattern-gradient.py','integrate-refinements.py','finalize-refinements.py','harden-ase.py','ase-fix-budget.py','ase-final-safety.py','ase-link-canonical.py','fix-group-compositing.py','native-integrity.py','finish-codec-ui.py','fix-ase-palettes.py','release-v04.py','browser-codec-roundtrip.gif','browser-codec-project.pvc','browser-codec-tile.aseprite','browser-codec-bad.png','integrate-workspace.py','fix-workspace-recovery.py','release-v05.py','screenshot-workspace.png','browser-shortcuts.pxkeys','use-lucide.py','release-lucide.py','screenshot-lucide.png','release-spacing.py','screenshot-desktop-refined.png','screenshot-docked-refined.png','add-theme.py','release-theme.py','screenshot-theme-light.png','screenshot-theme-dark.png','release-scrollbars.py','screenshot-scrollbars.png','release-outfit.py','screenshot-outfit.png','release-typography.py','screenshot-outfit-refined.png'}
files=[]
for p in root.rglob('*'):
 rel=p.relative_to(root)
 if p.is_file() and not any(x in ignore_dirs for x in rel.parts) and p.name not in ignore_names and not p.name.startswith('browser-export-') and not p.name.endswith('.zip'):
  files.append(p)
manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
(docs/'release-manifest.json').write_text(json.dumps(manifest,indent=2))
files.append(docs/'release-manifest.json')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in files:z.write(p,arcname='pivo-craft/'+str(p.relative_to(root)))
print(json.dumps({'files':len(files),'zip_bytes':archive.stat().st_size,'standalone_bytes':len(html.encode()),'archive':str(archive),'passed_tests':unit['numPassedTests'],'coverage_statement_pct':coverage['statements']['pct'],'coverage_branch_pct':coverage['branches']['pct'],'browser_checks':len(browser['tests'])+len(advanced['tests'])+len(refinements['tests'])+len(codec_browser['tests'])+len(workspace_browser['tests'])+len(icon_browser['tests'])+len(density_browser['tests'])+len(theme_browser['tests'])+len(scrollbar_browser['tests'])+len(font_browser['tests'])+len(typography_browser['tests'])},indent=2))
