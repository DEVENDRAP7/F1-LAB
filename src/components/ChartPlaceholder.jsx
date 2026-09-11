/* The message that stands where a chart will be, in the chart's space.
 *
 * Every chart on this site has a known height — 420 for the g-g diagram
 * and the channel map, 300 for the envelope, lap-time and progression
 * charts, 120 for a telemetry trace — and every one of them is preceded,
 * for the fraction of a second before its data lands, by a one-line note
 * saying to pick a driver. A line of text where 420 pixels of chart is
 * about to be is why three pages scored 0.5 to 0.6 on layout shift
 * against a 0.1 budget: the panel is short, then it is tall, and
 * everything below it moves a screen and a half down.
 *
 * So the note sits in a box the size of the chart it is standing in for.
 * The height comes from the same prop the chart is given, which is the
 * only way the two cannot drift apart.
 *
 * This is not the same as reserving a guessed height for a whole panel —
 * which was tried, measured, and made one page worse, because a block
 * that is reserved and then removed is its own shift. Here nothing is
 * removed: the box is replaced by a chart of exactly its height. */
export default function ChartPlaceholder({ height, children }) {
  return (
    <div className="chart-placeholder" style={{ height }}>
      <p className="panel-note">{children}</p>
    </div>
  );
}
