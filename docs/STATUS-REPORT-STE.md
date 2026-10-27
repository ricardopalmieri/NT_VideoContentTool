# Status report: Noisetupi Video Content Tool Web

> **Historical report.** This file records the checkpoint before Rounds 1 and
> 2 were closed. Its failing tests, branch state, test counts and next steps are
> no longer current. Use `docs/UPGRADE-UX-UI-AUTOMACAO.md` for process control
> and `docs/RODADA2-RELATORIO.md` for the current verified status.

**Current checkpoint (2026-10-26):** Round 2 is closed; the legacy integrity
check, 89 Vitest tests, strict type check, production build and all 15
Playwright tests pass. Version 0.7.0 is under a feature freeze pending final
review and local commits. No push or deployment was performed.

**Language rules:** ASD-STE100 (Simplified Technical English)
**Date:** 2026-10-26
**Branch:** `codex/rodada0-restauracao` (local)
**Version label:** 0.6.2 (with Phase 1–3 changes)

---

## 1. Summary

1. The team found the original source code of version 0.6.2. The source code is now in `src/`.
2. The build, the type check and the unit tests pass.
3. The browser tests (Playwright) pass, except one test. Paragraph 4 gives the data.
4. We tested the user interface (UI) in a browser. Paragraph 3 gives the results.
5. The work is not on GitHub. `origin/main` contains only the first commit.
6. Four commits are on the local branch. Many Phase 1–3 changes do not have a commit.

---

## 2. Repository status

| Item | Status |
|---|---|
| Remote branch `origin/main` | Contains commit `41af6f6` only. It does not contain the new work. |
| Local branch `codex/rodada0-restauracao` | Contains 4 commits for Round 0: source restore, modules, tests, CI, licenses. |
| Changes without a commit | 13 changed files and 6 new files or folders. They contain the Phase 1–3 work: autosave, `window.vct`, tablet layout, snap fix, A/V sync. |
| Tag `v0.6.2-prod` | Contains the old production build. |
| `legacy/0.6.2/`, `archives/0.6.2/` | Contain the reference copies of version 0.6.2. Do not change these folders. |
| License files | `LICENSE` (MPL-2.0), `LICENSES/`, `NOTICE`, `THIRD_PARTY_LICENSES.md`, `TRADEMARKS.md` are present. |

**Caution:** The local disk is the only location of the Phase 1–3 changes. If the disk fails, you lose this work. Make a commit and push the branch soon.

---

## 3. UI test in the browser (visual check)

We used the development server and the built-in browser. The viewports were 1366×850, 1024×768 and 768×1024.

| # | Test | Result |
|---|---|---|
| 1 | Select the language. Make a new project. Add a text layer. | PASS |
| 2 | Look at the toolbar. | PASS. The toolbar has SVG icons and the new "Coletar mídias" button. |
| 3 | Look at the status bar after an edit. | PASS. It shows "RECUPERAÇÃO SALVA" (autosave is on). |
| 4 | Reload the page. Click "Recuperar projeto". | PASS. The project and its layers come back. |
| 5 | Send a batch of 3 commands with `window.vct.batch()`. | PASS. The app applies the 3 commands. |
| 6 | Send a command with a value that is not a number. | PASS. The app refuses the command. It shows the message "value precisa ser um número finito". |
| 7 | Push Ctrl+Z one time after the batch. | PASS. The app removes all 3 commands. |
| 8 | Use a 1024×768 viewport (tablet, landscape). | PASS. There is no horizontal overflow. The Export button is visible. |
| 9 | Use a 768×1024 viewport (tablet, portrait). | PASS. There is no horizontal overflow. The toolbar shows icons only. |
| 10 | Pull the fade-in handle from the corner of the clip. | **FAIL.** The fade start and the fade end get the same value (1.37 s and 1.37 s). The fade has zero length. The layer does not fade. |
| 11 | Push S, B or Ctrl+K to split a clip. | **NOT AVAILABLE.** This is a Round 2 item. |
| 12 | Measure the font size of the UI text. | **FAIL.** Most UI text is 6–10 px. 92 of 138 controls are smaller than 32 px. |
| 13 | Read the property labels in tablet layout. | **FAIL.** Some labels are cut, for example "S…" and "W…". |

---

## 4. Automatic tests

| Test set | Command | Result |
|---|---|---|
| Legacy check | `npm run verify:legacy` | PASS |
| Type check | part of `npm run build` | PASS |
| Unit tests (Vitest) | `npm run test` | PASS. 9 files, 59 tests. |
| Production build | `npm run build` | PASS. JS 420 kB (116 kB gzip). |
| Browser tests (Playwright) | `npx playwright test` | 11 PASS, **1 FAIL** |

**Browser tests that pass:**

1. Text, geometry, fade, effect and `.ntvct` in the two directions (legacy to new, new to legacy).
2. Frame-counter video. The export keeps the frame sequence.
3. The export stops with a clear error when a media file is missing.
4. Batch relink uses media metadata.
5. "Collect Media" downloads a portable ZIP file.
6. "Collect Media" writes the ZIP file to a selected folder.
7. The tablet layout is usable. The side panels open.
8. When you move linked audio, the video and the fades stay in sync.
9. Autosave recovers the project and the media files.
10. Keyframes in the inspector keep their values and animate.
11. `window.vct` validates, reads and applies a batch with one undo step.

