# Harness fixtures

These are neutral reference screenshots for the moodboard fixture board in
`../fixture-board.js`. They are not user data and were generated from repo
assets, not from `~/.dsh/moodboard/`.

| File | Board image | Source asset | Derivation |
|---|---|---|---|
| `reference-layout.jpg` | `kastplan-cuberto-home-management.jpg` | `docs/panel.jpg` | cover-cropped to 900×675 |
| `reference-inspector.jpg` | `kastplan-ultro-layout.jpg` | `docs/panel.jpg` | right 42% / top 82% crop, cover-cropped to 900×675 |
| `reference-intake-form.jpg` | `kastplan-storage-cream-coral.jpg` | `docs/import-dialog.jpg` | left/top form crop, cover-cropped to 900×675 |
| `reference-harness-light.jpg` | `harness-light-reference.png` | `test/fixtures/harness-light-reference.png` | cover-cropped to 900×675 |
| `reference-harness-dark.jpg` | `harness-dark-replacement.png` | `test/fixtures/harness-dark-replacement.png` | cover-cropped to 900×675 |
| `reference-intake.jpg` | `import-dialog-before.png` | `docs/import-dialog.jpg` | full cover crop to 900×675 |

All six are JPEG q82, 900×675 (4:3), to keep the fixture board deterministic
and light. `host-stub.js` serves them for `/moodboard/image/<id>` so the page's
real fetch → Blob → object-URL pipeline runs.

Regenerate from the repository root if the source assets change:

```bash
python3 - <<'PY'
from PIL import Image
from pathlib import Path
repo = Path('.')
out = repo / 'verification/harness/fixtures'
W, H = 900, 675

def cover(im):
    im = im.convert('RGB')
    sw, sh = im.size
    scale = max(W / sw, H / sh)
    im = im.resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    left, top = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((left, top, left + W, top + H))

specs = {
    'reference-layout.jpg': repo / 'docs/panel.jpg',
    'reference-intake.jpg': repo / 'docs/import-dialog.jpg',
    'reference-harness-light.jpg': repo / 'test/fixtures/harness-light-reference.png',
    'reference-harness-dark.jpg': repo / 'test/fixtures/harness-dark-replacement.png',
}
for name, path in specs.items():
    cover(Image.open(path)).save(out / name, 'JPEG', quality=82, optimize=True)

panel = Image.open(repo / 'docs/panel.jpg')
w, h = panel.size
cover(panel.crop((int(w * 0.58), 0, w, int(h * 0.82)))).save(out / 'reference-inspector.jpg', 'JPEG', quality=82, optimize=True)

dialog = Image.open(repo / 'docs/import-dialog.jpg')
w, h = dialog.size
cover(dialog.crop((0, int(h * 0.12), int(w * 0.86), int(h * 0.78)))).save(out / 'reference-intake-form.jpg', 'JPEG', quality=82, optimize=True)
PY
```
