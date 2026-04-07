# E2E Tests

## Test fixtures

Fixtures live in `tests/fixtures/` and are **not committed to git** — they are generated locally and in CI via ffmpeg.

### Adding a new fixture

1. **Write the ffmpeg command** that generates it, e.g.:

   ```bash
   ffmpeg -f lavfi -i color=c=blue:size=320x240:rate=10 \
          -t 2 -c:v libvpx-vp9 -b:v 0 -crf 37 \
          tests/fixtures/sample.webm
   ```

2. **Add the same command** to the `Generate test fixtures` step in `.github/workflows/ci.yml` so CI produces it automatically.

3. **Reference it** in your test via an absolute path:

   ```ts
   const __dirname = path.dirname(fileURLToPath(import.meta.url));
   const MY_FIXTURE = path.join(__dirname, "../fixtures/my-fixture.webm");
   ```

### Generating fixtures locally

Run the ffmpeg commands in step 1 directly in your terminal. `tests/fixtures/` is gitignored so the files will never be accidentally committed.

If you don't have ffmpeg installed:

```bash
brew install ffmpeg   # macOS
sudo apt install ffmpeg  # Linux
```
