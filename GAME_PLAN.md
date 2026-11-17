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
- **Mochi stool:** a small wooden stool beside the north path; F picks up the mochi, and F at the bench hands it to the other friend.
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

The park ground now spans 100 m across, with a Seoul gate on the south entrance, five Korean house/apartment buildings around the perimeter, and Sakura trees along the edges. Paths connect the gate, bench, and cafe. Lee’s Cafe is about 18 m from the bench. A wooden mochi stool sits beside the north path near Ted’s approach. At Begin, the selected character starts on the far-side approach while their friend waits at the bench. Mr. Lee starts beside the bench, about 9 m from the player, watching the approach, and patrols a loop across the path between the player and the bench, pausing at each corner; he stops and faces the active player when noticed, and resumes after they withdraw. F advances the route-specific bench conversation; F picks up the mochi at the stool and hands it to the friend at the bench. Ted’s route covers the NOVA invitation; Soo-ah’s route includes her Korean-help promise and mochi beat. Both end with her agreeing to audition.

## Decisions still open

- Confirm the exact spoken wording and meaning of the reciprocal mochi promise.
- Decide whether the first playable chapter shows the bullying directly or introduces it through a short recap and dialogue.
- Decide whether accepting NOVA is fixed in this chapter or expressed through a final player choice. Current plan assumes she agrees to attend; the conversation with Mr. Lee happens later.
- Add physical occlusion/hiding checks if distance-and-facing awareness feels too easy to evade or unfair in play.
