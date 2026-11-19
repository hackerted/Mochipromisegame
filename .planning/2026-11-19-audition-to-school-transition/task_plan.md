# Task Plan: Audition to School Transition

## Goal
After a successful NOVA audition, show the judges accepting Soo-ah, let Ted and Soo-ah celebrate, then transition both playable routes into the existing school setting for a shared conversation about telling Mr. and Mrs. Lee.

## Next Step
Deliver the verified feature-branch update; do not merge it into main until approved.

## Current Phase
Phase 5: Delivery

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

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use a 5/8 cue score as the Soo-ah pass threshold; allow retry below it. | Reuses the existing positive-score cutoff while ensuring both routes can reach the shared school chapter. |
| Count the Ted-controlled automatic Soo-ah performance as successful. | That route has no player cue score, but it must reach the same story progression. |

## Errors Encountered
| Error | Resolution |
|-------|------------|
