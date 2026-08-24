// Empty and loading states are content, not an afterthought (docs/SPEC.md
// section 5): every one names *why* the data isn't there yet, never just
// a spinner or a blank panel.
export default function EmptyState({ title, reason }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-reason">{reason}</p>
    </div>
  );
}
