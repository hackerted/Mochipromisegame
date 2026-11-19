# A Mochi Promise — Game Plan

**Status:** first playable approach slice in progress.  
**Format:** short 3D story adventure with two playable perspectives and one shared outcome.

## Core premise

After school in Seoul, Ted—a student who recently moved from London and is the only international student at school—and Soo-ah have become close while she helps him learn Korean. They were both bullied. Soo-ah’s father, Mr. Lee, is protective and wants her focused on studying, so he has told her not to see Ted. Ted wants to tell Soo-ah about an audition with NOVA, a performing-arts/K-pop agency. She is afraid to tell her father she wants to try.

The player chooses Ted or Soo-ah. Each route reaches the bench, builds the same friendship, and leads to Soo-ah deciding to attend the audition. The route changes what the player knows and does along the way.

## Story shape

### Opening: why they trust each other

Briefly establish Ted’s move from London, his isolation as the only international student, the bullying they both experienced, and Soo-ah’s promise to help him with Korean. Keep the bullying focused on specific classmates’ actions rather than treating either culture as the problem.

### Ted route: reach the bench

1. Ted starts near Lee’s Cafe after school and needs to reach Soo-ah at the park bench without Mr. Lee spotting him.
2. Mr. Lee’s patrol is readable: his route, pauses, and facing direction give Ted chances to move. Cafe corners and the trees can provide cover.
3. If Mr. Lee spots the active player, he stops and faces them. The bench conversation remains unavailable until they move out of sight; they can then try again. No hard fail or lost progress.
4. At the bench, Ted tells Soo-ah about the NOVA audition. She worries about her father and whether she is ready. Ted encourages her to try.
5. End the route with Soo-ah agreeing to attend. Echo the Korean-help promise as a sign of their trust.

### Soo-ah route: keep the promise

1. Soo-ah meets Ted at the bench while carrying the pressure of her father’s study expectations.
2. She tells Ted she will keep helping him with Korean. They share mochi and make their promise.
3. Ted tells her about NOVA and encourages her to audition too, not only to help him. Soo-ah is afraid to tell her father but agrees to go.

### Shared chapter ending

Both routes converge on the same immediate outcome: Soo-ah will attend the audition, and the promise between the friends is renewed. Leave the conversation with Mr. Lee for a later chapter; he remains a caring, protective father whose expectations create conflict, not a villain to defeat.

## Main gameplay loop

Choose a perspective → collect the mochi from the stool beside the north path → move through the cafe/park space → read Mr. Lee’s position or Soo-ah’s situation → reach the bench and offer the mochi → play the route-specific conversation → converge on the audition decision.

## Character and system roles

- **Ted:** playable in the stealth approach; uses the existing walking and turning controller.
- **Soo-ah:** playable in the promise route; her choices express loyalty, fear, and growing confidence.
- **Mr. Lee:** Soo-ah’s father, protective and focused on her studies. His patrol and awareness make Ted’s approach tense but fair.
- **Bench:** the meeting point and emotional center of the chapter.
- **Mochi stool:** a small wooden stool beside the north path; F picks up the mochi, and F at the bench hands it to the other friend, who takes a bite.
- **Lee’s Cafe and cherry-tree park:** the route space; use the existing assets and green landscape.
- **NOVA:** a performing-arts/K-pop agency audition, as confirmed by the user.

## Branch state to track

`route` (`ted` or `sooAh`), `mrLeeAlert` (clear or spotted), `reachedBench`, `mochiHolder`, `mochiShared`, `koreanHelpPromise`, `novaInvitation`, and `auditionAccepted`.

The soft spotted/retry state belongs to the approach. Both routes set the shared promise and audition outcome through their own scenes; they should not feel like duplicate dialogue with different camera positions.

## First playable chapter scope

1. Add route selection and a short opening recap.
2. Give Mr. Lee a looped cafe-to-park patrol, waypoint waits, facing turns, and proximity awareness.
3. Add route starts and a gentle spotted/retry state.
4. Add the two bench conversation sequences and shared audition decision.
5. Test both routes in the browser, including retreating after detection, completing each conversation, and returning to play.

## Current world layout

