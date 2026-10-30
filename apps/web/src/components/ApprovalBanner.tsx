interface ApprovalBannerProps {
  stepName: string;
  comment: string;
  busy?: boolean;
  onCommentChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onViewOutput: () => void;
}

export function ApprovalBanner({
  stepName,
  comment,
  busy = false,
  onCommentChange,
  onApprove,
  onReject,
  onViewOutput,
}: ApprovalBannerProps) {
  return (
    <section className="approval-banner" aria-label="人工审批">
      <div className="ab-head">◆ 人工审批卡点：{stepName}</div>
      <div className="ab-desc">
        该步骤产物已生成，通过后工作流继续；驳回将终止本次执行。请在步骤产物中确认内容。
      </div>
      <div className="ab-actions">
        <input
          className="input ab-comment"
          placeholder="审批意见（可选）"
          value={comment}
          onChange={(event) => onCommentChange(event.target.value)}
          maxLength={2000}
          aria-label="审批意见"
        />
        <button className="btn btn-primary" onClick={onApprove} disabled={busy}>
          通过
        </button>
        <button className="btn btn-danger" onClick={onReject} disabled={busy}>
          驳回
        </button>
        <button className="btn" onClick={onViewOutput}>
          查看产物
        </button>
      </div>
    </section>
  );
}
