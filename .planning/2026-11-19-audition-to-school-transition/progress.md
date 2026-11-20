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
- Committed and pushed as `caf6b33` on `feature/mochi-stool-give`; main remains untouched and `.DS_Store` was not staged.

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

## Session: 2026-11-19 — Judge and family-home integration
- Confirmed the Downloads asset folders contain NOVAjudgeage22, NOVAjudgeformerGen1idol, olderkpopjudge, and MrsLee, including judge idle/talking/positive-reaction clips.
- Confirmed the current game already contains two judge FBX models and Mrs Lee FBX, but no judge actor setup in `scene.js`; the judge feedback is currently only dialogue/state text.
- Created branch `feature/nova-judges-and-family-home`; existing `.DS_Store` changes are left untouched and unstaged.
- **Current phase:** 6 — inspecting actor/model formats and extending the existing audition, school, and scene transitions.
- Decided to keep the existing school chapter; after its conversation, a pass-only home visit will reuse the Korean house, Mr. Lee’s loaded model, and the new supportive Mrs Lee FBX.
- The three judge `Sitting Idle.fbx` files are the appropriate runtime assets for a seated judging panel; their corresponding T-pose GLBs would not animate.
- **Next step:** commit the verified feature branch for review; leave `main` untouched.
- Extracted the 4K PNG atlases from the judge and Mrs Lee source GLBs and applied them to the skinned FBX runtime actors, avoiding the unsupported `fbm/` image references.
- Corrected the family-home camera to show the house and all four characters, and reset Mr Lee’s patrol animation before the dialogue.
- Browser verified the Ted route reaches NOVA, shows three live judge scores, preserves the school conversation, and opens the family home. The family screenshot shows both parents and children at the house; the full dialogue reaches its completion state.
- Browser testing also confirmed that a low cue score stays on the audition retry path. The final portrait viewport shows the live scores and the home family clearly; the judge actors remain off-camera during the close performance shot and are staged for the separate score reveal.
- Follow-up texture check corrected the FBX/glTF V flip; Mrs Lee now renders with the expected cardigan, blouse and pink skirt. The family transition aligns all actor feet to the porch path from their world bounds, and a closer screenshot shows Ted standing on the surface.
- User reports Ted still appears sunk and requests a stronger parent confrontation. The Downloads MrsLee folder contains `Talking.fbx`; the game already has Mr Lee talking, angry gesture and angry point clips.
- **Next step:** commit and push the verified floor/dialogue fix on this feature branch; leave `main` untouched.
- Replaced the home actor’s stale static bounds with the skeleton-aware floor placement used for standing transitions, and set Ted’s home-only visual scale so he stands at Soo-ah’s height while remaining grounded.
- The home Mr Lee now uses the user’s `Talking.fbx` rig; his angry-point/gesture clips run for his refusal and industry concern. Mrs Lee’s `Talking.fbx` clip plays for her support, and Ted’s replies cover her voice and homework.
- Browser verified Ted’s feet at ground level and the complete parent dialogue. No JavaScript errors occurred.
- Switched the home Mr Lee actor to the user’s `mr lee/Talking.fbx` rig so its embedded talking clip drives the actor; Mrs Lee uses her separate `Talking.fbx` clip while retaining the textured gesture model.
- Browser v329 verified Ted’s feet at the path and his home scale beside Soo-ah. Browser v330 verified the full confrontation dialogue and both parents’ talking animation clips.

## Session: 2026-11-19 — School-to-cafe journey
- **Current phase:** 8 — playable route from the school entrance to Lee’s Cafe.
- Reused the main park scene’s existing road ring, south/north crossings, gate path, park loop, north path and single Lee’s Cafe model; added only the two short connecting paths.
- Positioned the school scene on the same world map and switch the existing character roots to the park scene without changing their positions. The school building stays in its own school view to keep it from obstructing the street camera.
- Added the follower controller with existing turn, walk and run clips, a paired follow camera, a 2.2 m separation limit, optional one-time conversations, a cafe marker/route on the minimap, and F entry only after both reach the entrance.
- Browser v337 followed the Ted-selected route through audition success and the school conversation; the cafe objective and minimap appeared at the south crossing. Arrow movement crossed the road with both characters visible, and the one-time first conversation displayed Soo-ah’s nervous line and Ted’s reassurance.
- `node --check --input-type=module < src/scene.js` and `git diff --check` passed.
- Under the normal Ted route (without debug start), verified standing, arrow movement, mochi pickup and handoff after moving out of Mr. Lee’s sight, the eating line, and the bench conversation. The home map had routed straight through the pond, so it now uses the existing loop path; the debug home-route view shows the detour.
- The full normal audition-to-cafe journey for both playable characters is still not verified end to end; the Cafe story branch and controls were separately exercised in the browser.
- **Remaining browser check:** second conversation and arriving at the cafe entrance to verify the F handoff into the existing family scene.

## Session: 2026-11-19 — The audition result at Lee’s Cafe
- Reused the single street Cafe GLB and the existing textured Mrs Lee and talking Mr Lee FBX rigs; hid its street dressing while the story uses the cafe interior view and restored it on exit.
- Added a modest counter, cups, warm light and entry walk. Mr Lee greets the pair from behind the counter; Soo-ah delivers the news, pauses for his reaction, and explains why singing, dancing and school all matter to her.
- Added three accessible dialogue buttons with 1–3 keyboard alternatives. Each reply has a distinct parent response, then converges on the same undecided but hopeful ending.
- Mrs Lee approaches Soo-ah and congratulates her. Mr Lee remains concerned about school and needs time to think; Ted supports Soo-ah without speaking over her.
- F returns the same selected character pair to the existing street outside the cafe and restores the follow camera and movement controls. Story flags retain the audition result, selected response and told-parents state for the rest of the session.
- Browser v342 checked four-character staging, the response choices, a selected-response path, the hopeful ending and return to street. The final v344 reload confirmed the cafe view, Mr Lee’s opening question and Soo-ah’s nervous line; no console errors were recorded.
- `node --check --input-type=module < src/scene.js` and `git diff --check` passed.

## Session: 2026-11-19 — Cafe audition-result scene
- Inspected the existing Cafe GLB and confirmed the project already includes Mrs Lee’s textured Happy Gesture and Talking FBX clips plus Mr Lee’s talking home rig.
- Reused and reparented the single Cafe model for the family scene. Added a modest serving counter, cups, floor and warm light because the GLB has a shop exterior/signage but no interior work counter.
- Added an animated entrance, Mr Lee noticing the pair, the audition reveal and pause, Mrs Lee’s approach, the school/future explanation, three response choices, and a thoughtful non-approval ending.
- Browser v342 verified all four characters inside the Cafe, the reveal pause, Mrs Lee’s approach, visible response buttons, keyboard selection, the family conversation ending, and F returning the selected character to the existing street scene. No console errors were recorded.
- **Next:** check the final diff, static syntax, commit and push this branch; do not merge to `main`.