The park ground now spans 100 m across, with a Seoul gate on the south entrance, five Korean house/apartment buildings around the perimeter, and Sakura trees along the edges. Paths connect the gate, bench, and cafe. Lee’s Cafe is currently centered near (-5, 35), about 35 m from the bench; the older 18 m note is out of date. A wooden mochi stool sits beside the north path near Ted’s approach; F picks up the existing food asset, and F at the bench hands it to the friend, who takes a bite. At Begin, the selected character starts on the far-side approach while their friend waits at the bench. Mr. Lee starts beside the bench, about 9 m from the player, watching the approach, and patrols a loop across the path between the player and the bench, pausing at each corner; he stops and faces the active player when noticed, and resumes after they withdraw. F advances the route-specific bench conversation. Ted’s route covers the NOVA invitation; Soo-ah’s route includes her Korean-help promise and mochi beat. Both end with her agreeing to audition.

## Park perimeter expansion plan

Build the street ring before the audition stage, keeping the 45.2 m playable park and its current hedge, path, pond, bench, and patrol layout intact. The hedge sits at x/z = ±22.6 m and the perimeter buildings at about ±37 m, leaving a 14.4 m band for a street edge.

1. **Road blockout:** Add a rounded local-road loop centered near x/z = ±28.6 m, about 6 m wide, with smooth corners. Keep roughly 3 m between the hedge and the road edge for a park-side verge and sidewalk; reserve the outer strip for sidewalk and a small cafe-side parking bay after checking the house footprints.
2. **Pedestrian links:** Extend the north, south-gate, east, and west paths across the road to the outer sidewalk. Add zebra crossings and curb ramps at those four links; slow traffic at the south gate and north approach. Keep the mochi stool and the current Ted route inside the hedge.
3. **Street dressing:** Add lane markings, curbs, drains, a few signs, a hydrant, bins, and a bus-stop pole or shelter by Lee’s Cafe. Use the existing hydrant, cafe, houses, and apartments; make markings and simple street fixtures in Three.js where the asset library has no match.
4. **Cars:** Copy only selected models from `newmochigame/cars` into the game repo after checking their scale and materials. Start with a parked Kia Picanto and Forte near the cafe/outer curb, plus one slow Kia moving around the ring. Keep the Hyundai city bus as an optional later addition at the cafe stop so it does not dominate the first pass.
5. **Validation:** Check both character routes, the four crossings, the mochi interaction, and Mr. Lee’s sightline after the road geometry is in place. Add moving traffic only after the static road, cars, and walking clearances read correctly.

**Scope boundary:** The road is scenery and safe perimeter access for this pass; cars do not drive through the park or collide with the story characters. The four pedestrian crossings connect the park to the cafe-side and neighborhood sidewalks. Revisit playable city travel as a separate stage.

**Built in this pass:** A rounded two-way road loop, sidewalks, lane dashes, four zebra crossings with paths connected to the outer sidewalk, two marked parking bays with parked Kia Forte cars, one slow Kia Forte on the loop, two hydrants, a cafe bus-stop sign and a street bin. The city bus and raised curb ramps remain future dressing.

## Next level: Home to the NOVA audition

**Chapter goal:** Carry the promise from the park into the next morning, then let Soo-ah overcome her stage fright and perform. The audition is a story moment, not a pass/fail rhythm game. The playable slice now lets the selected character walk from the bench to a home waypoint before the NOVA stage; home interiors and evening scenes remain planned work.

### Story sequence

1. **Leave the park:** After Soo-ah agrees to audition, the next F starts a map-guided walk home for the selected character. A top-left minimap marks the player, park roads/crossings, both homes, and the active home destination.
2. **Go home that evening:** Ted’s route leads to the northwest Korean house; Soo-ah’s route leads to the northeast apartment. The current slice ends at the home exterior with an F prompt; interior home scenes and bedtime beats remain planned work.
3. **Meet the next morning:** At home, F advances to the following morning and transitions to the NOVA stage. A playable street trip to NOVA can be added after a venue exterior and transit assets are chosen.
4. **Soo-ah freezes:** At the audition, Soo-ah steps onto the stage, sees the judges and audience, and freezes. Give the player a brief moment to notice her fear before Ted helps.
5. **Ted encourages her:** If Ted is selected, the player walks him onto the stage. If Soo-ah is selected, Ted enters as an NPC. Ted sings, performs the supplied Gangnam Style dance with his hands free, sets his figure on the stage edge, gives a thumbs-up, and says, “Over to you, chipmunk.” Soo-ah changes from terrified to happy, then walks from the stage wing to her mark.
6. **Soo-ah performs:** If Soo-ah is selected, the player follows arrow cues through her singing, Hip Hop, Jazz, and Step Hip Hop clips. Each pressed arrow triggers a visible move. If Ted is selected, the same performance runs for Soo-ah as an NPC. Missed cues never block the ending.

