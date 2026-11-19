# Findings & Decisions

## Requirements
- Keep the existing audition and school assets; connect a successful audition to the next school day in the same game.
- Preserve whether Ted or Soo-ah was selected, and preserve a separate `auditionPassed` flag when switching scenes.
- The judges visibly react positively, state that Soo-ah was selected, and the pair celebrate briefly.
- At school, both characters appear together and discuss telling Mr. and Mrs. Lee; Mr. Lee must not know the result yet.
- Keep the existing movement and camera usable after the scene transition.
- Use the three judge models now present in `Downloads/newmochigame` and make their scoring/reactions visible during Soo-ah’s audition.
- Keep Mr. and Mrs. Lee at home; once Soo-ah passes, Ted and Soo-ah should go to them.

## Research Findings
- Game repository contains no school environment asset. The live Blender scene only has a mesh named `node_0`, not a school set.
- Found `Downloads/mochi promise game/places/school_building/scene.gltf` with `scene.bin`, six textures and `license.txt`; the source identifies it as “school building” by swjeta under CC-BY-4.0. It is preferable to `construction_school.glb`, whose title and appearance are a construction site.
- The imported school-building model is authored very small (about 2.6 m wide, 0.46 m high and 2.2 m deep before normalization); it needs uniform scene scale to read as a school block. Its license attribution must ship with the copied asset.
- A temporary Blender preview showed the school-building asset is a low-rise windowed school block. The other candidate `construction_school.glb` is a visibly unfinished construction site (56 m wide) and is not appropriate for the next-school-day scene. Temporary Blender imports were removed; original scene objects were retained.
- `scene.js` already has an audition `complete` phase, an eight-cue Soo-ah score, and a stage scene getter. Only 5+ correct cues currently get the confident result; the Ted-played route runs Soo-ah automatically.
- The main-scene actors and mixers already exist and should be restored/reparented for the school scene rather than loading replacement character models.
- The existing school asset is a single building, not a whole campus scene; the new school scene will reuse it and use a minimal courtyard ground plane for playable space, without modeling another building.
- `GAME_PLAN.md` says the audition ends the current level and that judges are future work; this task extends that boundary.
- First browser pass reached the school scene after eight correct Soo-ah cues; the stored pass state, judges’ announcement, Ted’s return/celebration, and shared school conversation all triggered. The initial school camera followed Soo-ah too tightly and cropped Ted, so the two characters need a centered two-shot during arrival/conversation.
- The school asset’s texture request failed before local-network permission was granted; after restarting permissions the asset and texture URL return HTTP 200. Recheck browser console on the next reload.
- Current source assets include three character GLBs in `NOVAjudgeage22`, `NOVAjudgeformerGen1idol`, and `olderkpopjudge`; the first two have corresponding judge FBXs already in the game repo, while the newly exported `nova-judge-last.fbx` and Mrs Lee GLB/animations are only in Downloads.
- The game code currently has judge reaction dialogue and pass/retry states, but no judge scene roots. After the celebration it switches to the school scene; no parent-home scene or Mrs Lee runtime actor exists.
- The current branch contains only pre-existing `.DS_Store` changes; work is isolated on `feature/nova-judges-and-family-home` and must not stage or commit those files.
- The judge `Sitting Idle.fbx` files include the judge-specific skinned character plus idle action; use them as the stage actors so they appear seated rather than importing the unrigged T-pose GLBs.
- Mrs Lee’s `Happy Hand Gesture.fbx` includes her character and supportive gesture; reuse it for the family visit. Mr Lee’s current game GLB, idle/talking clips, and the already-loaded Korean house model can be reused.
- Keep the existing school-day scene and conversation after the audition pass. The final school interaction will open the home visit; retries never enter school or the home scene.
- Put a three-card score panel in the audition HUD, deriving the three judges’ values from the existing 0–8 cue score; do not replace the existing pass/retry threshold.
- First browser pass confirmed the judge actors load, score UI works, and the failed-audition retry remains active. The Ted route reached the existing school scene after NOVA selected Soo-ah.
- The first family-home screenshot showed the camera aimed away from the house and children; Mrs Lee’s FBX appeared black because FBXLoader could not resolve its `fbm/texture_*` reference. The source MrsLee and judge GLBs contain matching 4K texture atlases that can be extracted and applied to the skinned FBX actors.
- Mr Lee carried a patrol stride into the home shot. Reset his family pose to a neutral stance before the conversation.
- The Ted-controlled route was verified end-to-end through the live score panel, NOVA acceptance, school dialogue, Lee home, and the complete family conversation. The earlier low-score Soo-ah attempt still entered the retry state.
- The home camera and material fix were visually checked; the narrow portrait viewport does not show the full-width judge panel in the dance shot, so the score HUD remains the clear live scoring cue. The seated judge actors are positioned for the final score reveal.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
- Use a persistent school state and an explicit school scene in the existing `createScene` system, selected by the existing scene getter. | Keeps this connected to current routing, character selection and renderer rather than creating a disconnected demo. |
- Set `auditionPassed` only after the pass result; keep it on the story state through school loading. | Makes the success condition explicit and durable across scene transitions. |
- On Soo-ah’s route, 5/8 passes and lower scores offer a retry; on Ted’s route the automatic Soo-ah performance passes. | Preserves the existing score cutoff and converges both routes. |
- Reuse the downloaded `school_building` GLTF and include the original attribution file. | Avoids rebuilding the school and preserves the CC-BY-4.0 requirement. |
- Use dialogue about planning to tell the parents, without placing Mr. Lee in the school scene or revealing the result to him. | Meets the requested story beat and keeps the reveal for a later chapter. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|

## Resources
-