**Browser test that fails:**

- Test: `renderer recria recursos após restauração do contexto WebGL` (`tests/parity/editor.spec.ts:786`).
- The test expects the text "RENDER ERROR" in the status bar.
- The status bar shows "RECUPERAÇÃO SALVA".
- Possible cause: the autosave message replaces the render error message. It is necessary to examine the cause.

---

## 5. Items that work and have tests

1. **Source code.** The TypeScript source is in modules. The behavior is the same as 0.6.2.
2. **Open project.** The app validates and migrates the file before it replaces the current media.
3. **Snap.** A clip, a fade handle or the playhead does not snap to itself.
4. **Renderer.** The app disposes of the old renderer. It recreates the renderer after a WebGL context loss.
5. **Undo.** The app does not record a step when nothing changes.
6. **Export.** The seek uses the frame index. The export stops with a clear message when media is missing. Keyboard shortcuts are locked during export.
7. **Autosave.** The project and the media files are in IndexedDB. The start screen shows "Recuperar projeto" and "Descartar".
8. **Relink.** The project keeps the name, size and date of each media file.
9. **Collect Media.** The app makes a ZIP file with `project.json` and `assets/`.
10. **A/V link.** When you move or trim linked audio, the video, the fades and the keyframes stay in sync.
11. **Audio fades.** Fade-in and fade-out use separate gain nodes.
12. **Domain model.** Keyframe rules, the effect catalog, the commands and the validation are in `src/model/`. They do not use the DOM.
13. **Automation API.** `window.vct` has `getProject`, `validate`, `listCatalog`, `query`, `dispatch`, `batch` and `onChange`. `docs/AUTOMACAO.md` describes the API.
14. **Tablet.** The layout fits 1024 px and 768 px. The side panels open as drawers.

---

## 6. Known problems

| # | Problem | Severity | Action |
|---|---|---|---|
| 1 | The work is not on GitHub. | High | Make commits. Push the branch. |
| 2 | The fade handle makes a fade of zero length. | High | Use a relative fade model (Round 1): one handle on each side, with a length in seconds. |
| 3 | The WebGL context restore test fails. | Medium | Find the cause. Do not let the autosave message hide an error message. |
| 4 | The UI text is too small (6–10 px). | Medium | Set a minimum of 11–12 px. Add a "large interface" option. |
| 5 | Controls are too small for touch (92 of 138 are less than 32 px). | Medium | Make the touch area of each control 44 px or more. |
| 6 | Property labels are cut in tablet layout. | Low | Use short labels or a two-line layout. |
| 7 | The language screen shows again after a reload. The language buttons are not `<button>` elements. | Low | Skip the screen when a language is saved. Use `<button>`. |
| 8 | The fade fields in the inspector use absolute time and show ◆ (keyframe). The renderer ignores these keyframes. | Low | Remove ◆ from these fields. |

---

## 7. Next steps

Do the steps in this sequence.

### Step 1: Keep the work safe (do this now)

1. Examine the changes: `git status` and `git diff`.
2. Add `playwright-report/` and `test-results/` to `.gitignore`, if they are not there.
3. Make one commit for each phase (Phase 1, Phase 2, Phase 3).
4. Push the branch `codex/rodada0-restauracao` to GitHub.
5. Open a pull request into `main`. Do not merge until step 2 is complete.

### Step 2: Close Round 1 (stability)

1. Repair the failing WebGL context test.
2. Change to the relative fade model: `fadeIn` and `fadeOut` in seconds, one handle on each side. Add a migration from v2. Add a regression test for test 10 in paragraph 3.
3. Apply the fade and the opacity after the effects. Repair the Add and Darken blend modes.
4. Use a curve (equal-power) for audio fades.
5. Keep the scroll position of the properties panel after an edit.
6. Make the text box grow with the text. Show a warning when text is cut.
7. Run `npm run check`. Do a manual test on a real iPad.
8. Make the release package (`npm run package:hostinger`). Upload `dist/` to Hostinger.

### Step 3: Round 2 (real editing, format v3)

1. Use the `tracks[].clips[]` model. Make a migration from v2.
2. Add split at the playhead (S, Ctrl+B, scissors button).
3. Let the user move clips between tracks. Add ripple delete.
4. Add multi-select and copy/paste of clips.
5. Add transitions between clips (crossfade, dip to black).

### Step 4: Rounds 3–6

Use the sequence in `docs/ANALISE-E-PLANO.md`, paragraph 9:

1. Timeline navigation and text.
2. Tablet, accessibility and simple mode.
3. Motion design and VJ tools.
4. Automation channels (skills, MCP server, WebMCP), on top of `window.vct`.

### Step 5: Documents

1. Update `docs/ANALISE-E-PLANO.md`. The source code is no longer missing.
2. Write the English translation of the documents at the end of the upgrade rounds.

---

## 8. Test data reference

- Unit and build log: 59/59 tests pass. Build time is 1.85 s.
- Playwright: 12 tests, 11 pass, 1 fails. Run time is 1.5 min.
- UI viewports: 1366×850, 1024×768, 768×1024.
- Tested code: the working tree of `codex/rodada0-restauracao`, with the changes that do not have a commit.
