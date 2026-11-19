# Task Plan: Audition to School Transition

## Goal
After a successful NOVA audition, show the judges accepting Soo-ah, let Ted and Soo-ah celebrate, then transition both playable routes into the existing school setting for a shared conversation about telling Mr. and Mrs. Lee.

## Next Step
Finish the cafe-route review, then commit and push this feature branch; leave `main` unchanged.

## Current Phase
Phase 8: Walk from school to Lee’s Cafe — implementation complete; browser verification in progress

## Phases

### Phase 1: Requirements & Discovery
- [x] Understand user intent
- [x] Identify constraints
- [x] Locate school assets and inspect current transitions
- **Status:** complete

### Phase 2: Planning & Structure
- [x] Define shared pass/retry and school-dialogue states
- [x] Select the existing school-building asset, preserving its license
- **Status:** complete

### Phase 3: Implementation
- [x] Add judge reaction, success and retry flow, and celebration
- [x] Add the school scene, preserve selection and character models, and restore movement/camera
- [x] Add shared next-school-day dialogue that does not reveal the result to Mr. Lee
- **Status:** complete

### Phase 4: Testing & Verification
- [x] Verify the Soo-ah-controlled successful route
- [x] Verify the Ted-controlled automatic performance route
- [x] Verify the school handoff, dialogue, character selection, movement, and camera
- [x] Verify the below-threshold audition retry branch
- **Status:** complete

### Phase 5: Delivery
- [x] Review the final diff and license attribution
- [x] Commit and push only the verified feature-branch changes
- **Status:** complete

### Phase 6: Judge and family-home integration
- [x] Inventory the user’s three NOVA judge folders and Mrs. Lee assets
- [x] Add each judge’s seated FBX actor and visible per-judge scoring to the audition stage
- [x] After the existing school conversation, put Mrs. Lee and Mr. Lee at home and let Ted/Soo-ah visit
- [x] Keep the existing retry path and selected playable character intact
- [x] Apply source 4K texture atlases to the FBX actors and correct the home framing/poses
- [x] Review the browser flow before considering the branch ready
- **Status:** complete

### Phase 7: Ted grounding and family confrontation
- [x] Inspect the current home screenshot and locate Mr/Mrs Lee speech clips
- [x] Keep Ted’s feet on the path and correct his apparent floor penetration
- [x] Use Mr Lee’s angry/talking gestures and Mrs Lee’s talking animation in the parent discussion
- [x] Add Mr Lee’s refusal and concern about industry sexualization, Ted’s reassurance, and Mrs Lee’s support
- [x] Verify the updated home scene and dialogue in the browser
- **Status:** complete

### Phase 8: Walk from school to Lee’s Cafe
- [x] Reuse the existing street, crossings, park paths and cafe; add only connecting walkway pieces
- [x] Keep both characters’ world positions unchanged when switching from the school view to the street view
- [x] Add walk/turn/run following with spacing control and a two-character follow camera
- [x] Add the two once-only optional conversation stops
- [x] Show the cafe route, player marker and cafe goal on the minimap; gate F entry on both characters reaching the entrance
- [x] Browser-check the Ted route handoff, street crossing, camera framing, companion follow and first conversation
- [ ] Verify the second conversation and cafe-entry prompt in the browser
- **Status:** implementation complete; final browser checks in progress

## Decisions Made (continued)
| Decision | Rationale |
|----------|-----------|
| Keep the existing audition-success → next-school-day conversation, then transition to the Lee home when the player finishes that conversation. | Preserves the school chapter already requested while making the parents’ visit success-gated. |
| Use the three per-judge `Sitting Idle.fbx` assets and the supportive Mrs Lee `Happy Hand Gesture.fbx`; reuse Mr Lee’s in-game model and the existing Korean house. | Gives the stage seated judges and a supportive mother while avoiding a rebuilt environment. |
| Show live scorecards based on Soo-ah’s existing eight-cue score and retain the existing 5/8 pass threshold/retry. | Makes the judges visibly evaluate the same performance result the game already measures. |

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use a 5/8 cue score as the Soo-ah pass threshold; allow retry below it. | Reuses the existing positive-score cutoff while ensuring both routes can reach the shared school chapter. |
| Count the Ted-controlled automatic Soo-ah performance as successful. | That route has no player cue score, but it must reach the same story progression. |

## Errors Encountered
| Error | Resolution |
|-------|------------|
