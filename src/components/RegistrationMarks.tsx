/**
 * The `+` glyphs at each corner of a framed object, offset outside the border.
 * Per the design system these belong on log-row image frames, gallery frames
 * and primary buttons — the parent must be `position: relative`.
 */
export function RegistrationMarks() {
  return (
    <>
      <i className="mk mk-tl" aria-hidden="true">+</i>
      <i className="mk mk-tr" aria-hidden="true">+</i>
      <i className="mk mk-bl" aria-hidden="true">+</i>
      <i className="mk mk-br" aria-hidden="true">+</i>
    </>
  );
}
