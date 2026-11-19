# Progress Log

## Session: 2026-11-19

### Current Status
- **Phase:** 5 - Delivery
- **Started:** 2026-11-19

### Actions Taken
- Inspected `GAME_PLAN.md`, `src/scene.js`, `src/audition-stage.js`, current git state and available assets.
- Confirmed scene is selected by a getter in `createScene`; audition currently ends at `phase === 'complete'`.
- Searched the game repo, Downloads and live Blender. The game repo has no school environment; live Blender has no school set. Found the existing school-building GLTF in the user’s `mochi promise game/places` folder.
- Previewed both candidate school models in Blender. Selected `school_building/scene.gltf` over the visibly unfinished construction-school model; preserve its CC-BY attribution.
- Copied the school-building GLTF, binary, textures and CC-BY attribution into `assets/school/school_building/`.
- Chosen flow: Soo-ah pass threshold 5/8 (existing cutoff), retry below that; Ted route’s NPC Soo-ah performance counts as a pass; judges accept, Ted returns to celebrate, then both go to school.
- Implemented judge reaction/selection, a retry below 5/8, Ted’s celebration return, and the school-day handoff with preserved `school.auditionPassed` state.
- Reused the copied school GLTF in a separate school scene and returned the existing Ted/Soo-ah models and mixers after the audition.
- Added shared school dialogue variants for Ted and Soo-ah; Mr. Lee remains absent and uninformed.
- Updated controls for the school courtyard and kept the two-shot camera for the conversation; after the dialogue the camera remains independent and the selected character can move.

### Test Results
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| School asset inventory | Find an existing environment and licence | `school_building` GLTF plus CC-BY licence found; no school asset in game repo yet | pass |
| Current Blender scene inventory | Confirm whether the school is already open there | Only `node_0`, camera and light; no school environment loaded | pass |
| Browser startup with copied school model | Load the game and school textures | Game loaded; texture HTTP URL returns 200 after enabling local server access; one earlier stale browser log records the pre-permission failed fetch | pass after restart |
| Soo-ah audition pass route | Eight correct arrows should yield judge acceptance, celebration and school arrival | Eight of eight cues hit; judge acceptance, Ted return, celebration and school conversation appeared | pass |
| Soo-ah audition retry route | Fewer than five hits should offer retry | Missed all eight cues; prompt offered `F · Try the audition again`; no school transition | pass |
| Ted audition route | Ted enters, Soo-ah performs automatically, and both reach school | Ted walked onstage; Soo-ah's automatic performance reached the same school dialogue | pass |
| School dialogue and controls | F advances dialogue, selected character is preserved, movement/camera remain usable | F advanced both route variants; arrow movement worked after dialogue and WASD moved the free two-shot camera while keeping the school scene interactive | pass |

### Errors
| Error | Resolution |
|-------|------------|
| Local HTTP server could not bind before network permission | Requested turn-scoped network permission; reused the existing server and confirmed the school texture URL returned HTTP 200. |
| One old browser log showed a failed school texture request before local access was granted | Reloaded after permission; school building rendered with textures in the browser. |
| Blender scene-info query used unsupported field names on the first call | Retried with the accepted fields; confirmed no school set was in the live scene. |