### Dance and singing controls

- Lock camera movement during the stage scene. In Ted’s route, arrows walk Ted to his mark. In Soo-ah’s route, arrows are reserved for the performance prompts; normal movement returns outside the audition.
- The current QTE shows one randomized arrow at a time, with a three-second response window. Every arrow triggers an animation: Up uses Hip Hop, Down uses Singing, Left uses Jazz, and Right uses Step Hip Hop. A correct key raises her on-beat count; a wrong or missed key still advances without stopping the performance.
- A miss briefly returns Soo-ah to standing idle before the next cue. The sequence has eight cues and always ends with her completing the audition.
- The current cues use a steady timer because no audition music file has been added yet. When music is supplied, align the cue interval to its tempo.

### Assets and audio to review

- **NOVA venue:** exterior entrance/sign, audition room, stage, curtains/backdrop, judges’ table and chairs, a modest audience, stage lights, speakers, and a microphone or stand.
- **Characters:** The supplied `tedkpopaudtion` and `kpopaudtionsooah` FBXs provide Ted walking, singing, Gangnam Style, thumbs-up, and happy hand gestures; Soo-ah start-walking, terrified, happy, idle, singing, Hip Hop, Jazz, Step Hip Hop, and victory clips. The game uses rigged GLB models plus compact animation-only GLBs extracted from those FBXs. Singing currently means the supplied body animation; no audio or lip-sync clip is included yet.
- **Story prop:** Ted’s Gundam figure, sized to read clearly in his hand and when placed on the stage edge. Keep it as a separate prop so the handoff/placement can be animated.
- **Music:** user-selected, usable audio file plus its tempo or beat times. Check whether it includes vocals/backing vocals and whether Soo-ah’s animation should match the full track or a short audition excerpt. Keep the music choice open until the assets are reviewed.
- **Home scenes:** small, reusable bedroom or home-corner assets for the evening beats; detailed home exploration is out of this level’s scope.

### Build order and completion checks

1. Define a single chapter transition using the existing `auditionAccepted` outcome so both Ted and Soo-ah routes enter the same next level.
2. Block out the evening/morning transitions, meetup, NOVA entrance, backstage, stage, audience, and judges with temporary geometry. Confirm character scale, stage access, camera framing, and a clear path for Ted to enter and leave.
3. Add the story beats and figure placement, with movement locked during each cutscene and every animation transition returning to a stable idle pose.
4. After the user selects music and reviews the actual Mixamo clips, map prompts only to those clips and measured beat times. Add small Blender keys for missing story gestures. Keep the QTE handler scoped to this scene so it cannot trigger walking, dialogue, or camera controls.
5. Verify both prior routes reach this level once; Soo-ah freezes before Ted’s encouragement; the figure stays in his hand until placed and remains on stage; the correct line plays once; all prompt outcomes reach the same completed-audition ending; normal controls return afterward.

**Scope boundary:** This level ends after Soo-ah completes the audition. The audition result, meeting NOVA staff, and any follow-up with Mr. Lee are later story decisions. Home interiors, the trip from home to NOVA, judges/audience, and music playback remain future work; the map-guided walk and stage sequence use the reviewed animation files.

## Decisions still open

- Confirm the exact spoken wording and meaning of the reciprocal mochi promise.
- Decide whether the first playable chapter shows the bullying directly or introduces it through a short recap and dialogue.
- The first chapter currently assumes Soo-ah agrees to attend. The next-level plan uses that shared outcome; only add a yes/no invitation choice if the story direction changes.
- Add physical occlusion/hiding checks if distance-and-facing awareness feels too easy to evade or unfair in play.
