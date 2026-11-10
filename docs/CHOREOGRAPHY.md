# Pokéball search sequence

The form stays in its original position. Submissions are locked while fetching and
throughout playback, including Enter and `requestSubmit()`.

Playback is throw (1.20 s), settle (0.10 s), hinged opening (0.8 s), the selected
finite reveal timeline, then an accelerating vertical drop (0.65 s). The reveal's
`onComplete` starts the drop; no fixed reveal timeout is used. Steel now ends at
3.5 s, matching the shared card timing. Fire retains its 5.35 s afterglow.
Longer effect timelines are automatically respected.

`BallFlight` translates only the original model; `BallSpin` rotates it twice about
a fixed axis tilted 15° from vertical toward screen right through the closed shell's center.
The black band tilts even when the button faces away. The second turn brings the
button back to the front before the lid opens.
The throw starts at seven times the presentation distance from the camera, making
the ball appear roughly 14% of its final size. A spatial arc brings it forward
from the lower left, with its center crossing the left edge near 70% of frame height.
It crests around 31% of frame width and 38% of height, then descends into the
centered opening pose. These proportions adapt to the viewport. Perspective alone
accounts for the increase in apparent size. During the throw a parallel camera follows
only the shell, with a lens shift that places its center on the same screen arc.
This keeps its silhouette round near the edge. The shift reaches zero at rest,
and the studio background retains its usual framing throughout.
Inspired by the supplied [Blender throw reference](https://www.youtube.com/watch?v=u_Gxyzm7_1s),
the shell stays distant for most of the flight and grows rapidly near arrival.
Travel coasts until 78% of the throw, then brakes smoothly; spin brakes from 72%.
Both easing joins preserve velocity, and both end at rest before opening.
The card stays in the stable presentation space. The
existing 4° presentation tilt is established during opening. Basin decorations
are transferred with their world pose intact only after the effect finishes.
The shell stays open and moves completely below the camera frame, without fading.
Entry/exit coordinates include the model's bounds and current camera projection.

Effects and smoke retain their own local reveal clock, shaders and replay data.
Preparation occurs before the throw. There is still only one renderer loop.
`play()` resolves to `completed` after the drop or `cancelled` after interruption;
`stop()`, `showIdle()` and `dispose()` settle pending playback. Reduced motion goes
directly to the finished card and offscreen open shell. Visibility pauses both
motion and reveal timelines.

Development `debug.seek(seconds)` continues to inspect reveal-local time, with
the shell open at rest. `debug.snapshot()` includes phase and world transforms;
`debug.extendReveal(seconds)` tests completion with a longer finite timeline.
Run `node scripts/verify-choreography.mjs` against the Vite development server.
